// @vitest-environment jsdom
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException, type ProductInventorySnapshot } from '@one-vegetable/core';
import InventoryView from '../src/views/InventoryView.vue';
import ProductListFilterDialog from '../src/components/ProductListFilterDialog.vue';
import { emptyProductListFilters } from '../src/composables/product-list-filters';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import { useAppPreferences } from '../src/lib/preferences';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  uiI18n.global.locale.value = 'zh-CN';
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountInventory() {
  const gateway = new MockGatewayClient(0);
  const originalRequest = gateway.request.bind(gateway);
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
  cleanups.push(() => {
    wrapper.unmount();
    queryClient.clear();
  });
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('Portable solar power station 1000W');
  });
  function button(label: string) {
    const found = wrapper.findAll('button').find((button) => button.text() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  const inventoryCalls = () =>
    request.mock.calls.filter(([operation]) => operation === 'getProductInventory');
  return { wrapper, gateway, request, originalRequest, button, inventoryCalls };
}

describe('inventory workspace', () => {
  it('keeps listing read-only, opens the shared drawer from pending status, reuses inventory and applies filters separately', async () => {
    const { wrapper, request, button } = await mountInventory();
    expect(request.mock.calls.some(([operation]) => operation === 'getProductInventory')).toBe(false);
    expect(wrapper.findAll('button').some((button) => button.text() === '刷新')).toBe(false);
    const searchRow = wrapper.get('[data-slot="list-toolbar-search"]');
    expect(searchRow.findAll('input')).toHaveLength(1);
    expect(searchRow.get('input').classes()).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
    expect(searchRow.findAll('button').map((button) => button.text())).toEqual(['搜索']);
    expect(searchRow.get('button').attributes('type')).toBe('submit');
    for (const action of [searchRow.get('button'), button('查询本页库存'), button('查询所选库存 (0)')]) {
      expect(action.attributes('data-list-action')).toBeDefined();
      expect(action.classes()).toEqual(expect.arrayContaining(['h-9', 'border-input']));
      expect(action.classes()).not.toContain('bg-primary');
      expect(action.find('svg[aria-hidden="true"]').exists()).toBe(true);
    }
    const actions = wrapper.get('[data-slot="list-toolbar-actions"]');
    expect(actions.classes()).toContain('justify-end');
    expect(actions.text()).toContain('查询本页库存');
    expect(actions.text()).toContain('筛选');
    expect(button('查询所选库存 (0)').attributes('disabled')).toBeDefined();
    const beforeSearch = request.mock.calls.filter(([operation]) => operation === 'listProducts').length;
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([operation]) => operation === 'listProducts')).toHaveLength(
        beforeSearch + 1
      );
      expect(button('查询本页库存').attributes('disabled')).toBeUndefined();
    });
    expect(
      wrapper
        .get('select[aria-label="每页条数"]')
        .findAll('option')
        .map((option) => option.attributes('value'))
    ).toEqual(['10', '20', '30']);
    await wrapper.get('button[aria-label="待查询 · 查询库存：商品 10000001"]').trigger('click');
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([operation]) => operation === 'getProductInventory')).toHaveLength(1);
      expect(wrapper.get('tbody tr').text()).toContain('已返回库存');
    });
    expect(wrapper.get('[data-testid="inventory-drawer"]').attributes('data-product-id')).toBe('10000001');
    await wrapper.get('[data-testid="inventory-drawer"] button').trigger('click');
    await flushPromises();
    await button('查看库存').trigger('click');
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
    expect(
      request.mock.calls.every(([operation]) => ['listProducts', 'getProductInventory'].includes(operation))
    ).toBe(true);
  });

  it('queries only checked rows sequentially with 300ms spacing and shares their cache with the drawer', async () => {
    const { wrapper, request, originalRequest, button, inventoryCalls } = await mountInventory();
    const times: number[] = [];
    request.mockImplementation((operation, payload) => {
      if (operation === 'getProductInventory') times.push(Date.now());
      return originalRequest(operation, payload);
    });
    await wrapper.get('input[aria-label="选择10000001"]').setValue(true);
    await wrapper.get('input[aria-label="选择10000003"]').setValue(true);
    vi.useFakeTimers();
    await button('查询所选库存 (2)').trigger('click');
    await vi.advanceTimersByTimeAsync(1);
    expect(inventoryCalls()).toHaveLength(1);
    expect(button('查询本页库存').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[role="status"]').text()).toBe('库存查询 1/2');
    await vi.advanceTimersByTimeAsync(298);
    expect(inventoryCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(inventoryCalls().map(([, payload]) => payload)).toEqual([
      { productId: '10000001', source: 'product', language: 'en_US' },
      { productId: '10000003', source: 'product', language: 'en_US' }
    ]);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(300);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.findAll('tbody tr')[1]?.text()).toContain('待查询');
    await button('查看库存').trigger('click');
    await flushPromises();
    expect(inventoryCalls()).toHaveLength(2);
    expect(
      request.mock.calls.every(([operation]) => ['listProducts', 'getProductInventory'].includes(operation))
    ).toBe(true);
  });

  it('queries the visible page and stops remaining requests without treating unqueried rows as zero', async () => {
    const { wrapper, button, inventoryCalls } = await mountInventory();
    vi.useFakeTimers();
    await button('查询本页库存').trigger('click');
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.get('[role="status"]').text()).toBe('库存查询 1/3');
    await button('停止后续查询').trigger('click');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(inventoryCalls()).toHaveLength(1);
    expect(wrapper.findAll('tbody tr')[1]?.text()).toContain('待查询');
    expect(wrapper.findAll('tbody tr')[1]?.text()).toContain('—');
    expect(button('查询本页库存').attributes('disabled')).toBeUndefined();
    await button('查询本页库存').trigger('click');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(inventoryCalls()).toHaveLength(3);
    expect(wrapper.findAll('tbody tr').every((row) => row.text().includes('已返回库存'))).toBe(true);
  });

  it.each(['search', 'filters', 'page-size', 'language'] as const)(
    'cancels the old batch and clears selection on %s changes',
    async (change) => {
      const { wrapper, request, button, inventoryCalls } = await mountInventory();
      const snapshot = await new MockGatewayClient(0).request('getProductInventory', {
        productId: '10000001',
        source: 'product',
        language: 'en_US'
      });
      const pending = Promise.withResolvers<ProductInventorySnapshot>();
      request.mockReturnValueOnce(pending.promise);
      await wrapper.get('input[aria-label="选择10000001"]').setValue(true);
      await button('查询本页库存').trigger('click');
      await flushPromises();
      expect(inventoryCalls()).toHaveLength(1);
      if (change === 'search') {
        await wrapper.get('form input').setValue('solar');
        await wrapper.get('form').trigger('submit');
      } else if (change === 'filters') {
        const filters = wrapper.getComponent(ProductListFilterDialog);
        (
          filters.vm as {
            $emit(event: 'update:modelValue', value: ReturnType<typeof emptyProductListFilters>): void;
          }
        ).$emit('update:modelValue', { ...emptyProductListFilters(), status: 'online' });
      } else if (change === 'page-size') {
        await wrapper.get('select[aria-label="每页条数"]').setValue('10');
      } else {
        useAppPreferences().alibabaLanguage.value = 'zh_CN';
        await nextTick();
      }
      pending.resolve(snapshot);
      await vi.waitFor(() => {
        expect(button('查询本页库存').attributes('disabled')).toBeUndefined();
      });
      expect(inventoryCalls()).toHaveLength(1);
      expect(button('查询所选库存 (0)').attributes('disabled')).toBeDefined();
      expect(wrapper.text()).not.toContain('已返回库存');
      expect(wrapper.text()).toContain('待查询');
    }
  );

  it('stops on permission errors, renders denied status and retries only the failed row', async () => {
    const { wrapper, request, button, inventoryCalls } = await mountInventory();
    request.mockRejectedValueOnce(
      new GatewayException({ code: 'PERMISSION_DENIED', message: 'denied', retryable: false })
    );
    await button('查询本页库存').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('tbody tr').text()).toContain('无权限');
    });
    expect(inventoryCalls()).toHaveLength(1);
    expect(wrapper.findAll('tbody tr')[1]?.text()).toContain('待查询');
    await button('重试失败项').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('tbody tr').text()).toContain('已返回库存');
    });
    expect(inventoryCalls()).toHaveLength(2);
    expect(inventoryCalls()[1]?.[1]).toMatchObject({ productId: '10000001' });
  });

  it('rejects a late result after the gateway identity changes and sends no remaining reads', async () => {
    const { wrapper, gateway, request, button, inventoryCalls } = await mountInventory();
    const context = await gateway.galleryTransferContext();
    const snapshot = await new MockGatewayClient(0).request('getProductInventory', {
      productId: '10000001',
      source: 'product',
      language: 'en_US'
    });
    const pending = Promise.withResolvers<ProductInventorySnapshot>();
    request.mockReturnValueOnce(pending.promise);
    await button('查询本页库存').trigger('click');
    await flushPromises();
    vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({ ...context, identity: 'new-account' });
    pending.resolve(snapshot);
    await vi.waitFor(() => {
      expect(wrapper.get('tbody tr').text()).toContain('查询失败');
    });
    expect(wrapper.text()).not.toContain('已返回库存');
    expect(inventoryCalls()).toHaveLength(1);
  });

  it('keeps product/SKU reads separate and preserves no-data instead of zero inventory', async () => {
    const { wrapper, request, button, inventoryCalls } = await mountInventory();
    const snapshot = await new MockGatewayClient(0).request('getProductInventory', {
      productId: '10000001',
      source: 'product',
      language: 'en_US'
    });
    request.mockResolvedValueOnce({ ...snapshot, status: 'no-data', records: [] });
    await wrapper.get('input[aria-label="选择10000001"]').setValue(true);
    await button('查询所选库存 (1)').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('tbody tr').text()).toContain('未返回库存记录');
    });
    await wrapper.get('[data-slot="list-toolbar-actions"] select').setValue('sku');
    expect(wrapper.get('tbody tr').text()).toContain('待查询');
    await button('查询所选库存 (1)').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('tbody tr').text()).toContain('已返回库存');
    });
    expect(inventoryCalls().map(([, payload]) => payload)).toEqual([
      { productId: '10000001', source: 'product', language: 'en_US' },
      { productId: '10000001', source: 'sku', language: 'en_US' }
    ]);
    await wrapper.get('[data-slot="list-toolbar-actions"] select').setValue('product');
    await button('查询所选库存 (1)').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('tbody tr').text()).toContain('未返回库存记录');
    });
    expect(inventoryCalls()).toHaveLength(2);
  });

  it('stops scheduling when the view is unmounted', async () => {
    const { wrapper, button, inventoryCalls } = await mountInventory();
    vi.useFakeTimers();
    await button('查询本页库存').trigger('click');
    await vi.advanceTimersByTimeAsync(1);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(inventoryCalls()).toHaveLength(1);
  });
});
