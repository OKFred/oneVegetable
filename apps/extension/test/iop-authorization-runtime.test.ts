import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAlibabaTokenResponse } from '@one-vegetable/core/credential-bundle';
import { PUBLIC_AUTH_CALLBACK, PUBLIC_AUTH_ORIGIN } from '@one-vegetable/core/alibaba-iop';
import type * as IopModule from '@one-vegetable/core/alibaba-iop';
import tokens from '../../../mock/data/alibaba-auth/iop-token-responses.json';
import credential from '../../../mock/data/node-gateway-credentials.json';

const mocks = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  return {
    data,
    open: vi.fn((_options: { url: string }) => Promise.resolve({ id: 42 })),
    permission: vi.fn(() => Promise.resolve(true)),
    token: vi.fn(),
    listener: vi.fn()
  };
});
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
        get: (key: string) => Promise.resolve({ [key]: mocks.data[key] }),
        set: (values: Record<string, unknown>) => {
          Object.assign(mocks.data, values);
          return Promise.resolve();
        },
        remove: (keys: string[]) => {
          for (const key of keys) Reflect.deleteProperty(mocks.data, key);
          return Promise.resolve();
        }
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
  resetIopAuthorization
} from '../lib/iop-authorization-runtime';

const trusted = {
  id: 'local-test-extension',
  url: 'chrome-extension://local-test-extension/authorization.html'
};
function command(action: string, payload: unknown = {}) {
  return { kind: 'iop-authorization-request', requestId: crypto.randomUUID(), action, payload };
}
function external(action: string, extra: Record<string, unknown> = {}) {
  return { kind: 'one-vegetable-public-auth', requestId: crypto.randomUUID(), action, ...extra };
}
beforeEach(async () => {
  await handleAuthorization(command('clear'), trusted);
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.token.mockResolvedValue(parseAlibabaTokenResponse(tokens.success));
});
afterEach(async () => {
  await handleAuthorization(command('clear'), trusted);
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
    for (const action of ['status', 'export', 'import', 'refresh', 'clear', 'unlock'])
      expect(
        await handlePublicAuthorization(external(action), { url: `${PUBLIC_AUTH_ORIGIN}/` })
      ).toMatchObject({ ok: false });
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it('only trusts the standalone extension tool, not content scripts or the workbench', async () => {
    for (const sender of [
      { id: trusted.id, url: 'https://i.alibaba.com/' },
      { id: trusted.id, url: 'chrome-extension://local-test-extension/options.html' },
      { id: 'other-extension', url: trusted.url }
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
