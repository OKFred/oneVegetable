// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';
import ColumnSettings from '../src/components/ColumnSettings.vue';
import ProductVisibleRegion from '../src/components/ProductVisibleRegion.vue';
import { GalleryTransferService, provideGalleryTransfers } from '../src/lib/gallery-transfer-service';

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn()
  }
}));

describe('ProductsView selection toolbar', () => {
  it('assesses a frozen current-page selection, opens the existing editor and returns without writes', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    button(wrapper.element as Node, '更多').click();
    await flushPromises();
    menuItem('商品体检').click();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="product-quality-workspace"]').exists()).toBe(true);
    });
    expect(request.mock.calls.some(([op]) => op === 'getProductScore')).toBe(false);
    button(wrapper.element as Node, '开始体检').click();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('4.6');
    });
    expect(request.mock.calls.find(([op]) => op === 'getProductScore')?.[1]).toEqual({
      productId: '10000001'
    });
    button(wrapper.element as Node, '查看问题并完善').click();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="product-quality-review"]').exists()).toBe(true);
    });
    expect(wrapper.text()).toContain('本地完善建议');
    button(wrapper.element as Node, '返回体检结果').click();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="product-quality-workspace"]').exists()).toBe(true);
    });
    expect(wrapper.text()).toContain('4.6');
    expect(wrapper.text()).not.toContain('已渲染');
    expect(request.mock.calls.some(([op]) => /update|publish|save/i.test(op))).toBe(false);
    wrapper.unmount();
  });
  it('waits for the initial account before mounting the interactive table', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const transfers = new GalleryTransferService({
      gateway,
      settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
      mode: 'mock'
    });
    const wrapper = mountView(gateway, transfers);
    await flushPromises();
    expect(request.mock.calls.filter(([operation]) => operation === 'listProducts')).toHaveLength(0);
    expect(wrapper.findComponent(ColumnSettings).exists()).toBe(false);
    transfers.currentContext.value = await gateway.galleryTransferContext();
    transfers.initialized.value = true;
    await waitForProducts(wrapper);
    expect(request.mock.calls.filter(([operation]) => operation === 'listProducts')).toHaveLength(1);
    expect(wrapper.findComponent(ColumnSettings).exists()).toBe(true);
    wrapper.unmount();
    transfers.dispose();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  it('does not query details on column changes and puts the returned product link before Edit', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    const before = request.mock.calls.length;
    const settings = wrapper.getComponent(ColumnSettings);
    (settings.vm as { $emit: (event: 'toggle', id: string) => void }).$emit('toggle', 'keywords');
    await flushPromises();
    expect(request.mock.calls.length).toBe(before);
    const link = wrapper.get('a[href^="https://www.alibaba.com/product-detail/"]');
    expect(link.text()).toBe('链接');
    expect(link.classes()).toEqual(expect.arrayContaining(['h-8', 'border', 'border-input', 'px-3']));
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('title')).toContain('10000001');
    expect(link.element.parentElement?.textContent).toBe('查看资料库存链接编辑');
    expect(request.mock.calls.some(([operation]) => operation === 'getProductInventory')).toBe(false);
    expect(wrapper.get('tbody tr td:nth-child(3)').text()).not.toContain('10000001');
    expect(request.mock.calls.some(([operation]) => operation === 'getProductScore')).toBe(false);
    wrapper.unmount();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/products/list');
  });

  it('only schedules visible score cells, stops in background and reuses completed scores', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    const scoreCalls = () => request.mock.calls.filter(([operation]) => operation === 'getProductScore');
    const regions = wrapper.findAllComponents(ProductVisibleRegion);
    const setVisible = (index: number, visible: boolean) => {
      const region = regions[index];
      if (region) (region.vm as { $emit(event: 'visible', value: boolean): void }).$emit('visible', visible);
    };
    expect(regions).toHaveLength(3);
    expect(scoreCalls()).toHaveLength(0);
    setVisible(0, true);
    await vi.waitFor(() => {
      expect(scoreCalls()).toHaveLength(1);
    });
    setVisible(0, false);
    setVisible(0, true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(scoreCalls()).toHaveLength(1);

    setVisible(1, true);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(scoreCalls()).toHaveLength(1);

    visibility.mockReturnValue('visible');
    setVisible(1, true);
    await vi.waitFor(() => {
      expect(scoreCalls()).toHaveLength(2);
    });
    const settings = wrapper.getComponent(ColumnSettings);
    (settings.vm as { $emit(event: 'toggle', value: string): void }).$emit('toggle', 'productScore');
    await flushPromises();
    expect(wrapper.findAllComponents(ProductVisibleRegion)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(scoreCalls()).toHaveLength(2);
    wrapper.unmount();
  });
  it('uses four context checks per score and does not restart on duplicate visibility events', async () => {
    const gateway = new MockGatewayClient(0);
    const contexts = vi.spyOn(gateway, 'galleryTransferContext');
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    contexts.mockClear();
    const regions = wrapper.findAllComponents(ProductVisibleRegion);
    for (const region of regions.slice(0, 2)) {
      (region.vm as { $emit(event: 'visible', value: boolean): void }).$emit('visible', true);
    }
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([op]) => op === 'getProductScore')).toHaveLength(2);
      expect(contexts).toHaveBeenCalledTimes(8);
    });
    for (const region of regions.slice(0, 2)) {
      (region.vm as { $emit(event: 'visible', value: boolean): void }).$emit('visible', true);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(contexts).toHaveBeenCalledTimes(8);
    wrapper.unmount();
  });
  it('offers an explicit failed-score retry without automatic resends', async () => {
    const gateway = new MockGatewayClient(0);
    const original = gateway.request.bind(gateway);
    let deny = true;
    const request = vi.spyOn(gateway, 'request').mockImplementation((operation, payload) => {
      if (operation === 'getProductScore' && deny) return Promise.reject(new Error('read-failed'));
      return original(operation, payload);
    });
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    const region = wrapper.findAllComponents(ProductVisibleRegion)[0];
    if (!region) throw new Error('Score visibility region was not mounted');
    (region.vm as { $emit(event: 'visible', value: boolean): void }).$emit('visible', true);
    await vi.waitFor(() => {
      expect(wrapper.find('button[aria-label="重新查询产品分"]').exists()).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(request.mock.calls.filter(([op]) => op === 'getProductScore')).toHaveLength(1);
    deny = false;
    await wrapper.get('button[aria-label="重新查询产品分"]').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('4.6');
    });
    expect(request.mock.calls.filter(([op]) => op === 'getProductScore')).toHaveLength(2);
    wrapper.unmount();
  });

  it('supports unchecked, mixed and current-page selected states with a visible count', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);
    const toolbar = wrapper.get('[role="toolbar"][aria-label="商品列表操作"]');
    const selectedCount = wrapper.get('[data-testid="product-selection-count"]');
    const selectPage = wrapper.get('input[aria-label="选择本页全部 3 个商品"]');

    expect(wrapper.get('table').text()).toContain('在线');
    expect(wrapper.get('table').text()).not.toMatch(/\bonline\b/);
    expect(button(wrapper.get('table').element, '编辑')).toBeInstanceOf(HTMLButtonElement);
    expect(wrapper.get('table').text()).not.toContain('编辑商品');
    expect(selectedCount.text()).toBe('已选 0 个');
    expect(toolbar.text()).not.toContain('已选');
    expect((selectPage.element as HTMLInputElement).indeterminate).toBe(false);
    expect(selectPage.attributes('aria-checked')).toBe('false');
    expect(
      [...toolbar.element.querySelectorAll('button')].some((item) => item.textContent.trim() === '清空')
    ).toBe(false);
    expect(button(toolbar.element, '导出').disabled).toBe(true);
    expect(button(toolbar.element, '更多').disabled).toBe(false);
    expect(button(toolbar.element, '分组').querySelector('svg')).not.toBeNull();
    expect(button(toolbar.element, '新增').querySelector('svg')).not.toBeNull();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      '商品列表',
      '批量发品',
      '任务中心'
    ]);
    expect(toolbar.text()).not.toContain('批量查询产品分');
    expect(toolbar.text()).not.toContain('批量上架');
    expect(toolbar.text()).not.toContain('批量下架');

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    expect(selectedCount.text()).toBe('已选 1 个');
    expect((selectPage.element as HTMLInputElement).indeterminate).toBe(true);
    expect(selectPage.attributes('aria-checked')).toBe('mixed');
    expect(button(toolbar.element, '导出').disabled).toBe(false);
    expect(button(toolbar.element, '更多').disabled).toBe(false);

    await selectPage.setValue(true);
    expect(selectedCount.text()).toBe('已选 3 个');
    expect(
      (wrapper.get('input[aria-label="取消选择本页全部 3 个商品"]').element as HTMLInputElement).checked
    ).toBe(true);

    await wrapper.get('input[aria-label="取消选择本页全部 3 个商品"]').setValue(false);
    expect(selectedCount.text()).toBe('已选 0 个');
    expect(
      (wrapper.get('input[aria-label="选择本页全部 3 个商品"]').element as HTMLInputElement).checked
    ).toBe(false);
    wrapper.unmount();
  });

  it('keeps group and status columns compact with full group names available on hover', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);
    const headers = wrapper.findAll('thead th').map((header) => header.text().trim());
    const groupIndex = headers.indexOf('分组');
    const statusIndex = headers.indexOf('状态');
    const updatedAtIndex = headers.indexOf('更新时间');
    if (groupIndex < 0 || statusIndex < 0 || updatedAtIndex < 0)
      throw new Error('Missing product group, status or update time header');
    const cells = wrapper.get('tbody tr').findAll('td');
    const groupCell = cells.at(groupIndex);
    const statusCell = cells.at(statusIndex);
    const updatedAtCell = cells.at(updatedAtIndex);

    if (!groupCell || !statusCell || !updatedAtCell)
      throw new Error('Missing product group, status or update time cell');
    expect(groupCell.attributes('style')).toContain('width: 128px');
    expect(statusCell.attributes('style')).toContain('width: 112px');
    const groupName = groupCell.get('.truncate');
    expect(groupName.attributes('title')).toBe(groupName.text());
    expect(groupName.classes()).toContain('block');
    expect(statusCell.get('.whitespace-nowrap').text()).toBe('在线');
    expect(updatedAtCell.get('.whitespace-nowrap').classes()).toContain('tabular-nums');
    wrapper.unmount();
  });

  it('refreshes the current product list from the toolbar', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    const toolbar = wrapper.get('[role="toolbar"][aria-label="商品列表操作"]');
    const initialRequests = request.mock.calls.filter(([operation]) => operation === 'listProducts').length;

    button(toolbar.element, '搜索').click();

    await vi.waitFor(() => {
      const refreshedRequests = request.mock.calls.filter(
        ([operation]) => operation === 'listProducts'
      ).length;
      expect(refreshedRequests).toBe(initialRequests + 1);
    });
    wrapper.unmount();
  });

  it('filters from the collapsible product group tree and preserves group depth', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await waitForProducts(wrapper);
    const groups = wrapper.get('[role="tree"][aria-label="商品分组"]');

    button(groups.element, 'Energy storage').click();
    await vi.waitFor(() => {
      expect(wrapper.text()).not.toContain('Custom recycled cotton canvas tote bag');
      expect(
        request.mock.calls.some(
          ([operation, payload]) =>
            operation === 'listProducts' &&
            typeof payload === 'object' &&
            'groupId' in payload &&
            payload.groupId === 1001 &&
            'groupLevel' in payload &&
            payload.groupLevel === 1
        )
      ).toBe(true);
    });

    await groups.get('button[aria-label="展开Energy storage"]').trigger('click');
    expect(groups.text()).toContain('Portable power');
    button(groups.element, 'Portable power').click();
    await vi.waitFor(() => {
      expect(
        request.mock.calls.some(
          ([operation, payload]) =>
            operation === 'listProducts' &&
            typeof payload === 'object' &&
            'groupId' in payload &&
            payload.groupId === 1101 &&
            'groupLevel' in payload &&
            payload.groupLevel === 2
        )
      ).toBe(true);
    });

    await wrapper.get('button[aria-label="收起商品分组"]').trigger('click');
    expect(wrapper.find('[role="tree"][aria-label="商品分组"]').exists()).toBe(false);
    await wrapper.get('button[aria-label="展开商品分组"]').trigger('click');
    expect(wrapper.find('[role="tree"][aria-label="商品分组"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('clears current-page selection when search, page size or language changes', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);
    const selectedCount = () => wrapper.get('[data-testid="product-selection-count"]').text();

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    expect(selectedCount()).toContain('已选 1 个');
    await wrapper.get('input[placeholder="按标题搜索"]').setValue('canvas');
    await wrapper.get('[role="toolbar"] form').trigger('submit');
    await waitForSelectionCount(wrapper, '已选 0 个', 'search change');

    await wrapper.get('input[placeholder="按标题搜索"]').setValue('');
    await wrapper.get('[role="toolbar"] form').trigger('submit');
    await waitForProducts(wrapper);
    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    const pageSizeSelect = wrapper.get('select[aria-label="每页条数"]');
    const currentPageSize = (pageSizeSelect.element as HTMLSelectElement).value;
    expect(currentPageSize).toBe('20');
    await pageSizeSelect.setValue(currentPageSize === '10' ? '20' : '10');
    await waitForSelectionCount(wrapper, '已选 0 个', 'page-size change');

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    button(wrapper.element as Node, '新增').click();
    await flushPromises();
    await wrapper.get('summary').trigger('click');
    const languageSelect = wrapper.get('select[aria-label="商品表单语言"]');
    const currentLanguage = (languageSelect.element as HTMLSelectElement).value;
    await languageSelect.setValue(currentLanguage === 'zh_CN' ? 'en_US' : 'zh_CN');
    button(wrapper.element as Node, '商品列表').click();
    await flushPromises();
    await waitForSelectionCount(wrapper, '已选 0 个', 'language change');
    wrapper.unmount();
  });

  it('previews list images and queries product scores for selected products in sequence', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);

    const table = wrapper.get('table');
    const headers = table.findAll('th');
    expect(headers[0]?.classes()).toContain('sticky');
    expect(headers[1]?.classes()).not.toContain('sticky');
    expect(headers.at(-1)?.classes()).toContain('sticky');
    expect(table.findAll('button').some((item) => item.text() === '查询产品分')).toBe(false);

    const preview = wrapper.get('button[aria-label="预览 Portable solar power station 1000W 主图"]');
    expect(preview.get('img').attributes('src')).toContain('mock-solar-station.jpg');
    await preview.trigger('click');
    expect(document.body.textContent).toContain('商品 10000001');

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    await wrapper.get('input[aria-label="选择 Custom recycled cotton canvas tote bag"]').setValue(true);
    button(wrapper.element as Node, '更多').click();
    await flushPromises();
    await vi.waitFor(() => {
      expect(menuItem('批量查询产品分').getAttribute('data-disabled')).toBeNull();
    });
    menuItem('批量查询产品分').click();
    await flushPromises();

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('产品分查询完成：成功 2 个，失败 0 个。');
      expect(wrapper.text().match(/4\.6/g)).toHaveLength(2);
      expect(wrapper.text()).not.toContain('4.6/6');
    });
    expect(wrapper.text()).not.toContain('质量与上下架');
    wrapper.unmount();
  });
});

