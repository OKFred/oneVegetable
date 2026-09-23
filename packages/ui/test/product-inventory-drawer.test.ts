// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { PRODUCT_MOCK_DATA } from '../../core/src/generated/mock-data';
import ProductInventoryDrawer from '../src/components/ProductInventoryDrawer.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';

describe('inventory partial response display', () => {
  it('keeps rows with missing identifiers visible until an explicit search is entered', async () => {
    const wrapper = mount(ProductInventoryDrawer, {
      props: {
        product: PRODUCT_MOCK_DATA.responses.listProducts.items[0] ?? null,
        source: 'product',
        busy: false,
        snapshot: {
          ...PRODUCT_MOCK_DATA.responses.getProductInventory,
          status: 'drift',
          issues: ['records/0:missing-fields'],
          records: [{ skuId: null, skuOuterId: null, inventoryCode: null, inventory: 0 }]
        }
      },
      global: { stubs: { Sheet: { template: '<div><slot /></div>' } } }
    });
    expect(
      wrapper
        .findAll('tbody td')
        .slice(1, -1)
        .map((cell) => cell.text())
    ).toEqual(['—', '—', '—', '0']);
    expect(wrapper.get('[data-testid="platform-readback-notice"]').text()).toContain('同步可能有延迟');
    await wrapper.get('input').setValue(' RED ');
    expect(wrapper.findAll('tbody td')).toHaveLength(1);
    expect(wrapper.get('tbody td').attributes('colspan')).toBe('6');
    await wrapper.get('input').setValue('  ');
    expect(
      wrapper
        .findAll('tbody td')
        .slice(1, -1)
        .map((cell) => cell.text())
    ).toEqual(['—', '—', '—', '0']);
    wrapper.unmount();
  });
  it('shows refresh errors alongside the dated snapshot and clears them after successful retry', async () => {
    const state = reactive<{ busy: boolean; error: unknown }>({ busy: false, error: undefined });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideServices({
            gateway: new MockGatewayClient(0),
            mode: 'mock',
            settings: {
              load: () =>
                Promise.resolve({
                  appKey: '',
                  appSecret: '',
                  accessToken: '',
                  endpoint: '',
                  signMethod: 'hmac'
                }),
              save: () => Promise.resolve()
            }
          });
          return () =>
            h(ProductInventoryDrawer, {
              product: PRODUCT_MOCK_DATA.responses.listProducts.items[0] ?? null,
              snapshot: PRODUCT_MOCK_DATA.responses.getProductInventory,
              source: 'product',
              ...state
            });
        }
      }),
      { global: { stubs: { Sheet: { template: '<div><slot /></div>' } } } }
    );
    try {
      const cells = wrapper.findAll('tbody td').map((cell) => cell.text());
      state.error = new Error('Inventory refresh timed out');
      await nextTick();
      expect(wrapper.get('[aria-live="polite"]').text()).toBe(uiI18n.global.t('inventory.failed'));
      expect(wrapper.get('[role="alert"]').text()).toContain('Inventory refresh timed out');
      expect(wrapper.text()).toContain('mock-inventory');
      expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual(cells);
      state.busy = true;
      await nextTick();
      expect(wrapper.get('[aria-live="polite"]').text()).toBe(uiI18n.global.t('inventory.loading'));
      state.busy = false;
      state.error = undefined;
      await nextTick();
      expect(wrapper.get('[aria-live="polite"]').text()).toBe(uiI18n.global.t('inventory.ready'));
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
