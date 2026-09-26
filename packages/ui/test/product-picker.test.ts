// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import ProductPicker from '../src/components/ProductPicker.vue';
import ProductReplacementPicker from '../src/components/ProductReplacementPicker.vue';
import { provideServices } from '../src/lib/services';

const mounted: VueWrapper[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.restoreAllMocks();
});
async function setup(replacement: boolean) {
  const gateway = new MockGatewayClient(0);
  const page = await gateway.request('listProducts', {
    page: 1,
    pageSize: 10,
    subject: '',
    language: 'en_US'
  });
  const offline = page.items.find((p) => p.status !== 'online');
  const online = page.items.find((p) => p.status === 'online');
  if (!offline || !online) throw new Error('Missing product fixtures');
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({ gateway, mode: 'mock', settings: { load: vi.fn(), save: vi.fn() } });
        return () =>
          replacement ? h(ProductReplacementPicker, { excludedIds: [online.id] }) : h(ProductPicker);
      }
    })
  );
  mounted.push(wrapper);
  await vi.waitFor(() => {
    expect(wrapper.findAll('li').length).toBeGreaterThan(0);
  });
  return { wrapper, offline, online };
}
describe('shared product picker', () => {
  it('allows existing offline products for video selection without enabling a product write', async () => {
    const { wrapper, offline } = await setup(false);
    const row = wrapper.findAll('li').find((li) => li.text().includes(offline.id));
    if (!row) throw new Error('Missing row');
    await row.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.getComponent(ProductPicker).emitted('select')?.[0]?.[0]).toMatchObject({ id: offline.id });
  });
  it('preserves showcase online-only and already-selected exclusions', async () => {
    const { wrapper, offline, online } = await setup(true);
    for (const id of [offline.id, online.id]) {
      const row = wrapper.findAll('li').find((li) => li.text().includes(id));
      if (!row) throw new Error('Missing row');
      expect(row.get('button').attributes('disabled')).toBeDefined();
    }
    expect(wrapper.getComponent(ProductReplacementPicker).emitted('select')).toBeUndefined();
  });
});
