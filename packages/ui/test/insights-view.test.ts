// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import InsightsView from '../src/views/InsightsView.vue';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode
      });
      return () => h(InsightsView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function button(wrapper: ReturnType<typeof mountView>, text: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

describe('InsightsView', () => {
  it('applies date filters only after confirmation and rejects reversed ranges', async () => {
    const requests = vi.spyOn(MockGatewayClient.prototype, 'request');
    const wrapper = mountView();
    await button(wrapper, '采购供应商').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('supplier-enc-001');
    });
    await button(wrapper, 'supplier-enc-001').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
    });
    const initialCalls = requests.mock.calls.filter(
      ([operation]) => operation === 'listInsightsSupplierProducts'
    ).length;
    await button(wrapper, '筛选').trigger('click');
    await flushPromises();
    const from = document.querySelector<HTMLInputElement>('input[aria-label="开始日期"]');
    const to = document.querySelector<HTMLInputElement>('input[aria-label="结束日期"]');
    if (!from || !to) throw new Error('Missing date fields');
    await new DOMWrapper(from).setValue('2026-08-20');
    await new DOMWrapper(to).setValue('2026-08-01');
    const apply = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (item) => item.textContent.trim() === '应用筛选'
    );
    if (!apply) throw new Error('Missing apply');
    expect(apply.disabled).toBe(true);
    expect(document.body.textContent).toContain('结束时间不能早于开始时间');
    expect(
      requests.mock.calls.filter(([operation]) => operation === 'listInsightsSupplierProducts')
    ).toHaveLength(initialCalls);
    await new DOMWrapper(to).setValue('2026-08-25');
    apply.click();
    await vi.waitFor(() => {
      expect(requests).toHaveBeenCalledWith(
        'listInsightsSupplierProducts',
        expect.objectContaining({
          dateStart: '2026-08-20T00:00:00.000Z',
          dateEnd: '2026-08-25T23:59:59.999Z',
          page: 1
        })
      );
    });
    expect(wrapper.text()).toContain('筛选 · 1');
    await button(wrapper, '筛选').trigger('click');
    await flushPromises();
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'));
    controls.find((item) => item.textContent.trim() === '重置')?.click();
    await flushPromises();
    controls.find((item) => item.textContent.trim() === '取消')?.click();
    await flushPromises();
    expect(wrapper.text()).toContain('筛选 · 1');
    expect(
      requests.mock.calls.filter(([operation]) => operation === 'listInsightsSupplierProducts')
    ).toHaveLength(initialCalls + 1);
    wrapper.unmount();
  });
  it('shows rank values without inventing a business interpretation', async () => {
    const wrapper = mountView();
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('18.6%');
      expect(wrapper.text()).toContain('2026-08-12');
      expect(wrapper.text()).not.toContain('2026/08/12');
      expect(wrapper.text()).toContain('不生成“提升”“下降”或评级结论');
    });
    wrapper.unmount();
  });

  it('opens an encrypted supplier id and lists typed historical products', async () => {
    const wrapper = mountView();
    await button(wrapper, '采购供应商').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('supplier-enc-001');
      expect(wrapper.text()).toContain('不补造公司名称');
    });
    await button(wrapper, 'supplier-enc-001').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power station 1000W');
      expect(wrapper.text()).toContain('100003109');
    });
    wrapper.unmount();
  });

  it('never exposes a partner secret form for the restricted CGS capability', async () => {
    const wrapper = mountView('extension');
    await button(wrapper, '合作方能力').trigger('click');

    expect(wrapper.text()).toContain('默认关闭');
    expect(wrapper.text()).toContain('不会把密钥放入页面或普通设置');
    expect(wrapper.find('input').exists()).toBe(false);
    wrapper.unmount();
  });
});

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
