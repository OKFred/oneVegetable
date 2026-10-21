import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAlibabaTokenResponse } from '@one-vegetable/core/credential-bundle';
import { GatewayException } from '@one-vegetable/core/errors';
import { IOP_API_ORIGIN, PUBLIC_AUTH_CALLBACK, PUBLIC_AUTH_ORIGIN } from '@one-vegetable/core/alibaba-iop';
import type * as IopModule from '@one-vegetable/core/alibaba-iop';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';
import credential from '../../../mock/data/node-gateway-credentials.json';
import { SETTINGS_STORAGE_KEY, createCredentialVault } from '@one-vegetable/core';
import { openAlibabaAuthorization } from '@one-vegetable/core/alibaba-authorization-vault';
import { AuthorizationProtection } from '../lib/authorization-protection';
import { ExtensionCredentialVaultSession } from '../lib/credential-vault-session';
import {
  IOP_VAULT_KEY,
  TOP_VAULT_KEY,
  TOP_RECEIPT_KEY,
  IOP_SESSION_KEY,
  TOP_SESSION_KEY
} from '../lib/iop-authorization-storage';

const mocks = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  return {
    data,
    access: vi.fn(() => Promise.resolve()),
    remove: vi.fn((keys: string[]) => {
      for (const key of keys) Reflect.deleteProperty(data, key);
      return Promise.resolve();
    }),
    open: vi.fn((_options: { url: string; active?: boolean }) => Promise.resolve({ id: 42, windowId: 3 })),
    getTab: vi.fn((_id: number) => Promise.resolve({ id: 7, windowId: 3, url: '' })),
    activate: vi.fn((_id: number, _options: { active: boolean }) => Promise.resolve({ id: 7, windowId: 3 })),
    focus: vi.fn((_id: number, _options: { focused: boolean }) => Promise.resolve()),
    permission: vi.fn(() => Promise.resolve(true)),
    token: vi.fn(),
    topToken: vi.fn(),
    discover: vi.fn(),
    discoverTop: vi.fn(),
    listener: vi.fn((_listener: (tabId: number, change: { url?: string }) => void) => undefined),
    applyWorkbench: vi.fn((_bundle: unknown) => Promise.resolve())
  };
});
vi.mock('../lib/top-authorization-token-client', () => ({
  TopAuthorizationTokenClient: class {
    request = mocks.topToken;
  }
}));
vi.mock('../lib/top-application-reader', () => ({ readTopApplication: mocks.discoverTop }));
vi.mock('../lib/iop-application-reader', () => ({
  IOP_APPLICATION_READER_ORIGINS: [
    'https://i.alibaba.com/*',
    'https://openapi.alibaba.com/*',
    'https://openapi-account.alibaba.com/*'
  ],
  IopApplicationReader: class {
    read = mocks.discover;
  }
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'local-test-extension',
      getURL: (path: string) => `chrome-extension://local-test-extension${path}`,
      getContexts: async (filter: { tabIds: number[] }) => {
        const tab = await mocks.getTab(filter.tabIds[0] ?? -1);
        return [{ tabId: tab.id, windowId: tab.windowId, documentUrl: tab.url }];
      }
    },
    tabs: {
      create: mocks.open,
      get: mocks.getTab,
      update: mocks.activate,
      onUpdated: { addListener: mocks.listener }
    },
    windows: { update: mocks.focus },
    permissions: { contains: mocks.permission },
    storage: {
      local: {
        setAccessLevel: mocks.access,
        get: (key: string) => Promise.resolve({ [key]: mocks.data[key] }),
        set: (values: Record<string, unknown>) => {
          Object.assign(mocks.data, values);
          return Promise.resolve();
        },
        remove: mocks.remove
      }
    }
  }
}));
vi.mock('@one-vegetable/core/alibaba-iop', async (original) => {
  const module = await original<typeof IopModule>();
  return {
    ...module,
    AlibabaIopTokenClient: class {
      request = mocks.token;
    }
  };
});
import {
  handleAuthorization,
  configureAuthorizationProtection,
  configureAuthorizationWorkbench,
  rotateAuthorizationProtection,
  handlePublicAuthorization,
  lockAllAlibabaAuthorizations,
  resetIopAuthorization
} from '../lib/iop-authorization-runtime';
const navigationListener = mocks.listener.mock.calls[0]?.[0];

