// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import ProductsView from '../src/views/ProductsView.vue';

describe('ProductsView selection toolbar', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/products/list');
  });

  it('supports unchecked, mixed and current-page selected states with a visible count', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);
    const toolbar = wrapper.get('[role="toolbar"][aria-label="商品列表操作"]');
    const selectPage = wrapper.get('input[aria-label="选择本页全部 3 个商品"]');

    expect(toolbar.text()).toContain('已选 0 个');
    expect((selectPage.element as HTMLInputElement).indeterminate).toBe(false);
    expect(selectPage.attributes('aria-checked')).toBe('false');
    expect(button(toolbar.element, '清空').disabled).toBe(true);
    expect(button(toolbar.element, '导出').disabled).toBe(true);

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    expect(toolbar.text()).toContain('已选 1 个');
    expect((selectPage.element as HTMLInputElement).indeterminate).toBe(true);
    expect(selectPage.attributes('aria-checked')).toBe('mixed');
    expect(button(toolbar.element, '清空').disabled).toBe(false);
    expect(button(toolbar.element, '导出').disabled).toBe(false);

    await selectPage.setValue(true);
    expect(toolbar.text()).toContain('已选 3 个');
    expect(
      (wrapper.get('input[aria-label="取消选择本页全部 3 个商品"]').element as HTMLInputElement).checked
    ).toBe(true);

    button(toolbar.element, '清空').click();
    await wrapper.vm.$nextTick();
    expect(toolbar.text()).toContain('已选 0 个');
    expect(
      (wrapper.get('input[aria-label="选择本页全部 3 个商品"]').element as HTMLInputElement).checked
    ).toBe(false);
    wrapper.unmount();
  });

  it('clears current-page selection when search, page size or language changes', async () => {
    const wrapper = mountView();
    await waitForProducts(wrapper);
    const selectedCount = () => wrapper.get('[aria-live="polite"]').text();

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    expect(selectedCount()).toContain('已选 1 个');
    await wrapper.get('input[placeholder="按标题搜索"]').setValue('canvas');
    expect(selectedCount()).toContain('已选 0 个');
    await flushPromises();

    await wrapper.get('input[placeholder="按标题搜索"]').setValue('');
    await waitForProducts(wrapper);
    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    await wrapper.get('select[aria-label="每页条数"]').setValue('10');
    expect(selectedCount()).toContain('已选 0 个');
    await waitForProducts(wrapper);

    await wrapper.get('input[aria-label="选择 Portable solar power station 1000W"]').setValue(true);
    button(wrapper.element as Node, '商品发布/编辑').click();
    await wrapper.vm.$nextTick();
    await wrapper.get('summary').trigger('click');
    await wrapper.get('select[aria-label="商品表单语言"]').setValue('zh_CN');
    button(wrapper.element as Node, '商品列表').click();
    await wrapper.vm.$nextTick();
    expect(selectedCount()).toContain('已选 0 个');
    wrapper.unmount();
  });
});

function mountView() {
  const gateway = new MockGatewayClient(0);
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

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
