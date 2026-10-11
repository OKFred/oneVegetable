import { describe, expect, it, vi } from 'vitest';
import {
  IopAuthorizationController,
  IOP_VAULT_KEY,
  IOP_RECEIPT_KEY,
  failure,
  parseCallback
} from '../lib/iop-authorization';
import type { AuthorizationStorage } from '../lib/iop-authorization';
import credential from '../../../mock/data/node-gateway-credentials.json';
import {
  parseAlibabaOpenApiCredentialBundle,
  parseAlibabaTokenResponse
} from '@one-vegetable/core/credential-bundle';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';

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
function setup() {
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
  const client = { request: vi.fn(() => Promise.resolve(token)) };
  const open = vi.fn((_url: string) => Promise.resolve(42));
  const create = () => new IopAuthorizationController(storage, client, open, () => now);
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
  it('persists rotated tokens encrypted, and requires unlock after worker restart', async () => {
    const s = setup();
    await s.controller.import(bundle, '123456');
    await s.controller.refresh();
    expect((await s.controller.export()).oauth.accessToken).toBe(token.accessToken);
    expect(JSON.stringify(s.data)).not.toContain(token.accessToken);
    const restarted = s.create();
    expect((await restarted.status()).state).toBe('locked');
    await restarted.unlock('123456');
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