const trusted = {
  id: 'local-test-extension',
  url: 'chrome-extension://local-test-extension/authorization.html'
};
function command(action: string, payload: unknown = {}, protocol?: 'top' | 'iop') {
  return {
    kind: 'iop-authorization-request',
    requestId: crypto.randomUUID(),
    action,
    payload,
    ...(protocol ? { protocol } : {})
  };
}
function external(action: string, extra: Record<string, unknown> = {}) {
  return { kind: 'one-vegetable-public-auth', requestId: crypto.randomUUID(), action, ...extra };
}
beforeEach(async () => {
  configureAuthorizationWorkbench(mocks.applyWorkbench);
  await resetIopAuthorization();
  for (const key of Object.keys(mocks.data)) Reflect.deleteProperty(mocks.data, key);
  const storage = {
    get: (key: string) => Promise.resolve({ [key]: mocks.data[key] }),
    set: (items: Record<string, unknown>) => {
      Object.assign(mocks.data, items);
      return Promise.resolve();
    },
    remove: (key: string) => {
      Reflect.deleteProperty(mocks.data, key);
      return Promise.resolve();
    }
  };
  const protection = new AuthorizationProtection(storage, new ExtensionCredentialVaultSession(storage));
  configureAuthorizationProtection({
    prepare: (passphrase) => protection.prepare(passphrase),
    adopt: (vault) => protection.adopt(vault),
    status: () => Promise.resolve({ state: mocks.data[SETTINGS_STORAGE_KEY] ? 'unlocked' : 'empty' }),
    prepareStatus: async (passphrase) => {
      await protection.prepare(passphrase);
      return { state: 'unlocked' };
    }
  });
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.token.mockResolvedValue(parseAlibabaTokenResponse(tokens.success));
  mocks.topToken.mockResolvedValue(parseAlibabaTokenResponse(tokens.success));
  mocks.getTab.mockResolvedValue({ id: 7, windowId: 3, url: trusted.url });
  mocks.activate.mockResolvedValue({ id: 7, windowId: 3 });
  mocks.focus.mockResolvedValue();
  mocks.applyWorkbench.mockResolvedValue();
});
afterEach(async () => {
  await resetIopAuthorization();
});

it('rotates shared protection atomically without unlocking a manually locked protocol or losing receipts', async () => {
  for (const protocol of ['top', 'iop'] as const) {
    expect(
      await handleAuthorization(
        command(
          'import',
          {
            bundle: { ...credential.oauthBundle, protocol },
            passphrase: '123456'
          },
          protocol
        ),
        trusted
      )
    ).toMatchObject({ ok: true });
  }
  const opened = await openAlibabaAuthorization(mocks.data[IOP_VAULT_KEY], '123456', 'iop');
  await handleAuthorization(command('lock', {}, 'top'), trusted);
  const receipt = { requestId: crypto.randomUUID(), status: 'sending', timeUtc: Date.now() };
  mocks.data[TOP_RECEIPT_KEY] = receipt;
  const next = await createCredentialVault(
    {
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: 'https://eco.taobao.com/router/rest',
      signMethod: 'hmac'
    },
    'new-fixture-passphrase'
  );
  await rotateAuthorizationProtection(
    opened.sessionKeyMaterial,
    {
      key: next.key,
      sessionKeyMaterial: next.sessionKeyMaterial,
      salt: next.record.kdf.salt
    },
    async (patch) => {
      expect(
        await handleAuthorization(
          command(
            'import',
            {
              bundle: { ...credential.oauthBundle, protocol: 'iop' },
              passphrase: ''
            },
            'iop'
          ),
          trusted
        )
      ).toMatchObject({ ok: false, error: { code: 'AUTH_TASK_ACTIVE' } });
      Object.assign(mocks.data, patch);
    }
  );
  expect(mocks.data[TOP_RECEIPT_KEY]).toEqual(receipt);
  expect(mocks.data[TOP_SESSION_KEY]).toBeNull();
  expect(await handleAuthorization(command('status', {}, 'top'), trusted)).toMatchObject({
    ok: true,
    data: { state: 'locked' }
  });
  for (const protocol of ['top', 'iop'] as const) {
    const key = protocol === 'top' ? TOP_VAULT_KEY : IOP_VAULT_KEY;
    expect(
      (await openAlibabaAuthorization(mocks.data[key], 'new-fixture-passphrase', protocol)).bundle.protocol
    ).toBe(protocol);
    await expect(openAlibabaAuthorization(mocks.data[key], '123456', protocol)).rejects.toThrow(
      'AUTH_UNLOCK_FAILED'
    );
  }
});

