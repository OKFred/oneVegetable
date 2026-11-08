import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { ExtensionRuntimeSenderIdentity } from '../lib/trusted-runtime-sender';
import { freightosResponse, shippingConfiguration, shippingQuote } from './shipping-services-fixture';

type Listener = (value: unknown, sender: ExtensionRuntimeSenderIdentity) => unknown;
const state = vi.hoisted<{
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  listener: Listener | undefined;
  external:
    | ((value: unknown, sender: ExtensionRuntimeSenderIdentity, respond: (value: unknown) => void) => unknown)
    | undefined;
  contains: ReturnType<typeof vi.fn>;
  permission: ReturnType<typeof vi.fn>;
}>(() => ({
  local: {},
  session: {},
  listener: undefined,
  external: undefined,
  contains: vi.fn(),
  permission: vi.fn()
}));
vi.mock('wxt/browser', () => {
  const area = (name: 'local' | 'session') => ({
    get: (key: string) => Promise.resolve({ [key]: structuredClone(state[name][key]) }),
    set: (items: Record<string, unknown>) => {
      Object.assign(state[name], structuredClone(items));
      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) Reflect.deleteProperty(state[name], key);
      return Promise.resolve();
    },
    clear: () => {
      state[name] = {};
      return Promise.resolve();
    },
    setAccessLevel: () => Promise.resolve()
  });
  return {
    browser: {
      storage: {
        local: area('local'),
        session: area('session'),
        sync: { setAccessLevel: () => Promise.resolve() }
      },
      permissions: { contains: state.contains, request: state.permission },
      tabs: { onUpdated: { addListener: vi.fn() } },
      runtime: {
        id: 'shipping-test',
        getURL: (path: string) => `chrome-extension://shipping-test${path}`,
        onMessage: {
          addListener: (listener: Listener) => {
            state.listener = listener;
          }
        },
        onMessageExternal: {
          addListener: (listener: typeof state.external) => {
            state.external = listener;
          }
        },
        sendMessage: (value: unknown) =>
          Promise.resolve(
            state.listener?.(value, {
              id: 'shipping-test',
              url: 'chrome-extension://shipping-test/options.html'
            })
          )
      }
    }
  };
});
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (value: unknown) => value }));
import background from '../entrypoints/background';
import { extensionShippingServices as client } from '../lib/shipping-services-client';
import { shippingServicesLocalStore } from '../lib/shipping-services-store';
import { EXTENSION_SHIPPING_SERVICES_STORAGE_KEY } from '../lib/shipping-services-protocol';
import { ExtensionProductMaintenanceRepository } from '../lib/product-maintenance-repository';
import { resetIopAuthorization } from '../lib/iop-authorization-runtime';

const sender = { id: 'shipping-test', url: 'chrome-extension://shipping-test/options.html#/logistics' };
const send = (input: Record<string, unknown>, source = sender) =>
  Promise.resolve(
    state.listener?.(
      {
        kind: 'shipping-services-request',
        requestId: crypto.randomUUID(),
        provider: 'freightos',
        ...input
      },
      source
    )
  );

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(freightosResponse)));
  vi.spyOn(ExtensionProductMaintenanceRepository.prototype, 'clearAll').mockResolvedValue();
  state.local = {};
  state.session = {};
  state.contains.mockResolvedValue(true);
  state.permission.mockResolvedValue(true);
  background.main();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('trusted shipping runtime wiring', () => {
  it('runs options client save/quote/read/clear independently of TOP/IOP and survives worker recreation', async () => {
    expect(await client.configuration('freightos')).toMatchObject({ configured: false });
    expect(state.permission).not.toHaveBeenCalled();
    expect(await client.saveConfiguration(shippingConfiguration)).toMatchObject({
      configured: true,
      revision: 1
    });
    expect(Object.keys(state.local)).toEqual([EXTENSION_SHIPPING_SERVICES_STORAGE_KEY]);
    const quote = shippingQuote();
    expect(await client.quote(quote)).toMatchObject({ options: [{ kind: 'market-estimate' }] });
    background.main();
    await expect(client.quote(quote)).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_ALREADY_SENT' });
    await resetIopAuthorization();
    expect(await client.configuration('freightos')).toMatchObject({ configured: true, revision: 1 });
    await client.clearConfiguration('freightos', 1);
    expect(await client.configuration('freightos')).toMatchObject({ configured: false, revision: null });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await shippingServicesLocalStore.key(false)).toBeNull();
  });

  it.each([
    { id: 'shipping-test', url: 'https://i.alibaba.com/' },
    { id: 'other-extension', url: sender.url },
    { id: 'shipping-test', url: 'chrome-extension://shipping-test/popup.html' }
  ])('denies a content script, foreign extension or non-options page: %#', async (source) => {
    expect(await send({ action: 'save', ...shippingConfiguration }, source)).toMatchObject({
      error: { code: 'SHIPPING_UNTRUSTED_SENDER' }
    });
    expect(state.local).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose shipping dispatch through externally_connectable authorization callbacks', async () => {
    const result = await new Promise<unknown>((resolve) => {
      state.external?.(
        {
          kind: 'shipping-services-request',
          action: 'save',
          ...shippingConfiguration,
          requestId: crypto.randomUUID()
        },
        { url: 'https://one-vegetable-auth.pages.dev/' },
        resolve
      );
    });
    expect(result).toMatchObject({ ok: false });
    expect(state.local).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechecks host permission in the SW and full local reset removes the independent key and ledger', async () => {
    await client.saveConfiguration(shippingConfiguration);
    state.contains.mockResolvedValue(false);
    await expect(client.quote(shippingQuote())).rejects.toMatchObject({
      code: 'SHIPPING_PERMISSION_REQUIRED'
    });
    expect(fetch).not.toHaveBeenCalled();
    state.contains.mockResolvedValue(true);
    await client.quote(shippingQuote());
    expect(
      await state.listener?.(
        { kind: 's3-storage-request', operation: 'reset', payload: {}, requestId: crypto.randomUUID() },
        sender
      )
    ).toMatchObject({ ok: true });
    expect(await shippingServicesLocalStore.read()).toBeUndefined();
    expect(await shippingServicesLocalStore.key(false)).toBeNull();
    background.main();
    expect(await client.configuration('freightos')).toMatchObject({ configured: false });
  });
});
