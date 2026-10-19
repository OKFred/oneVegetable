import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IopAuthorizationController,
  IOP_VAULT_KEY,
  IOP_RECEIPT_KEY,
  IOP_SESSION_KEY,
  TOP_SESSION_KEY,
  failure,
  parseCallback
} from '../lib/iop-authorization';
import type { AuthorizationStorage, AuthorizationTokenClient } from '../lib/iop-authorization';
import { TOP_VAULT_KEY, TOP_RECEIPT_KEY } from '../lib/iop-authorization-storage';
import credential from '../../../mock/data/node-gateway-credentials.json';
import {
  parseAlibabaOpenApiCredentialBundle,
  parseAlibabaTokenResponse
} from '@one-vegetable/core/credential-bundle';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';
import { sealAlibabaAuthorization } from '@one-vegetable/core/alibaba-authorization-vault';

const bundle = parseAlibabaOpenApiCredentialBundle({
  ...credential.oauthBundle,
  protocol: 'iop',
  oauth: {
    ...credential.oauthBundle.oauth,
    refreshToken: tokens.success.refresh_token,
    refreshExpiresAtUtc: null
  }
});
const token = parseAlibabaTokenResponse(tokens.success);
const controllers: IopAuthorizationController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.cancel();
});
function setup(protocol: 'top' | 'iop' = 'iop') {
  const data: Record<string, unknown> = {};
  const write = vi.fn((values: Record<string, unknown>) => {
    Object.assign(data, values);
    return Promise.resolve();
  });
  const storage: AuthorizationStorage = {
    get: (key) => Promise.resolve({ [key]: data[key] }),
    set: write,
    remove: (keys) => {
      for (const key of keys) Reflect.deleteProperty(data, key);
      return Promise.resolve();
    }
  };
  let now = Date.parse(bundle.capturedAtUtc);
  const client = { request: vi.fn<AuthorizationTokenClient['request']>().mockResolvedValue(token) };
  const open = vi.fn((_url: string) => Promise.resolve(42));
  const create = () => {
    const controller = new IopAuthorizationController(storage, client, open, () => now, protocol);
    controllers.push(controller);
    return controller;
  };
  return {
    data,
    storage,
    write,
    client,
    open,
    create,
    controller: create(),
    advance: () => {
      now += 600_001;
    }
  };
}
describe('durable standalone authorization sessions', () => {
  it.each(['top', 'iop'] as const)(
    'restores %s without idle expiry and stays locked after manual lock and restart',
    async (protocol) => {
      const test = setup(protocol);
      const key = protocol === 'top' ? TOP_SESSION_KEY : IOP_SESSION_KEY;
      await test.controller.import({ ...bundle, protocol }, '123456');
      expect(test.data[key]).toBeDefined();
      for (const secret of [
        '123456',
        bundle.application.appSecret,
        bundle.oauth.accessToken,
        tokens.success.refresh_token
      ])
        expect(JSON.stringify(test.data)).not.toContain(secret);
      test.advance();
      const restarted = test.create();
      expect((await restarted.export()).protocol).toBe(protocol);
      expect(JSON.stringify(await restarted.status())).not.toContain('sessionKeyMaterial');
      await restarted.lock();
      expect(test.data[key]).toBeUndefined();
      await expect(test.controller.export()).rejects.toThrow('AUTH_VAULT_LOCKED');
      expect((await test.create().status()).state).toBe('locked');
      await restarted.unlock('123456');
      expect((await test.create().status()).state).toBe('ready');
      await restarted.clear();
      expect(test.data[key]).toBeUndefined();
      expect((await test.create().status()).state).toBe('empty');
    }
  );

  it.each(['top', 'iop'] as const)(
    'migrates old %s records only after the original passphrase unlocks successfully',
    async (protocol) => {
      const test = setup(protocol);
      const key = protocol === 'top' ? TOP_SESSION_KEY : IOP_SESSION_KEY;
      const vaultKey = protocol === 'top' ? TOP_VAULT_KEY : IOP_VAULT_KEY;
      const old = await sealAlibabaAuthorization({ ...bundle, protocol }, 'old-password', protocol);
      test.data[vaultKey] = old.record;
      expect((await test.controller.status()).state).toBe('locked');
      await expect(test.controller.unlock('wrong-password')).rejects.toThrow('AUTH_UNLOCK_FAILED');
      expect(test.data[key]).toBeUndefined();
      test.write.mockRejectedValueOnce(new Error('quota'));
      await expect(test.controller.unlock('old-password')).rejects.toThrow('AUTH_ACTION_FAILED');
      expect((await test.controller.status()).state).toBe('locked');
      expect(test.data[vaultKey]).toEqual(old.record);
      expect(test.data[key]).toBeUndefined();
      await test.controller.unlock('old-password');
      expect(test.data[vaultKey]).toEqual(old.record);
      expect((await test.create().status()).state).toBe('ready');
    }
  );
});