describe('narrow public authorization bridge', () => {
  it('clear-all cancels the pending callback before removing local credentials', async () => {
    await handleAuthorization(
      command('start', {
        ...credential.oauthBundle.application,
        callbackUrl: PUBLIC_AUTH_CALLBACK,
        passphrase: '123456'
      }),
      trusted
    );
    const state = new URL(mocks.open.mock.calls[0]?.[0].url ?? '').searchParams.get('state') ?? '';
    await resetIopAuthorization();
    expect(await handleAuthorization(command('status'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'empty' }
    });
    expect(
      await handlePublicAuthorization(external('callback', { state, code: 'fixture-code' }), {
        url: PUBLIC_AUTH_CALLBACK,
        tab: { id: 42 }
      })
    ).toMatchObject({ data: { received: false } });
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it('only lets the exact Pages origin probe or open the local tool', async () => {
    expect(
      await handlePublicAuthorization(external('probe'), { url: `${PUBLIC_AUTH_ORIGIN}/` })
    ).toMatchObject({ ok: true });
    expect(
      await handlePublicAuthorization(external('open'), { url: `${PUBLIC_AUTH_ORIGIN}/` })
    ).toMatchObject({ ok: true });
    expect(mocks.open).toHaveBeenCalledWith({ url: trusted.url });
    for (const url of [
      'https://evil.example/',
      'https://one-vegetable-auth.pages.dev.evil.example/',
      'http://one-vegetable-auth.pages.dev/'
    ])
      expect(await handlePublicAuthorization(external('probe'), { url })).toMatchObject({ ok: false });
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it('never exposes status, export, import, refresh or secrets to a webpage', async () => {
    for (const action of [
      'status',
      'export',
      'import',
      'refresh',
      'reauthorize',
      'discover-application',
      'clear',
      'unlock'
    ])
      expect(
        await handlePublicAuthorization(external(action), { url: `${PUBLIC_AUTH_ORIGIN}/` })
      ).toMatchObject({ ok: false });
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it('only trusts the standalone extension tool, not content scripts or the workbench', async () => {
    for (const sender of [
      { id: trusted.id, url: 'https://i.alibaba.com/' },
      { id: trusted.id, url: 'chrome-extension://local-test-extension/options.html' },
      { id: 'other-extension', url: trusted.url },
      { url: trusted.url },
      { id: trusted.id, url: 'chrome-extension://local-test-extension/authorization.html/extra' },
      { id: trusted.id, url: 'https://local-test-extension/authorization.html' },
      { id: trusted.id, url: 'chrome-extension://another-extension/authorization.html' }
    ])
      expect(await handleAuthorization(command('export'), sender)).toMatchObject({
        ok: false,
        error: { code: 'AUTH_ORIGIN_DENIED' }
      });
  });
  it('requires a valid request ID and user-granted exact origins before opening OAuth', async () => {
    expect(
      await handleAuthorization({ ...command('status'), requestId: 'injected\nlog' }, trusted)
    ).toMatchObject({ ok: false });
    mocks.permission.mockResolvedValue(false);
    expect(
      await handleAuthorization(
        command('start', {
          ...credential.oauthBundle.application,
          callbackUrl: PUBLIC_AUTH_CALLBACK,
          passphrase: '123456'
        }),
        trusted
      )
    ).toMatchObject({ ok: false, error: { code: 'AUTH_PERMISSION_REQUIRED' } });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it('requires exact callback path, known tab and state; never reuses an authorization code', async () => {
    expect(
      await handleAuthorization(
        command('start', {
          ...credential.oauthBundle.application,
          callbackUrl: PUBLIC_AUTH_CALLBACK,
          passphrase: '123456'
        }),
        trusted
      )
    ).toMatchObject({ ok: true });
    const state = new URL(mocks.open.mock.calls[0]?.[0].url ?? '').searchParams.get('state') ?? '';
    const message = external('callback', { state, code: 'fixture-code' });
    expect(
      await handlePublicAuthorization(message, { url: `${PUBLIC_AUTH_ORIGIN}/`, tab: { id: 42 } })
    ).toMatchObject({ ok: false });
    expect(
      await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK, tab: { id: 43 } })
    ).toMatchObject({ data: { received: false } });
    expect(
      await handlePublicAuthorization(
        { ...message, state: 'wrong-state' },
        { url: PUBLIC_AUTH_CALLBACK, tab: { id: 42 } }
      )
    ).toMatchObject({ ok: false });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(
      await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK, tab: { id: 42 } })
    ).toMatchObject({ ok: true, data: { received: true } });
    expect(
      await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK, tab: { id: 42 } })
    ).toMatchObject({ data: { received: false } });
    expect(mocks.token).toHaveBeenCalledOnce();
    const status = await handleAuthorization(command('status'), trusted);
    expect(status).toMatchObject({ ok: true, data: { state: 'ready' } });
    expect(JSON.stringify(status)).not.toContain(tokens.success.access_token);
    expect(JSON.stringify(mocks.data)).not.toContain('fixture-code');
    expect(JSON.stringify(mocks.data)).not.toContain(tokens.success.refresh_token);
  });
});

describe('apply the selected standalone bundle to the workbench', () => {
  for (const protocol of ['top', 'iop'] as const) {
    it(`${protocol}: applies only on an explicit trusted action, without exporting secrets or calling Alibaba`, async () => {
      const bundle = { ...credential.oauthBundle, protocol };
      await handleAuthorization(command('import', { bundle, passphrase: '123456' }, protocol), trusted);
      expect(mocks.applyWorkbench).not.toHaveBeenCalled();
      const result = await handleAuthorization(
        command('apply-to-workbench', { bundle: { arbitrary: true } }, protocol),
        trusted
      );
      expect(result).toMatchObject({ ok: true, data: { applied: true, protocol } });
      expect(mocks.applyWorkbench).toHaveBeenCalledExactlyOnceWith(bundle);
      expect(mocks.permission).toHaveBeenLastCalledWith({
        origins: [`${protocol === 'iop' ? IOP_API_ORIGIN : 'https://eco.taobao.com'}/*`]
      });
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.topToken).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(bundle.application.appSecret);
      expect(JSON.stringify(result)).not.toContain(bundle.oauth.accessToken);
    });
    it(`${protocol}: rejects denied business permission and preserves the standalone bundle on save failure`, async () => {
      const bundle = { ...credential.oauthBundle, protocol };
      await handleAuthorization(command('import', { bundle, passphrase: '123456' }, protocol), trusted);
      const before = JSON.stringify(mocks.data);
      mocks.permission.mockResolvedValueOnce(false);
      expect(await handleAuthorization(command('apply-to-workbench', {}, protocol), trusted)).toMatchObject({
        ok: false,
        error: { code: 'AUTH_PERMISSION_REQUIRED' }
      });
      expect(mocks.applyWorkbench).not.toHaveBeenCalled();
      expect(JSON.stringify(mocks.data)).toBe(before);
      mocks.applyWorkbench.mockRejectedValueOnce(new Error('CREDENTIAL_VAULT_LOCKED'));
      expect(await handleAuthorization(command('apply-to-workbench', {}, protocol), trusted)).toMatchObject({
        ok: false,
        error: { code: 'CREDENTIAL_VAULT_LOCKED' }
      });
      expect(JSON.stringify(mocks.data)).toBe(before);
      expect(await handleAuthorization(command('export', {}, protocol), trusted)).toMatchObject({
        ok: true,
        data: bundle
      });
      expect(await handleAuthorization(command('apply-to-workbench', {}, protocol), trusted)).toMatchObject({
        ok: true
      });
      expect(await handleAuthorization(command('status', {}, protocol), trusted)).toMatchObject({
        data: { errorCode: null }
      });
    });
  }
  it('rejects websites, the workbench and public callback bridge as apply callers', async () => {
    for (const source of [
      { id: trusted.id, url: 'https://example.com/' },
      { id: trusted.id, url: 'chrome-extension://local-test-extension/options.html' },
      { id: 'another-extension', url: trusted.url }
    ])
      expect(await handleAuthorization(command('apply-to-workbench'), source)).toMatchObject({
        ok: false,
        error: { code: 'AUTH_ORIGIN_DENIED' }
      });
    expect(
      await handlePublicAuthorization(external('apply-to-workbench'), {
        url: PUBLIC_AUTH_CALLBACK,
        tab: { id: 42 }
      })
    ).toMatchObject({ ok: false });
    expect(mocks.applyWorkbench).not.toHaveBeenCalled();
  });
  it('never applies an empty, locked or unresolved bundle', async () => {
    expect(await handleAuthorization(command('apply-to-workbench'), trusted)).toMatchObject({ ok: false });
    await handleAuthorization(
      command('import', { bundle: { ...credential.oauthBundle, protocol: 'iop' }, passphrase: '123456' }),
      trusted
    );
    mocks.data['one-vegetable-iop-refresh-receipt-v1'] = {
      status: 'sending',
      requestId: crypto.randomUUID()
    };
    expect(await handleAuthorization(command('apply-to-workbench'), trusted)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_REFRESH_RESULT_UNKNOWN' }
    });
    await handleAuthorization(command('lock'), trusted);
    expect(await handleAuthorization(command('apply-to-workbench'), trusted)).toMatchObject({ ok: false });
    expect(mocks.applyWorkbench).not.toHaveBeenCalled();
  });
  it('does not apply twice or refresh while a workbench save is in flight', async () => {
    await handleAuthorization(
      command('import', { bundle: { ...credential.oauthBundle, protocol: 'iop' }, passphrase: '123456' }),
      trusted
    );
    let finish: (() => void) | undefined;
    mocks.applyWorkbench.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const applying = handleAuthorization(command('apply-to-workbench'), trusted);
    await vi.waitFor(() => {
      expect(mocks.applyWorkbench).toHaveBeenCalledOnce();
    });
    expect(await handleAuthorization(command('apply-to-workbench'), trusted)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_TASK_ACTIVE' }
    });
    expect(await handleAuthorization(command('refresh'), trusted)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_TASK_ACTIVE' }
    });
    finish?.();
    expect(await applying).toMatchObject({ ok: true });
    expect(mocks.token).not.toHaveBeenCalled();
  });
});

