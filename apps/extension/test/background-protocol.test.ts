import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALIBABA_GATEWAY,
  AlibabaClient,
  SETTINGS_STORAGE_KEY,
  type GatewaySettings
} from '@one-vegetable/core';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';

const state = vi.hoisted<{
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  listener: undefined | ((value: unknown, sender: { id: string; url: string }) => unknown);
}>(() => ({
  local: {},
  session: {},
  listener: undefined
}));
vi.mock('wxt/browser', () => {
  const area = (name: 'local' | 'session') => ({
    get: (key: string) => Promise.resolve(Object.hasOwn(state[name], key) ? { [key]: state[name][key] } : {}),
    set: (items: Record<string, unknown>) => {
      Object.assign(state[name], items);
      return Promise.resolve();
    },
    remove: (key: string) => {
      Reflect.deleteProperty(state[name], key);
      return Promise.resolve();
    },
    setAccessLevel: () => Promise.resolve()
  });
  return {
    browser: {
      storage: { local: area('local'), session: area('session') },
      tabs: { onUpdated: { addListener: vi.fn() } },
      permissions: { contains: () => Promise.resolve(true) },
      runtime: {
        id: 'protocol-test-extension',
        getURL: (path: string) => `chrome-extension://protocol-test-extension${path}`,
        onMessage: {
          addListener: (listener: typeof state.listener) => {
            state.listener = listener;
          }
        },
        onMessageExternal: { addListener: vi.fn() }
      }
    }
  };
});
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (value: unknown) => value }));
import background from '../entrypoints/background';

const sender = {
  id: 'protocol-test-extension',
  url: 'chrome-extension://protocol-test-extension/options.html'
};
const settings: GatewaySettings = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256',
  protocol: 'iop'
};
interface Result {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}
async function send(
  kind: 'credential-vault-request' | 'gateway-request',
  operation: string,
  payload?: unknown
) {
  return (await state.listener?.(
    { kind, operation, payload, requestId: crypto.randomUUID() },
    sender
  )) as Result;
}
async function create(value = settings) {
  expect(
    await send('credential-vault-request', 'create', { passphrase: '123456', settings: value })
  ).toMatchObject({ ok: true });
}
beforeEach(() => {
  state.local = {};
  state.session = {};
  background.main();
  // Only local fixtures are allowed. Any unexpected attempt to use the network fails the test.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('extension background protocol persistence and dispatch', () => {
  it('preserves IOP through create, safe settings/status, save and unlock without leaking secrets', async () => {
    await create();
    const safe = await send('credential-vault-request', 'get-settings');
    expect(safe).toMatchObject({
      ok: true,
      data: {
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac-sha256',
        appSecret: '',
        accessToken: ''
      }
    });
    expect(JSON.stringify(await send('credential-vault-request', 'status'))).not.toContain(
      settings.appSecret
    );
    expect(JSON.stringify(state.local[SETTINGS_STORAGE_KEY])).not.toContain(settings.accessToken);
    // A save from an older consumer omitting the marker must not strip existing IOP.
    expect(
      await send('credential-vault-request', 'save', {
        appKey: '',
        appSecret: '',
        accessToken: '',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac-sha256'
      })
    ).toMatchObject({ ok: true, data: { protocol: 'iop' } });
    await send('credential-vault-request', 'lock');
    expect(await send('credential-vault-request', 'unlock', { passphrase: '123456' })).toMatchObject({
      ok: true,
      data: { protocol: 'iop' }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains legacy TOP settings and permits only an explicit marker switch', async () => {
    const legacy = { ...settings, endpoint: ALIBABA_GATEWAY, signMethod: 'md5' as const };
    delete legacy.protocol;
    await create(legacy);
    const safe = (await send('credential-vault-request', 'get-settings')).data;
    expect(safe).toMatchObject({ endpoint: ALIBABA_GATEWAY, signMethod: 'md5' });
    expect(safe).not.toHaveProperty('protocol');
    expect(await send('credential-vault-request', 'save', settings)).toMatchObject({
      ok: true,
      data: { protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['bad', null])('rejects invalid protocol %s without storing a vault', async (protocol) => {
    expect(
      await send('credential-vault-request', 'create', {
        passphrase: '123456',
        settings: { ...settings, protocol }
      })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_PROTOCOL_INVALID' } });
    expect(state.local).not.toHaveProperty(SETTINGS_STORAGE_KEY);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects known IOP writes and unmapped targeted reads before creating a network client', async () => {
    await create();
    const client = vi.spyOn(AlibabaClient, 'create');
    for (const operation of ['publishProduct', 'uploadPhoto', 'createProductGroup'])
      expect(await send('gateway-request', operation, {})).toMatchObject({
        ok: false,
        error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
      });
    expect(
      await send('gateway-request', 'callCapability', { method: 'alibaba.icbu.product.get', parameters: {} })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' } });
    expect(client).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('gates existing catalog and definition metadata by target without closing mapped reads', async () => {
    await create();
    const catalog = await send('gateway-request', 'listCapabilities');
    const capabilities = catalog.data as unknown as { method: string; realCallEnabled: boolean }[];
    expect(
      capabilities.find((capability) => capability.method === 'alibaba.icbu.product.list')
    ).toMatchObject({ realCallEnabled: true });
    expect(capabilities.find((capability) => capability.method === 'alibaba.icbu.product.get')).toMatchObject(
      { realCallEnabled: false }
    );
    expect(
      await send('gateway-request', 'getCapabilityDefinition', { method: 'alibaba.icbu.product.get' })
    ).toMatchObject({ data: { realCallEnabled: false } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { groupId: '-1' }, { ungrouped: true }])(
    'requires an explicit IOP photo group for %s',
    async (payload) => {
      await create();
      expect(await send('gateway-request', 'listPhotos', payload)).toMatchObject({
        ok: false,
        error: { code: 'ALIBABA_IOP_PHOTO_GROUP_REQUIRED' }
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('dispatches a mapped IOP read without creating a TOP sync client', async () => {
    await create();
    const client = vi.spyOn(AlibabaClient, 'create');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: '0', result: { groups: [] } }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const response = await send('gateway-request', 'listPhotoGroups', {});
    expect(response.error).toBeUndefined();
    expect(response).toMatchObject({ ok: true, data: [] });
    expect(client).toHaveBeenCalledOnce();
    expect(client.mock.calls[0]?.[0]).toMatchObject({ protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({
      href: `${IOP_BUSINESS_ENDPOINT}/icbu/product/photobank/group/list`
    });
  });
});