describe('restoration races and storage failures', () => {
  it.each(['lock', 'clear'] as const)('cannot revive a delayed status after %s', async (action) => {
    const test = setup();
    await test.controller.import(bundle, '123456');
    const restarted = test.create();
    const saved = structuredClone(test.data[IOP_SESSION_KEY]);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let delayed = false;
    vi.spyOn(test.storage, 'get').mockImplementation(async (key) => {
      if (key === IOP_SESSION_KEY && !delayed) {
        delayed = true;
        reached();
        await gate;
        return { [key]: saved };
      }
      return { [key]: test.data[key] };
    });
    const status = restarted.status();
    await reading;
    await restarted[action]();
    release();
    expect((await status).state).toBe(action === 'lock' ? 'locked' : 'empty');
    await expect(restarted.export()).rejects.toThrow('AUTH_VAULT_LOCKED');
    expect(test.data[IOP_SESSION_KEY]).toBeUndefined();
  });

  it.each(['top', 'iop'] as const)(
    'surfaces %s lock/clear deletion failures and retries without restoring memory',
    async (protocol) => {
      const test = setup(protocol);
      const key = protocol === 'top' ? TOP_SESSION_KEY : IOP_SESSION_KEY;
      await test.controller.import({ ...bundle, protocol }, '123456');
      const remove = vi.spyOn(test.storage, 'remove');
      remove.mockRejectedValueOnce(new Error('disk failure'));
      await expect(test.controller.lock()).rejects.toThrow('AUTH_ACTION_FAILED');
      expect(test.data[key]).toBeDefined();
      expect((await test.controller.status()).state).toBe('locked');
      await test.controller.lock();
      expect((await test.create().status()).state).toBe('locked');
      await test.controller.unlock('123456');
      remove.mockRejectedValueOnce(new Error('disk failure'));
      await expect(test.controller.clear()).rejects.toThrow('AUTH_ACTION_FAILED');
      expect((await test.controller.status()).state).toBe('locked');
      await test.controller.clear();
      expect(test.data[key]).toBeUndefined();
    }
  );

  it('rejects mismatched or corrupt recovery material without overwriting ciphertext', async () => {
    const test = setup();
    await test.controller.import(bundle, '123456');
    const record = structuredClone(test.data[IOP_VAULT_KEY]);
    const saved = test.data[IOP_SESSION_KEY] as Record<string, unknown>;
    for (const invalid of [
      { ...saved, protocol: 'top' },
      { ...saved, iv: 'wrong' },
      { ...saved, sessionKeyMaterial: 'invalid' }
    ]) {
      test.data[IOP_SESSION_KEY] = invalid;
      expect((await test.controller.status()).state).toBe('locked');
      expect(test.data[IOP_VAULT_KEY]).toEqual(record);
      await expect(test.controller.export()).rejects.toThrow('AUTH_VAULT_LOCKED');
    }
    await test.controller.unlock('123456');
    expect((await test.controller.status()).state).toBe('ready');
  });
});