describe('return to the initiating authorization tool', () => {
  async function start(protocol: 'top' | 'iop', callbackUrl = PUBLIC_AUTH_CALLBACK) {
    mocks.getTab.mockResolvedValue({ id: 7, windowId: 3, url: `${trusted.url}?protocol=${protocol}` });
    expect(
      await handleAuthorization(
        {
          ...command(
            'start',
            { ...credential.oauthBundle.application, callbackUrl, passphrase: '123456' },
            protocol
          ),
          toolTabId: 7
        },
        trusted
      )
    ).toMatchObject({ ok: true });
    return new URL(mocks.open.mock.calls[0]?.[0].url ?? '').searchParams.get('state') ?? '';
  }
  async function receive(state: string, extra: Record<string, string> = { code: 'fixture-authorized-code' }) {
    return handlePublicAuthorization(external('callback', { state, ...extra }), {
      url: PUBLIC_AUTH_CALLBACK,
      tab: { id: 42 }
    });
  }
  for (const protocol of ['top', 'iop'] as const) {
    it(`${protocol}: returns once to the same tab and window without navigating or closing callback`, async () => {
      const state = await start(protocol);
      expect(await receive(state)).toMatchObject({ ok: true, data: { received: true } });
      await vi.waitFor(() => {
        expect(mocks.focus).toHaveBeenCalledExactlyOnceWith(3, { focused: true });
      });
      expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(7, { active: true });
      expect(mocks.open).toHaveBeenCalledOnce();
      expect(await receive(state)).toMatchObject({ data: { received: false } });
      expect(mocks.activate).toHaveBeenCalledOnce();
    });
    it(`${protocol}: observes arbitrary registered callbacks through tabs.onUpdated`, async () => {
      const state = await start(protocol, 'https://example.com/merchant-callback');
      expect(navigationListener).toBeTypeOf('function');
      const url = `https://example.com/merchant-callback?state=${state}&code=fixture-authorized-code`;
      navigationListener?.(43, { url });
      navigationListener?.(42, { url: url.replace(state, 'wrong-state') });
      navigationListener?.(42, { url: url.replace('/merchant-callback?', '/different?') });
      expect(mocks.activate).not.toHaveBeenCalled();
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.topToken).not.toHaveBeenCalled();
      navigationListener?.(42, { url });
      navigationListener?.(42, { url });
      await vi.waitFor(() => {
        expect(mocks.activate).toHaveBeenCalledOnce();
      });
      await vi.waitFor(() => {
        expect(protocol === 'iop' ? mocks.token : mocks.topToken).toHaveBeenCalledOnce();
      });
    });
    it(`${protocol}: returns for provider denial and token failure without claiming success`, async () => {
      const state = await start(protocol);
      expect(await receive(state, { error: 'denied' })).toMatchObject({ ok: false });
      await vi.waitFor(() => {
        expect(mocks.activate).toHaveBeenCalledOnce();
      });
      expect(await handleAuthorization(command('status', {}, protocol), trusted)).toMatchObject({
        data: { errorCode: 'OAUTH_PROVIDER_ERROR', state: 'empty' }
      });
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.topToken).not.toHaveBeenCalled();
      const client = protocol === 'iop' ? mocks.token : mocks.topToken;
      client.mockRejectedValueOnce(
        new GatewayException({
          code: protocol === 'iop' ? 'IOP_TOKEN_REJECTED' : 'TOP_TOKEN_REJECTED',
          message: 'rejected',
          retryable: false
        })
      );
      mocks.open.mockClear();
      const nextState = await start(protocol);
      expect(await receive(nextState)).toMatchObject({ ok: false });
      await vi.waitFor(() => {
        expect(mocks.activate).toHaveBeenCalledTimes(2);
      });
      expect(await handleAuthorization(command('status', {}, protocol), trusted)).toMatchObject({
        data: { state: 'empty', errorCode: protocol === 'iop' ? 'IOP_TOKEN_REJECTED' : 'TOP_TOKEN_REJECTED' }
      });
    });
  }
  it('does not steal focus for wrong state, tab, callback or cancelled tasks', async () => {
    const state = await start('iop');
    await receive('wrong-state');
    await handlePublicAuthorization(external('callback', { state, code: 'fixture-code' }), {
      url: PUBLIC_AUTH_CALLBACK,
      tab: { id: 43 }
    });
    await handlePublicAuthorization(external('callback', { state, code: 'fixture-code' }), {
      url: `${PUBLIC_AUTH_CALLBACK}/different`,
      tab: { id: 42 }
    });
    await handleAuthorization(command('cancel'), trusted);
    await receive(state);
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.focus).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it.each(['closed', 'navigated', 'other-protocol'])(
    'opens only a clean result tool when source is %s',
    async (reason) => {
      const state = await start('iop');
      if (reason === 'closed') mocks.getTab.mockRejectedValueOnce(new Error('No tab'));
      else
        mocks.getTab.mockResolvedValueOnce({
          id: 7,
          windowId: 3,
          url: reason === 'navigated' ? 'https://example.com/' : `${trusted.url}?protocol=top`
        });
      await receive(state);
      await vi.waitFor(() => {
        expect(mocks.open).toHaveBeenCalledTimes(2);
      });
      expect(mocks.activate).not.toHaveBeenCalled();
      expect(mocks.open).toHaveBeenLastCalledWith({ url: `${trusted.url}?protocol=iop`, active: true });
      expect(JSON.stringify(mocks.open.mock.calls.slice(1))).not.toMatch(
        /fixture-authorized-code|access_token|state=/u
      );
    }
  );
  it('a focus failure cannot turn successful token exchange into a failure', async () => {
    const state = await start('iop');
    mocks.focus.mockRejectedValueOnce(new Error('window closed'));
    expect(await receive(state)).toMatchObject({ data: { received: true } });
    expect(await handleAuthorization(command('status'), trusted)).toMatchObject({
      data: { state: 'ready', errorCode: null }
    });
    expect(mocks.token).toHaveBeenCalledOnce();
  });
  it('reauthorization returns to the tool which initiated renewal', async () => {
    await handleAuthorization(
      command('import', { bundle: credential.oauthBundle, passphrase: '123456' }, 'top'),
      trusted
    );
    mocks.getTab.mockResolvedValue({ id: 7, windowId: 3, url: `${trusted.url}?protocol=top` });
    expect(
      await handleAuthorization({ ...command('reauthorize', {}, 'top'), toolTabId: 7 }, trusted)
    ).toMatchObject({ ok: true });
    const state = new URL(mocks.open.mock.calls[0]?.[0].url ?? '').searchParams.get('state') ?? '';
    const callback = `${credential.oauthBundle.application.callbackUrl}?state=${state}&code=fixture-authorized-code`;
    navigationListener?.(42, { url: callback });
    await vi.waitFor(() => {
      expect(mocks.activate).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(mocks.topToken).toHaveBeenCalledOnce();
    });
  });
});

