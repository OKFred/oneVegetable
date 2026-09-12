// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { useProductShowcase } from '../src/lib/product-showcase';
import { provideServices } from '../src/lib/services';

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

function setup() {
  const gateway = new MockGatewayClient(0);
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
        mode: 'mock',
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
  return { controller, wrapper, gateway };
}
const selected = [{ id: '10000001', subject: 'Power station', status: 'online' as const }];
describe('showcase controller', () => {
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