function mountView(gateway = new MockGatewayClient(0), transfers?: GalleryTransferService) {
  const Host = defineComponent({
    setup() {
      if (transfers) provideGalleryTransfers(transfers);
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: {
          get: (operations) =>
            Promise.resolve({
              items: operations.map((operation) => ({
                operation,
                allowed: true,
                reasonCode: 'TEST_ALLOWED'
              }))
            })
        },
        mode: 'mock'
      });
      return () => h(ProductsView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[VueQueryPlugin, { queryClient }]],
      stubs: { RowActionsMenu: { template: '<div><slot /></div>' } }
    }
  });
}

async function waitForProducts(wrapper: ReturnType<typeof mountView>): Promise<void> {
  await flushPromises();
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('Portable solar power station 1000W');
    expect(wrapper.get('select[aria-label="每页条数"]').attributes('disabled')).toBeUndefined();
  });
}

async function waitForSelectionCount(
  wrapper: ReturnType<typeof mountView>,
  expected: string,
  context: string
): Promise<void> {
  await flushPromises();
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="product-selection-count"]').text(), context).toBe(expected);
  });
}

function button(root: Node, label: string): HTMLButtonElement {
  if (!(root instanceof Element)) throw new Error('Toolbar root is not an element');
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function menuItem(label: string): HTMLElement {
  const match = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent.trim() === label
  );
  if (!match) throw new Error(`Missing menu item: ${label}`);
  return match;
}

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
