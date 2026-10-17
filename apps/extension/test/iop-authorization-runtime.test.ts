import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAlibabaTokenResponse } from '@one-vegetable/core/credential-bundle';
import { IOP_API_ORIGIN, PUBLIC_AUTH_CALLBACK, PUBLIC_AUTH_ORIGIN } from '@one-vegetable/core/alibaba-iop';
import type * as IopModule from '@one-vegetable/core/alibaba-iop';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';
import credential from '../../../mock/data/node-gateway-credentials.json';
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
    open: vi.fn((_options: { url: string }) => Promise.resolve({ id: 42 })),
    permission: vi.fn(() => Promise.resolve(true)),
    token: vi.fn(),
    topToken: vi.fn(),
    discover: vi.fn(),
    discoverTop: vi.fn(),
    listener: vi.fn()
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
      getURL: (path: string) => `chrome-extension://local-test-extension${path}`
    },
    tabs: { create: mocks.open, onUpdated: { addListener: mocks.listener } },
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
  handlePublicAuthorization,
  lockAllAlibabaAuthorizations,
  resetIopAuthorization
} from '../lib/iop-authorization-runtime';

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
  await resetIopAuthorization();
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.token.mockResolvedValue(parseAlibabaTokenResponse(tokens.success));
  mocks.topToken.mockResolvedValue(parseAlibabaTokenResponse(tokens.success));
});
afterEach(async () => {
  await resetIopAuthorization();
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
