// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import InventoryView from '../src/views/InventoryView.vue';
import ProductListFilterDialog from '../src/components/ProductListFilterDialog.vue';
import { emptyProductListFilters } from '../src/composables/product-list-filters';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';

beforeEach(() => {
  localStorage.clear();
  uiI18n.global.locale.value = 'zh-CN';
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('inventory workspace', () => {
  it('keeps listing read-only, opens the shared drawer, reuses inventory and applies server/page filters separately', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
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
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          }
        });
        return () => h(InventoryView);
      }
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(Host, {
      attachTo: document.body,
      global: {
        plugins: [[VueQueryPlugin, { queryClient }]],
        stubs: {
          RowActionsMenu: { template: '<div><slot /></div>' },
          ProductInventoryDrawer: {
            props: ['product'],
            template:
              '<div data-testid="inventory-drawer" :data-product-id="product.id"><button @click="$emit(\'close\')">Close</button></div>'
          }
        }
      }
    });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
    });
    expect(request.mock.calls.some(([operation]) => operation === 'getProductInventory')).toBe(false);
    expect(wrapper.findAll('button').some((button) => button.text() === '刷新')).toBe(false);
    const beforeSearch = request.mock.calls.filter(([operation]) => operation === 'listProducts').length;
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([operation]) => operation === 'listProducts')).toHaveLength(
        beforeSearch + 1
      );
    });
    expect(
      wrapper
        .get('select[aria-label="每页条数"]')
        .findAll('option')
        .map((option) => option.attributes('value'))
    ).toEqual(['10', '20', '30']);
    const open = () => wrapper.findAll('button').find((button) => button.text() === '查看库存');
    await open()?.trigger('click');
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([operation]) => operation === 'getProductInventory')).toHaveLength(1);
    });
    expect(wrapper.get('[data-testid="inventory-drawer"]').attributes('data-product-id')).toBe('10000001');
    await wrapper.get('[data-testid="inventory-drawer"] button').trigger('click');
    await flushPromises();
    await open()?.trigger('click');
    await flushPromises();
    expect(request.mock.calls.filter(([operation]) => operation === 'getProductInventory')).toHaveLength(1);
    const filters = wrapper.getComponent(ProductListFilterDialog);
    (
      filters.vm as {
        $emit(event: 'update:modelValue', value: ReturnType<typeof emptyProductListFilters>): void;
      }
    ).$emit('update:modelValue', { ...emptyProductListFilters(), productId: '10000001', status: 'online' });
    await vi.waitFor(() => {
      expect(
        request.mock.calls.some(
          ([operation, payload]) =>
            operation === 'listProducts' &&
            typeof payload === 'object' &&
            'productId' in payload &&
            payload.productId === '10000001' &&
            !('status' in payload)
        )
      ).toBe(true);
    });
    expect(wrapper.find('[data-testid="inventory-drawer"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