describe('explicit standalone protocol selection', () => {
  it('locks both protocols for the workbench and only the selected protocol for the tool', async () => {
    for (const protocol of ['top', 'iop'] as const)
      expect(
        await handleAuthorization(
          command(
            'import',
            { bundle: { ...credential.oauthBundle, protocol }, passphrase: '123456' },
            protocol
          ),
          trusted
        )
      ).toMatchObject({ ok: true });
    await handleAuthorization(command('lock', {}, 'top'), trusted);
    expect(mocks.data[TOP_SESSION_KEY]).toBeUndefined();
    expect(mocks.data[IOP_SESSION_KEY]).toBeDefined();
    expect(await handleAuthorization(command('export', {}, 'top'), trusted)).toMatchObject({ ok: false });
    expect(await handleAuthorization(command('export', {}, 'iop'), trusted)).toMatchObject({ ok: true });
    await handleAuthorization(command('unlock', { passphrase: '123456' }, 'top'), trusted);
    mocks.remove.mockRejectedValueOnce(new Error('disk failure'));
    await expect(lockAllAlibabaAuthorizations()).rejects.toThrow('AUTH_ACTION_FAILED');
    expect(mocks.data[TOP_SESSION_KEY]).toBeUndefined();
    expect(mocks.data[IOP_SESSION_KEY]).toBeDefined();
    for (const protocol of ['top', 'iop'] as const)
      expect(await handleAuthorization(command('export', {}, protocol), trusted)).toMatchObject({
        ok: false
      });
    await lockAllAlibabaAuthorizations();
    expect(mocks.data[TOP_SESSION_KEY]).toBeUndefined();
    expect(mocks.data[IOP_SESSION_KEY]).toBeUndefined();
    expect(mocks.data[TOP_VAULT_KEY]).toBeDefined();
    expect(mocks.data[IOP_VAULT_KEY]).toBeDefined();
  });

  it('fails closed if trusted storage isolation fails and retries enforcement before access', async () => {
    vi.resetModules();
    const isolated = await import('../lib/iop-authorization-runtime');
    mocks.access.mockRejectedValueOnce(new Error('access denied'));
    expect(await isolated.handleAuthorization(command('status'), trusted)).toMatchObject({ ok: false });
    expect(mocks.data[IOP_SESSION_KEY]).toBeUndefined();
    expect(await isolated.handleAuthorization(command('status'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'empty' }
    });
    expect(mocks.access).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    await isolated.resetIopAuthorization();
  });

  it('keeps a legacy protocol-omitted request on IOP and never invokes TOP', async () => {
    await handleAuthorization(
      command('import', {
        bundle: {
          ...credential.oauthBundle,
          protocol: 'iop',
          oauth: { ...credential.oauthBundle.oauth, refreshToken: tokens.success.refresh_token }
        },
        passphrase: '123456'
      }),
      trusted
    );
    expect(await handleAuthorization(command('refresh'), trusted)).toMatchObject({ ok: true });
    expect(mocks.token).toHaveBeenCalledWith(
      '/auth/token/refresh',
      expect.objectContaining({
        appKey: credential.oauthBundle.application.appKey
      })
    );
    expect(mocks.permission).toHaveBeenCalledWith({ origins: [`${IOP_API_ORIGIN}/*`] });
    expect(mocks.topToken).not.toHaveBeenCalled();
    expect(mocks.data[TOP_VAULT_KEY]).toBeUndefined();
  });

  it('rejects invalid protocol values before touching storage or opening a tab', async () => {
    for (const protocol of ['TOP', 'IOP', 'other', '', null, {}, false]) {
      expect(await handleAuthorization({ ...command('start'), protocol }, trusted)).toMatchObject({
        ok: false,
        error: { code: 'AUTH_INPUT_INVALID' }
      });
    }
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.topToken).not.toHaveBeenCalled();
  });

  it('imports, refreshes and clears TOP independently without overwriting IOP', async () => {
    const oauth = { ...credential.oauthBundle.oauth, refreshToken: tokens.success.refresh_token };
    await handleAuthorization(
      command('import', {
        bundle: { ...credential.oauthBundle, protocol: 'iop', oauth },
        passphrase: '123456'
      }),
      trusted
    );
    const iopRecord = mocks.data[IOP_VAULT_KEY];
    await handleAuthorization(
      command('import', { bundle: { ...credential.oauthBundle, oauth }, passphrase: '123456' }, 'top'),
      trusted
    );
    expect(await handleAuthorization(command('refresh', {}, 'top'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'ready' }
    });
    expect(mocks.topToken).toHaveBeenCalledOnce();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.permission).toHaveBeenCalledWith({ origins: ['https://oauth.alibaba.com/*'] });
    expect(mocks.data[IOP_VAULT_KEY]).toBe(iopRecord);
    expect(await handleAuthorization(command('clear', {}, 'top'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'empty' }
    });
    expect(mocks.data[TOP_VAULT_KEY]).toBeUndefined();
    expect(mocks.data[IOP_VAULT_KEY]).toBe(iopRecord);
  });

  it('reauthorizes only the requested unlocked protocol and checks its exact callback permission', async () => {
    await handleAuthorization(
      command('import', { bundle: credential.oauthBundle, passphrase: '123456' }, 'top'),
      trusted
    );
    expect(await handleAuthorization(command('status', {}, 'top'), trusted)).toMatchObject({
      ok: true,
      data: { canReauthorize: true }
    });
    mocks.permission.mockResolvedValueOnce(false);
    expect(await handleAuthorization(command('reauthorize', {}, 'top'), trusted)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_PERMISSION_REQUIRED' }
    });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(await handleAuthorization(command('reauthorize', {}, 'top'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'waiting', canReauthorize: false }
    });
    expect(mocks.permission).toHaveBeenLastCalledWith({
      origins: ['https://oauth.alibaba.com/*', 'https://example.com/*']
    });
    expect(new URL(mocks.open.mock.calls[0]?.[0].url ?? '').origin).toBe('https://oauth.alibaba.com');
    expect(await handleAuthorization(command('status'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'empty' }
    });
    expect(mocks.topToken).not.toHaveBeenCalled();
  });

  it('uses an unlocked TOP key when start receives an empty passphrase, but refuses it after lock', async () => {
    await handleAuthorization(
      command('import', { bundle: credential.oauthBundle, passphrase: '123456' }, 'top'),
      trusted
    );
    const payload = { ...credential.oauthBundle.application, passphrase: '' };
    expect(await handleAuthorization(command('start', payload, 'top'), trusted)).toMatchObject({
      ok: true,
      data: { state: 'waiting' }
    });
    await handleAuthorization(command('cancel', {}, 'top'), trusted);
    await handleAuthorization(command('lock', {}, 'top'), trusted);
    expect(await handleAuthorization(command('start', payload, 'top'), trusted)).toMatchObject({ ok: false });
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.topToken).not.toHaveBeenCalled();
  });

  it('accepts a TOP callback only for its bound tab and state, exactly once', async () => {
    await handleAuthorization(
      command(
        'start',
        { ...credential.oauthBundle.application, callbackUrl: PUBLIC_AUTH_CALLBACK, passphrase: '123456' },
        'top'
      ),
      trusted
    );
    const url = new URL(mocks.open.mock.calls[0]?.[0].url ?? '');
    const state = url.searchParams.get('state') ?? '';
    const message = external('callback', { state, code: 'top-fixture-code' });
    expect(
      await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK, tab: { id: 43 } })
    ).toMatchObject({ ok: true, data: { received: false } });
    expect(
      await handlePublicAuthorization(
        { ...message, state: 'wrong-state' },
        { url: PUBLIC_AUTH_CALLBACK, tab: { id: 42 } }
      )
    ).toMatchObject({ ok: false });
    expect(
      await handlePublicAuthorization(message, {
        url: `${PUBLIC_AUTH_ORIGIN}/callback/extra`,
        tab: { id: 42 }
      })
    ).toMatchObject({ ok: false });
    expect(await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK })).toMatchObject({
      ok: false
    });
    expect(mocks.topToken).not.toHaveBeenCalled();
    expect(
      await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK, tab: { id: 42 } })
    ).toMatchObject({ ok: true, data: { received: true } });
    expect(
      await handlePublicAuthorization(message, { url: PUBLIC_AUTH_CALLBACK, tab: { id: 42 } })
    ).toMatchObject({ ok: true, data: { received: false } });
    expect(mocks.topToken).toHaveBeenCalledOnce();
    expect(mocks.token).not.toHaveBeenCalled();
    const data = await handleAuthorization(command('export', {}, 'top'), trusted);
    expect(data).toMatchObject({ ok: true, data: { protocol: 'top' } });
    expect(JSON.stringify(mocks.data)).not.toContain('top-fixture-code');
    expect(mocks.data[TOP_RECEIPT_KEY]).toBeNull();
  });

  it('resets both independent stores and pending callbacks through the trusted clear-all workflow', async () => {
    for (const protocol of ['top', 'iop'] as const)
      await handleAuthorization(
        command(
          'import',
          { bundle: { ...credential.oauthBundle, protocol }, passphrase: '123456' },
          protocol
        ),
        trusted
      );
    expect(mocks.data[TOP_VAULT_KEY]).toBeDefined();
    expect(mocks.data[IOP_VAULT_KEY]).toBeDefined();
    expect(mocks.data[TOP_SESSION_KEY]).toBeDefined();
    expect(mocks.data[IOP_SESSION_KEY]).toBeDefined();
    await resetIopAuthorization();
    expect(mocks.data[TOP_VAULT_KEY]).toBeUndefined();
    expect(mocks.data[IOP_VAULT_KEY]).toBeUndefined();
    expect(mocks.data[TOP_SESSION_KEY]).toBeUndefined();
    expect(mocks.data[IOP_SESSION_KEY]).toBeUndefined();
    for (const protocol of ['top', 'iop'] as const)
      expect(await handleAuthorization(command('status', {}, protocol), trusted)).toMatchObject({
        ok: true,
        data: { state: 'empty', canReauthorize: false }
      });
  });

  it('only permits IOP application discovery from the trusted tool with all exact host permissions', async () => {
    for (const sender of [
      { id: trusted.id, url: 'https://i.alibaba.com/' },
      { id: trusted.id, url: 'chrome-extension://local-test-extension/options.html' }
    ])
      expect(await handleAuthorization(command('discover-application'), sender)).toMatchObject({
        ok: false,
        error: { code: 'AUTH_ORIGIN_DENIED' }
      });
    mocks.permission.mockResolvedValueOnce(false);
    expect(await handleAuthorization(command('discover-application'), trusted)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_PERMISSION_REQUIRED' }
    });
    expect(mocks.discover).not.toHaveBeenCalled();
    mocks.discover.mockResolvedValueOnce(credential.oauthBundle.application);
    expect(await handleAuthorization(command('discover-application'), trusted)).toMatchObject({
      ok: true,
      data: credential.oauthBundle.application
    });
    expect(mocks.permission).toHaveBeenLastCalledWith({
      origins: [
        'https://i.alibaba.com/*',
        'https://openapi.alibaba.com/*',
        'https://openapi-account.alibaba.com/*'
      ]
    });
    expect(mocks.discover).toHaveBeenCalledOnce();
    expect(mocks.discoverTop).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.topToken).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.data)).not.toContain(credential.oauthBundle.application.appSecret);
  });

  it('discovers TOP only through its dedicated reader and exact legacy origins', async () => {
    const { appName, appKey, appSecret, callbackUrl } = credential.oauthBundle.application;
    const application = { appName, appKey, appSecret, callbackUrl };
    mocks.discoverTop.mockResolvedValueOnce(application);
    const request = command('discover-application', {}, 'top');
    expect(await handleAuthorization(request, trusted)).toMatchObject({
      requestId: request.requestId,
      ok: true,
      data: application
    });
    expect(mocks.permission).toHaveBeenCalledExactlyOnceWith({
      origins: ['https://crosstrade.alibaba.com/*']
    });
    expect(mocks.discoverTop).toHaveBeenCalledOnce();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.topToken).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.data)).not.toContain(appSecret);
  });

  it('rejects TOP discovery before reading if exact TOP permissions are absent', async () => {
    mocks.permission.mockResolvedValueOnce(false);
    expect(await handleAuthorization(command('discover-application', {}, 'top'), trusted)).toMatchObject({
      ok: false,
      error: { code: 'AUTH_PERMISSION_REQUIRED' }
    });
    expect(mocks.permission).toHaveBeenCalledExactlyOnceWith({
      origins: ['https://crosstrade.alibaba.com/*']
    });
    expect(mocks.discoverTop).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.topToken).not.toHaveBeenCalled();
  });

  it('does not expose TOP discovery to content scripts, options or external webpages', async () => {
    for (const sender of [
      { id: trusted.id, url: 'https://crosstrade.alibaba.com/ecology/index.htm' },
      { id: trusted.id, url: 'https://i.alibaba.com/explore/open-api' },
      { id: trusted.id, url: 'chrome-extension://local-test-extension/options.html' },
      { id: 'other-extension', url: trusted.url }
    ])
      expect(await handleAuthorization(command('discover-application', {}, 'top'), sender)).toMatchObject({
        ok: false,
        error: { code: 'AUTH_ORIGIN_DENIED' }
      });
    expect(
      await handlePublicAuthorization(
        { ...external('discover-application'), protocol: 'top' },
        { url: `${PUBLIC_AUTH_ORIGIN}/` }
      )
    ).toMatchObject({ ok: false });
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.discoverTop).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
