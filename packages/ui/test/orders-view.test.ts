// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core';

import { provideServices } from '../src/lib/services';
import OrdersView from '../src/views/OrdersView.vue';

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode
      });
      return () => h(OrdersView);
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

describe('OrdersView', () => {
  it('opens the non-Jushita aggregate and shows independent fund and logistics results', async () => {
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('24668306501026709');
    });

    await button(wrapper, '24668306501026709').trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('聚合详情 · 24668306501026709');
      expect(wrapper.text()).toContain('2450.50');
      expect(wrapper.text()).toContain('fullDetail: jushita-only');
    });

    await button(wrapper, '资金与履约').trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('一达通');
      expect(wrapper.text()).toContain('1029200038060');
    });
    wrapper.unmount();
  });

  it('renders address Schema without persisting PII and completes a Web Mock order draft', async () => {
    const wrapper = mountView();
    await flushPromises();
    await button(wrapper, '地址 Schema').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('contact.fullName');
      expect(wrapper.text()).toContain('不会持久化');
    });

    const email = wrapper.find('input[type="email"]');
    await email.setValue('buyer@example.com');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Northwind warehouse');
    });

    await button(wrapper, '信保订单草稿').trigger('click');
    const values: Record<string, string> = {
      买家登录名: 'northwind-buyer',
      '商品 ID': '10000001',
      商品名称: 'Portable solar power station',
      数量: '10',
      单价: '599'
    };
    for (const [placeholder, value] of Object.entries(values)) {
      await wrapper.get(`input[placeholder="${placeholder}"]`).setValue(value);
    }
    const create = button(wrapper, '创建 Mock 信保订单');
    expect(create.attributes('disabled')).toBeUndefined();
    await create.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Mock 创建成功');
    });
    wrapper.unmount();
  });

  it('keeps trade mutations disabled in extension mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await button(wrapper, '信保订单草稿').trigger('click');

    expect(wrapper.text()).toContain('扩展真实写入已禁用');
    expect(button(wrapper, '创建 Mock 信保订单').attributes('disabled')).toBeDefined();
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
