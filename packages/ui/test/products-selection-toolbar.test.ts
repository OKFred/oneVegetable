// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn()
  }
}));

describe('ProductsView selection toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/products/list');
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
    expect(button(toolbar.element, '更多').disabled).toBe(true);
    expect(button(toolbar.element, '分组').querySelector('svg')).not.toBeNull();
    expect(button(toolbar.element, '新增').querySelector('svg')).not.toBeNull();
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['商品列表', '批量发品']);
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

  it('keeps the group column roomy and status and update time on one line', async () => {
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
    expect(groupCell.get('.min-w-20').classes()).toContain('block');
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

    button(toolbar.element, '刷新').click();

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
    await waitForSelectionCount(wrapper, '已选 0 个', 'search change');

    await wrapper.get('input[placeholder="按标题搜索"]').setValue('');
    await waitForProducts(wrapper);
    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    const pageSizeSelect = wrapper.get('select[aria-label="每页条数"]');
    const currentPageSize = (pageSizeSelect.element as HTMLSelectElement).value;
    expect(currentPageSize).toBe('20');
    await pageSizeSelect.setValue(currentPageSize === '10' ? '20' : '10');
    await waitForSelectionCount(wrapper, '已选 0 个', 'page-size change');

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    button(wrapper.element as Node, '新增').click();
    await wrapper.vm.$nextTick();
    await wrapper.get('summary').trigger('click');
    const languageSelect = wrapper.get('select[aria-label="商品表单语言"]');
    const currentLanguage = (languageSelect.element as HTMLSelectElement).value;
    await languageSelect.setValue(currentLanguage === 'zh_CN' ? 'en_US' : 'zh_CN');
    button(wrapper.element as Node, '商品列表').click();
    await wrapper.vm.$nextTick();
    await waitForSelectionCount(wrapper, '已选 0 个', 'language change');
    wrapper.unmount();
  });

  it('previews list images and queries product scores for selected products in sequence', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);

    const table = wrapper.get('table');
    const headers = table.findAll('th');
    expect(headers[0]?.classes()).toContain('sticky');
    expect(headers[1]?.classes()).toContain('sticky');
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
    menuItem('批量查询产品分').click();
    await flushPromises();

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('产品分查询完成：成功 2 个，失败 0 个。');
      expect(wrapper.text().match(/4\.6\/6/g)).toHaveLength(2);
    });
    expect(wrapper.text()).not.toContain('质量与上下架');
    wrapper.unmount();
  });
});

function mountView(gateway = new MockGatewayClient(0)) {
  const Host = defineComponent({
    setup() {
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
  return mount(Host, { attachTo: document.body, global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
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
