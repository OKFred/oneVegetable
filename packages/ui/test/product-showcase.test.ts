// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { GatewayClient } from '@one-vegetable/core';
import { useProductShowcase } from '../src/lib/product-showcase';
import { provideServices, type AppServices } from '../src/lib/services';

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, _options: unknown, run: (lock: object) => Promise<void>) => run({})
    }
  });
});
afterEach(() => vi.restoreAllMocks());

function setup(mode: 'mock' | 'extension' = 'mock') {
  const gateway: GatewayClient = new MockGatewayClient(0);
  const get = vi.fn<NonNullable<AppServices['operationAvailability']>['get']>((operations) =>
    Promise.resolve({
      items: operations.map((operation) => ({ operation, allowed: true, reasonCode: null }))
    })
  );
  let controller: ReturnType<typeof useProductShowcase> | undefined;
  const Child = defineComponent({
    setup() {
      controller = useProductShowcase();
      return () => h('div');
    }
  });
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        mode,
        operationAvailability: { get },
        settings: {
          load: () =>
            Promise.resolve({
              appKey: '',
              appSecret: '',
              accessToken: '',
              endpoint: 'https://eco.taobao.com/router/rest',
              signMethod: 'hmac' as const
            }),
          save: () => Promise.resolve()
        }
      });
      return () => h(Child);
    }
  });
  const wrapper = mount(Host);
  if (!controller) throw new Error('Missing controller');
  return { controller, wrapper, gateway, get };
}
const selected = [{ id: '10000001', subject: 'Power station', status: 'online' as const }];
describe('showcase controller', () => {
  it('recognizes late hydration of its verified account without accepting another identity or configuration', async () => {
    const { controller, wrapper, gateway } = setup();
    const context = await gateway.galleryTransferContext?.('getProductShowcase');
    if (!context) throw new Error('Missing fixture context');
    expect(controller.matchesAccountContext(context)).toBe(false);
    await controller.load();
    expect(controller.matchesAccountContext(structuredClone(context))).toBe(true);
    expect(controller.matchesAccountContext(null)).toBe(false);
    expect(controller.matchesAccountContext(undefined)).toBe(false);
    expect(controller.matchesAccountContext({ ...context, identity: 'different-account' })).toBe(false);
    expect(controller.matchesAccountContext({ ...context, gateway: 'different-configuration' })).toBe(false);
    wrapper.unmount();
  });
  it.each(['pending', 'corrupt'])(
    'keeps a historical IOP %s receipt read-only when showcase now selects TOP',
    async (kind) => {
      const { controller, wrapper, gateway } = setup('extension');
      const upload = { identity: 'account', gateway: 'iop-upload', storage: null };
      const showcase = { ...upload, gateway: 'top-showcase' };
      vi.spyOn(gateway, 'galleryTransferContext').mockImplementation((operation) =>
        Promise.resolve(operation ? showcase : upload)
      );
      const legacyKey = 'one-vegetable:showcase:v1:account:iop-upload';
      const raw =
        kind === 'corrupt'
          ? '{broken'
          : JSON.stringify({
              requestId: '00000000-0000-4000-8000-000000000001',
              action: 'remove',
              ids: ['10000001']
            });
      localStorage.setItem(legacyKey, raw);
      const request = vi.spyOn(gateway, 'request');
      await controller.load();
      expect(controller.snapshot.value).not.toBeNull();
      expect(controller.unresolved.value).toBe(true);
      expect(controller.reason('remove', selected)).not.toBe('');
      expect(
        controller.prepareEdit('replace', '8001', { id: '10000002', subject: 'Second', status: 'online' })
      ).toBeNull();
      await controller.mutate('remove', selected);
      await expect(controller.acknowledgeReceipt()).rejects.toThrow('SHOWCASE_LOCKED');
      expect(request.mock.calls.every(([operation]) => operation === 'getProductShowcase')).toBe(true);
      expect(localStorage.getItem(legacyKey)).toBe(raw);
      expect(localStorage.getItem('one-vegetable:showcase:v1:account:top-showcase')).toBeNull();
      wrapper.unmount();
    }
  );
  it('rechecks historical ownership on a cached load and before a prepared edit sends', async () => {
    const { controller, wrapper, gateway } = setup('extension');
    const upload = { identity: 'account', gateway: 'iop-upload', storage: null };
    const showcase = { ...upload, gateway: 'top-showcase' };
    vi.spyOn(gateway, 'galleryTransferContext').mockImplementation((operation) =>
      Promise.resolve(operation ? showcase : upload)
    );
    await controller.load();
    const intent = controller.prepareEdit('replace', '8001', {
      id: '10000002',
      subject: 'Second',
      status: 'online'
    });
    if (!intent) throw new Error('Missing replacement intent');
    const legacyKey = 'one-vegetable:showcase:v1:account:iop-removed';
    localStorage.setItem(legacyKey, '00000000-0000-4000-8000-000000000001');
    const request = vi.spyOn(gateway, 'request');
    await controller.edit(intent);
    expect(request).not.toHaveBeenCalled();
    await controller.load();
    expect(controller.unresolved.value).toBe(true);
    await expect(controller.acknowledgeReceipt()).rejects.toThrow('SHOWCASE_LOCKED');
    expect(localStorage.getItem(legacyKey)).toBe('00000000-0000-4000-8000-000000000001');
    wrapper.unmount();
  });
  it('loads a TOP-owned pending receipt without importing another account receipt', async () => {
    const { controller, wrapper, gateway } = setup('extension');
    vi.spyOn(gateway, 'galleryTransferContext').mockImplementation((operation) =>
      Promise.resolve({
        identity: 'account',
        gateway: operation ? 'top-showcase' : 'iop-upload',
        storage: null
      })
    );
    const raw = JSON.stringify({
      requestId: '00000000-0000-4000-8000-000000000002',
      action: 'sort',
      ids: ['10000001']
    });
    localStorage.setItem('one-vegetable:showcase:v1:account:top-showcase', raw);
    localStorage.setItem('one-vegetable:showcase:v1:other-account:iop-upload', 'keep');
    await controller.load();
    expect(controller.unresolved.value).toBe(true);
    expect(controller.pendingAction.value).toBe('sort');
    await controller.acknowledgeReceipt();
    expect(controller.unresolved.value).toBe(false);
    expect(localStorage.getItem('one-vegetable:showcase:v1:other-account:iop-upload')).toBe('keep');
    wrapper.unmount();
  });
  it.each(['top-only', 'iop-only', 'dual'])(
    'uses one showcase context for all five operations and availability with %s configuration',
    async (configuration) => {
      const { controller, wrapper, gateway, get } = setup('extension');
      const upload = {
        identity: 'account',
        gateway: configuration === 'top-only' ? 'top' : 'iop',
        storage: null
      };
      const showcase = { ...upload, gateway: configuration === 'iop-only' ? 'iop' : 'top' };
      const context = vi
        .spyOn(gateway, 'galleryTransferContext')
        .mockImplementation((operation) => Promise.resolve(operation ? showcase : upload));
      const request = vi.spyOn(gateway, 'request');
      await controller.load();
      await controller.mutate('add', [{ id: '10000002', subject: 'Second', status: 'online' }]);
      const sort = controller.prepareEdit('sort', '8001', 2);
      if (!sort) throw new Error('Missing sort intent');
      await controller.edit(sort);
      await controller.mutate('remove', selected);
      const replace = controller.prepareEdit('replace', '8002', {
        id: '10000001',
        subject: 'First',
        status: 'online'
      });
      if (!replace) throw new Error('Missing replacement intent');
      await controller.edit(replace);
      expect(new Set(request.mock.calls.map(([operation]) => operation))).toEqual(
        new Set([
          'getProductShowcase',
          'addShowcaseProducts',
          'removeShowcaseProducts',
          'sortShowcaseProduct',
          'replaceShowcaseProduct'
        ])
      );
      for (const call of request.mock.calls) expect(call[2]?.galleryContext).toEqual(showcase);
      for (const call of get.mock.calls) expect(call[1]).toEqual({ galleryContext: showcase });
      expect(context.mock.calls.every(([operation]) => operation === 'getProductShowcase')).toBe(true);
      expect(controller.unresolved.value).toBe(false);
      wrapper.unmount();
    }
  );
  it('rejects changed showcase credentials before sending and does not retry rejected reads', async () => {
    const { controller, wrapper, gateway } = setup('extension');
    let route = 'top-original';
    vi.spyOn(gateway, 'galleryTransferContext').mockImplementation(() =>
      Promise.resolve({
        identity: 'account',
        gateway: route,
        storage: null
      })
    );
    await controller.load();
    route = 'top-replacement';
    const request = vi.spyOn(gateway, 'request');
    await controller.mutate('remove', selected);
    expect(request.mock.calls.every(([operation]) => operation === 'getProductShowcase')).toBe(true);
    request.mockClear().mockRejectedValue(new Error('PERMISSION_DENIED'));
    await controller.load(true);
    expect(request).toHaveBeenCalledOnce();
    expect(controller.snapshot.value).toBeNull();
    expect(localStorage.length).toBe(0);
    wrapper.unmount();
  });
  it('freezes sort positions and confirms the exact new order', async () => {
    const { controller, wrapper, gateway } = setup();
    await gateway.request('addShowcaseProducts', { product_id_list: ['10000002'] });
    await controller.load();
    const intent = controller.prepareEdit('sort', '8001', 2);
    expect(intent?.request.expectedEntries).toHaveLength(2);
    if (!intent) throw new Error('Missing intent');
    const spy = vi.spyOn(gateway, 'request');
    expect(spy).not.toHaveBeenCalled();
    await Promise.all([controller.edit(intent), controller.edit(intent)]);
    expect(spy.mock.calls.filter(([operation]) => operation === 'sortShowcaseProduct')).toHaveLength(1);
    expect(controller.snapshot.value?.entries.map((entry) => entry.windowId)).toEqual(['8002', '8001']);
    expect(controller.unresolved.value).toBe(false);
    expect(controller.editReason('sort', '8001', 3)).not.toBe('');
    wrapper.unmount();
  });
  it('persists sort before sending and blocks another write after an unknown result', async () => {
    const { controller, wrapper, gateway } = setup();
    await gateway.request('addShowcaseProducts', { product_id_list: ['10000002'] });
    await controller.load();
    const intent = controller.prepareEdit('sort', '8001', 2);
    if (!intent) throw new Error('Missing intent');
    const original = gateway.request.bind(gateway);
    const spy = vi.spyOn(gateway, 'request').mockImplementation(async (...args) => {
      if (args[0] !== 'sortShowcaseProduct') return original(...args);
      expect(
        Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes('"sourceOrder":1'))
      ).toBe(true);
      throw new Error('timeout');
    });
    await controller.edit(intent);
    await controller.edit(intent);
    expect(spy.mock.calls.filter(([operation]) => operation === 'sortShowcaseProduct')).toHaveLength(1);
    wrapper.unmount();
    const again = setup();
    await again.controller.load();
    expect(again.controller.pendingAction.value).toBe('sort');
    expect(again.controller.unresolved.value).toBe(true);
    again.wrapper.unmount();
  });
  it('rejects identity changes and local persistence failure before edit sends', async () => {
    const { controller, wrapper, gateway } = setup();
    await gateway.request('addShowcaseProducts', { product_id_list: ['10000002'] });
    await controller.load();
    const intent = controller.prepareEdit('sort', '8001', 2);
    if (!intent) throw new Error('Missing intent');
    const spy = vi.spyOn(gateway, 'request');
    await controller.edit({ ...intent, context: 'changed' });
    expect(spy).not.toHaveBeenCalled();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await controller.edit(intent);
    expect(spy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('does not fetch on mount; refreshes manually and removes by window ID', async () => {
    const { controller, wrapper, gateway } = setup();
    const spy = vi.spyOn(gateway, 'request');
    expect(spy).not.toHaveBeenCalled();
    await controller.load();
    expect(controller.snapshot.value?.used).toBe(1);
    await controller.mutate('remove', selected);
    expect(spy.mock.calls.find(([operation]) => operation === 'removeShowcaseProducts')?.[1]).toEqual({
      window_id_list: ['8001']
    });
    expect(controller.snapshot.value?.used).toBe(0);
    expect(controller.unresolved.value).toBe(false);
    await controller.mutate('add', selected);
    expect(controller.snapshot.value?.used).toBe(1);
    wrapper.unmount();
  });
  it('persists the intent before sending and blocks repeat writes after timeout and remount', async () => {
    const { controller, wrapper, gateway } = setup();
    await controller.load();
    const real = gateway.request.bind(gateway);
    let sent = 0;
    vi.spyOn(gateway, 'request').mockImplementation(async (...args) => {
      const [operation] = args;
      if (operation === 'removeShowcaseProducts') {
        expect(Object.keys(localStorage).some((key) => key.startsWith('one-vegetable:showcase:v1:'))).toBe(
          true
        );
        sent++;
        throw new Error('timeout');
      }
      return real(...args);
    });
    await controller.mutate('remove', selected);
    await controller.mutate('remove', selected);
    expect(sent).toBe(1);
    expect(controller.unresolved.value).toBe(true);
    wrapper.unmount();
    const again = setup();
    await again.controller.load();
    expect(again.controller.unresolved.value).toBe(true);
    expect(again.controller.pendingIds.value).toEqual(['10000001']);
    expect(again.controller.pendingAction.value).toBe('remove');
    expect(again.controller.reason('remove', selected)).not.toBe('');
    again.wrapper.unmount();
  });
  it('cannot acknowledge an unresolved write while another tab holds the lock', async () => {
    const { controller, wrapper } = setup();
    localStorage.setItem('one-vegetable:showcase:v1:mock:mock', 'damaged receipt');
    await controller.load();
    vi.spyOn(navigator.locks, 'request').mockImplementation(((
      _name: string,
      _options: unknown,
      run: (lock: null) => Promise<void>
    ) => run(null)) as typeof navigator.locks.request);
    await expect(controller.acknowledgeReceipt()).rejects.toThrow('SHOWCASE_LOCKED');
    wrapper.unmount();
  });
  it('never sends a mutation when local persistence fails', async () => {
    const { controller, wrapper, gateway } = setup();
    await controller.load();
    const spy = vi.spyOn(gateway, 'request');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await controller.mutate('remove', selected);
    expect(spy.mock.calls.some(([operation]) => operation === 'removeShowcaseProducts')).toBe(false);
    wrapper.unmount();
  });
});