describe('independent IOP authorization', () => {
  it('binds state, exact callback and tab, consuming a code once without storing it', async () => {
    const s = setup();
    await s.controller.start({ ...bundle.application, passphrase: '123456' });
    const url = new URL(s.open.mock.calls[0]?.[0] ?? '');
    expect(url.hostname).toBe('openapi-auth.alibaba.com');
    const callback = new URL(bundle.application.callbackUrl);
    callback.search = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      code: 'test-code'
    }).toString();
    expect(await s.controller.acceptCallback(callback.href, 43)).toBe(false);
    await expect(
      s.controller.acceptCallback(callback.href.replace('state=', 'state=wrong'), 42)
    ).rejects.toThrow('OAUTH_STATE_MISMATCH');
    expect(await s.controller.acceptCallback(callback.href, 42)).toBe(true);
    expect(await s.controller.acceptCallback(callback.href, 42)).toBe(false);
    expect(s.client.request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.data)).not.toContain('test-code');
    expect(JSON.stringify(s.data)).not.toContain(bundle.application.appSecret);
    expect((await s.controller.export()).protocol).toBe('iop');
  });
  it('expires an abandoned authorization instead of continuously waiting', async () => {
    const s = setup();
    await s.controller.start({ ...bundle.application, passphrase: '123456' });
    s.advance();
    expect((await s.controller.status()).errorCode).toBe('AUTH_TASK_EXPIRED');
    expect(s.client.request).not.toHaveBeenCalled();
  });
  it('persists rotated tokens encrypted and restores them after worker restart', async () => {
    const s = setup();
    await s.controller.import(bundle, '123456');
    await s.controller.refresh();
    expect((await s.controller.export()).oauth.accessToken).toBe(token.accessToken);
    expect(JSON.stringify(s.data)).not.toContain(token.accessToken);
    const restarted = s.create();
    expect((await restarted.status()).state).toBe('ready');
    expect((await restarted.export()).oauth.accessToken).toBe(token.accessToken);
  });
  it('retains old tokens after an explicit rejection; unknown results cannot retry or export', async () => {
    const s = setup();
    await s.controller.import(bundle, '123456');
    s.client.request.mockRejectedValueOnce(failure('IOP_TOKEN_REJECTED'));
    await expect(s.controller.refresh()).rejects.toThrow('IOP_TOKEN_REJECTED');
    expect((await s.controller.export()).oauth.accessToken).toBe(bundle.oauth.accessToken);
    s.client.request.mockRejectedValueOnce(failure('NETWORK_TIMEOUT'));
    await expect(s.controller.refresh()).rejects.toThrow('NETWORK_TIMEOUT');
    await expect(s.controller.refresh()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
    await expect(s.controller.export()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
    expect(s.client.request).toHaveBeenCalledTimes(2);
    expect(s.data[IOP_RECEIPT_KEY]).toBeDefined();
  });
  it('never sends if intent cannot persist; saves rotated tokens again without network retry', async () => {
    const s = setup();
    await s.controller.import(bundle, '123456');
    s.write.mockRejectedValueOnce(new Error('quota'));
    await expect(s.controller.refresh()).rejects.toThrow('AUTH_ACTION_FAILED');
    expect(s.client.request).not.toHaveBeenCalled();
    s.write
      .mockImplementationOnce((values) => {
        Object.assign(s.data, values);
        return Promise.resolve();
      })
      .mockRejectedValueOnce(new Error('quota'));
    await expect(s.controller.refresh()).rejects.toThrow('AUTH_ACTION_FAILED');
    expect((await s.controller.status()).canSave).toBe(true);
    await s.controller.save();
    expect((await s.controller.export()).oauth.accessToken).toBe(token.accessToken);
    expect(s.client.request).toHaveBeenCalledTimes(1);
    await s.controller.clear();
    expect(s.data[IOP_VAULT_KEY]).toBeUndefined();
  });
  it.each([
    'http://example.com/',
    'https://u:p@example.com/',
    'https://example.com/?x=1',
    'https://localhost/',
    'https://192.168.1.2/'
  ])('rejects unsafe callbacks %s', (url) => {
    expect(() => parseCallback(url)).toThrow();
  });
});

describe('standalone TOP/IOP protocol isolation and reauthorization', () => {
  it.each(['top', 'iop'] as const)(
    'reports a locked %s export without inventing an uncertain exchange',
    async (protocol) => {
      const test = setup(protocol);
      await expect(test.controller.export()).rejects.toThrow('AUTH_VAULT_LOCKED');
      await test.controller.import({ ...bundle, protocol }, '123456');
      await test.controller.lock();
      const restarted = test.create();
      await expect(restarted.export()).rejects.toThrow('AUTH_VAULT_LOCKED');
      expect((await restarted.status()).state).toBe('locked');
      expect(test.client.request).not.toHaveBeenCalled();
      expect(test.data[protocol === 'top' ? TOP_RECEIPT_KEY : IOP_RECEIPT_KEY]).toBeNull();
    }
  );

  it.each(['top', 'iop'] as const)(
    'allows unlocking %s after an uncertain exchange without clearing its receipt',
    async (protocol) => {
      const test = setup(protocol);
      await test.controller.import({ ...bundle, protocol }, '123456');
      test.client.request.mockRejectedValueOnce(failure('NETWORK_TIMEOUT'));
      await expect(test.controller.refresh()).rejects.toThrow('NETWORK_TIMEOUT');
      const receiptKey = protocol === 'top' ? TOP_RECEIPT_KEY : IOP_RECEIPT_KEY;
      const receipt = structuredClone(test.data[receiptKey]);
      const restarted = test.create();
      expect((await restarted.status()).state).toBe('unknown');
      await expect(restarted.export()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
      await expect(restarted.refresh()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
      expect(test.data[receiptKey]).toEqual(receipt);
      expect(test.client.request).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['origin', null],
    ['path', null],
    ['duplicate-state', 'OAUTH_STATE_MISMATCH'],
    ['duplicate-code', 'OAUTH_CODE_MISSING'],
    ['missing-code', 'OAUTH_CODE_MISSING'],
    ['provider-error', 'OAUTH_PROVIDER_ERROR']
  ] as const)('never exchanges a code for a callback with invalid %s', async (kind, errorCode) => {
    const test = setup('top');
    await test.controller.start({ ...bundle.application, passphrase: '123456' });
    const auth = new URL(test.open.mock.calls[0]?.[0] ?? '');
    const callback = new URL(bundle.application.callbackUrl);
    callback.search = new URLSearchParams({
      state: auth.searchParams.get('state') ?? '',
      code: 'callback-security-test'
    }).toString();
    if (kind === 'origin') callback.hostname = 'other.example.com';
    if (kind === 'path') callback.pathname += '/unexpected';
    if (kind === 'duplicate-state')
      callback.searchParams.append('state', auth.searchParams.get('state') ?? '');
    if (kind === 'duplicate-code') callback.searchParams.append('code', 'another-code');
    if (kind === 'missing-code') callback.searchParams.delete('code');
    if (kind === 'provider-error') callback.searchParams.set('error', 'access_denied');
    const result = test.controller.acceptCallback(callback.href, 42);
    if (errorCode) await expect(result).rejects.toThrow(errorCode);
    else expect(await result).toBe(false);
    expect(test.client.request).not.toHaveBeenCalled();
    expect(test.data[TOP_RECEIPT_KEY]).toBeUndefined();
  });

  it('does not send a TOP authorization code when the exchange intent cannot be persisted', async () => {
    const test = setup('top');
    await test.controller.start({ ...bundle.application, passphrase: '123456' });
    const auth = new URL(test.open.mock.calls[0]?.[0] ?? '');
    const callback = new URL(bundle.application.callbackUrl);
    callback.search = new URLSearchParams({
      state: auth.searchParams.get('state') ?? '',
      code: 'never-sent-code'
    }).toString();
    test.write.mockRejectedValueOnce(new Error('quota'));
    await expect(test.controller.acceptCallback(callback.href, 42)).rejects.toThrow('AUTH_ACTION_FAILED');
    expect(test.client.request).not.toHaveBeenCalled();
    expect(await test.controller.acceptCallback(callback.href, 42)).toBe(false);
    expect(JSON.stringify(test.data)).not.toContain('never-sent-code');
  });

  it('keeps TOP OAuth, vault and receipts separate from the default IOP controller', async () => {
    const test = setup('top');
    const iop = { ciphertext: 'other-protocol-record' };
    test.data[IOP_VAULT_KEY] = iop;
    await test.controller.start({ ...bundle.application, passphrase: '123456' });
    const url = new URL(test.open.mock.calls[0]?.[0] ?? '');
    expect(url.origin + url.pathname).toBe('https://oauth.alibaba.com/authorize');
    expect(url.searchParams.get('view')).toBe('web');
    expect(url.searchParams.get('sp')).toBe('ICBU');
    expect(url.searchParams.get('client_id')).toBe(bundle.application.appKey);
    expect(url.searchParams.get('redirect_uri')).toBe(bundle.application.callbackUrl);
    const callback = new URL(bundle.application.callbackUrl);
    callback.search = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      code: 'top-code'
    }).toString();
    test.client.request.mockImplementationOnce((path, input) => {
      expect(path).toBe('/auth/token/create');
      expect(input).toMatchObject({ value: 'top-code', redirectUri: bundle.application.callbackUrl });
      expect(test.data[TOP_RECEIPT_KEY]).toMatchObject({ status: 'exchanging' });
      expect(test.data[IOP_RECEIPT_KEY]).toBeUndefined();
      return Promise.resolve(token);
    });
    expect(await test.controller.acceptCallback(callback.href, 42)).toBe(true);
    expect((await test.controller.export()).protocol).toBe('top');
    expect(test.data[TOP_VAULT_KEY]).toBeDefined();
    expect(test.data[TOP_RECEIPT_KEY]).toBeNull();
    expect(test.data[IOP_VAULT_KEY]).toBe(iop);
    await test.controller.clear();
    expect(test.data[TOP_VAULT_KEY]).toBeUndefined();
    expect(test.data[IOP_VAULT_KEY]).toBe(iop);
  });

  it.each(['top', 'iop'] as const)(
    'rejects the other protocol import without replacing %s data',
    async (protocol) => {
      const test = setup(protocol);
      await test.controller.import({ ...bundle, protocol }, '123456');
      const before = structuredClone(test.data);
      await expect(
        test.controller.import({ ...bundle, protocol: protocol === 'top' ? 'iop' : 'top' }, '123456')
      ).rejects.toThrow(protocol === 'top' ? 'TOP_REQUIRED' : 'IOP_REQUIRED');
      expect(test.data).toEqual(before);
      expect((await test.controller.export()).protocol).toBe(protocol);
      expect(test.client.request).not.toHaveBeenCalled();
    }
  );

  it.each(['top', 'iop'] as const)(
    'reauthorizes %s with its existing key and no replacement passphrase',
    async (protocol) => {
      const test = setup(protocol);
      const vaultKey = protocol === 'top' ? TOP_VAULT_KEY : IOP_VAULT_KEY;
      await test.controller.import({ ...bundle, protocol }, '123456');
      const original = test.data[vaultKey] as { salt: string; iv: string };
      expect((await test.controller.status()).canReauthorize).toBe(true);
      await test.controller.reauthorize();
      expect((await test.controller.status()).canReauthorize).toBe(false);
      expect(test.data[vaultKey]).toBe(original);
      expect(test.client.request).not.toHaveBeenCalled();
      const url = new URL(test.open.mock.calls[0]?.[0] ?? '');
      const callback = new URL(bundle.application.callbackUrl);
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state') ?? '',
        code: 'new-grant-code'
      }).toString();
      await test.controller.acceptCallback(callback.href, 42);
      expect(test.data[vaultKey]).toMatchObject({ salt: original.salt });
      expect((test.data[vaultKey] as { iv: string }).iv).not.toBe(original.iv);
      expect((await test.controller.status()).canReauthorize).toBe(true);
      const restarted = test.create();
      expect((await restarted.status()).canReauthorize).toBe(true);
      expect((await restarted.export()).oauth.accessToken).toBe(token.accessToken);
    }
  );

  it.each(['top', 'iop'] as const)(
    'accepts empty start passphrase only for an unlocked %s vault',
    async (protocol) => {
      const test = setup(protocol);
      const input = { ...bundle.application, passphrase: '' };
      await expect(test.controller.start(input)).rejects.toThrow();
      expect(test.open).not.toHaveBeenCalled();
      await test.controller.import({ ...bundle, protocol }, '123456');
      const vaultKey = protocol === 'top' ? TOP_VAULT_KEY : IOP_VAULT_KEY;
      const original = test.data[vaultKey] as { salt: string };
      await test.controller.start(input);
      const url = new URL(test.open.mock.calls[0]?.[0] ?? '');
      const callback = new URL(bundle.application.callbackUrl);
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state') ?? '',
        code: 'reused-key-code'
      }).toString();
      await test.controller.acceptCallback(callback.href, 42);
      expect(test.data[vaultKey]).toMatchObject({ salt: original.salt });
      await test.controller.lock();
      expect((await test.controller.status()).canReauthorize).toBe(false);
      await expect(test.controller.start(input)).rejects.toThrow();
      await test.controller.unlock('123456');
      expect((await test.controller.export()).protocol).toBe(protocol);
      expect(test.open).toHaveBeenCalledOnce();
    }
  );

  it.each(['top', 'iop'] as const)(
    'retains an unknown %s refresh receipt until a new OAuth grant is saved',
    async (protocol) => {
      const test = setup(protocol);
      const receiptKey = protocol === 'top' ? TOP_RECEIPT_KEY : IOP_RECEIPT_KEY;
      const vaultKey = protocol === 'top' ? TOP_VAULT_KEY : IOP_VAULT_KEY;
      await test.controller.import({ ...bundle, protocol }, '123456');
      const original = test.data[vaultKey];
      test.client.request.mockRejectedValueOnce(failure('NETWORK_TIMEOUT'));
      await expect(test.controller.refresh()).rejects.toThrow('NETWORK_TIMEOUT');
      const receipt = test.data[receiptKey];
      expect(await test.controller.status()).toMatchObject({
        state: 'unknown',
        canReauthorize: true,
        canRefresh: false
      });
      await expect(test.controller.refresh()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
      await test.controller.reauthorize();
      expect(test.data[receiptKey]).toBe(receipt);
      expect(test.data[vaultKey]).toBe(original);
      test.controller.cancel();
      expect(test.data[receiptKey]).toBe(receipt);
      await test.controller.reauthorize();
      const url = new URL(test.open.mock.calls[1]?.[0] ?? '');
      const callback = new URL(bundle.application.callbackUrl);
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state') ?? '',
        code: 'replacement-grant-code'
      }).toString();
      await test.controller.acceptCallback(callback.href, 42);
      expect(test.client.request.mock.calls.map(([path]) => path)).toEqual([
        '/auth/token/refresh',
        '/auth/token/create'
      ]);
      expect(test.data[receiptKey]).toBeNull();
      expect((await test.controller.status()).state).toBe('ready');
    }
  );

  it('clears a definitive TOP rejection but blocks a second attempt after an unknown exchange', async () => {
    const test = setup('top');
    await test.controller.import({ ...bundle, protocol: 'top' }, '123456');
    test.client.request.mockRejectedValueOnce(failure('TOP_TOKEN_REJECTED'));
    await expect(test.controller.refresh()).rejects.toThrow('TOP_TOKEN_REJECTED');
    expect(test.data[TOP_RECEIPT_KEY]).toBeUndefined();
    expect((await test.controller.export()).oauth.accessToken).toBe(bundle.oauth.accessToken);
    test.client.request.mockRejectedValueOnce(failure('TOP_TOKEN_RESULT_UNKNOWN'));
    await expect(test.controller.refresh()).rejects.toThrow('TOP_TOKEN_RESULT_UNKNOWN');
    await expect(test.controller.refresh()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
    expect(test.data[TOP_RECEIPT_KEY]).toBeDefined();
    expect(test.client.request).toHaveBeenCalledTimes(2);
  });

  it.each(['top', 'iop'] as const)(
    'does not lose an earlier unknown %s refresh when a fresh OAuth exchange is rejected',
    async (protocol) => {
      const test = setup(protocol);
      const receiptKey = protocol === 'top' ? TOP_RECEIPT_KEY : IOP_RECEIPT_KEY;
      await test.controller.import({ ...bundle, protocol }, '123456');
      test.client.request.mockRejectedValueOnce(failure('NETWORK_TIMEOUT'));
      await expect(test.controller.refresh()).rejects.toThrow('NETWORK_TIMEOUT');
      await test.controller.reauthorize();
      const url = new URL(test.open.mock.calls[0]?.[0] ?? '');
      const callback = new URL(bundle.application.callbackUrl);
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state') ?? '',
        code: 'rejected-new-grant-code'
      }).toString();
      const rejection = protocol === 'top' ? 'TOP_TOKEN_REJECTED' : 'IOP_TOKEN_REJECTED';
      test.client.request.mockRejectedValueOnce(failure(rejection));
      await expect(test.controller.acceptCallback(callback.href, 42)).rejects.toThrow(rejection);
      expect(test.data[receiptKey]).toBeDefined();
      expect(await test.controller.status()).toMatchObject({ state: 'unknown', canRefresh: false });
      await expect(test.controller.export()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
      await expect(test.controller.refresh()).rejects.toThrow('AUTH_REFRESH_RESULT_UNKNOWN');
      expect(test.client.request.mock.calls.map(([path]) => path)).toEqual([
        '/auth/token/refresh',
        '/auth/token/create'
      ]);
    }
  );
});
