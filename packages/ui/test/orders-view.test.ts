// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_PREFERENCES_STORAGE_KEY,
  OPERATION_IDS,
  StaticOperationAvailabilityClient
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import OrdersView from '../src/views/OrdersView.vue';

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(
          new Set(mode === 'mock' ? OPERATION_IDS : [])
        ),
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

function bodyButton(text: string): HTMLButtonElement {
  const result = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.includes(text) || candidate.getAttribute('aria-label') === text
  );
  if (!result) throw new Error(`Missing body button: ${text}`);
  return result;
}

describe('OrdersView', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/orders');
  });

  it('uses the preferred language for fulfillment and address Schema requests', async () => {
    localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify({ language: 'en_US' }));
    const request = vi.spyOn(MockGatewayClient.prototype, 'request');
    const wrapper = mountView();
    await flushPromises();

    await button(wrapper, '资金与履约').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listTradeFulfillmentChannels', { language: 'en_US' });
    });

    await button(wrapper, '地址 Schema').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('getTradeAddressSchema', {
        countryCode: 'US',
        language: 'en_US'
      });
    });
    wrapper.unmount();
  });

  it('opens the non-Jushita aggregate and shows independent fund and logistics results', async () => {
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('24668306501026709');
    });

    const firstRow = wrapper.find('tbody tr');
    expect(firstRow.attributes('tabindex')).toBe('0');
    await firstRow.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('订单 24668306501026709');
      expect(document.body.textContent).toContain('2450.50');
      expect(document.body.textContent).toContain('fullDetail: jushita-only');
    });

    bodyButton('TT 汇款').click();
    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="tt-account-number"]')?.textContent).not.toContain(
        '1029200038060'
      );
    });
    bodyButton('显示完整汇款账号').click();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="tt-account-number"]')?.textContent).toContain(
        '1029200038060'
      );
    });
    bodyButton('查看下一条订单').click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('订单 24668306501026710');
      expect(document.body.querySelector('[data-testid="tt-account-number"]')).toBeNull();
    });
    bodyButton('关闭详情').click();

    await button(wrapper, '资金与履约').trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('一达通');
      expect(wrapper.text()).not.toContain('1029200038060');
    });
    wrapper.unmount();
  });

  it('restores the selected order and drawer section from a deep hash route', async () => {
    globalThis.history.replaceState(null, '', '#/orders/orders/24668306501026709/payment');
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('订单 24668306501026709');
      expect(document.body.querySelector('[aria-label="TT 汇款信息"]')).not.toBeNull();
    });
    expect(globalThis.location.hash).toBe('#/orders/orders/24668306501026709/payment');

    bodyButton('关闭详情').click();
    await flushPromises();
    expect(globalThis.location.hash).toBe('#/orders/orders');
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
    const create = button(wrapper, '创建演示信保订单');
    expect(create.attributes('disabled')).toBeUndefined();
    await create.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('演示订单创建成功');
    });
    wrapper.unmount();
  });

  it('keeps trade mutations disabled in extension mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await button(wrapper, '信保订单草稿').trigger('click');

    expect(wrapper.text()).toContain('当前环境未开放信保订单创建（STATIC_DISABLED）');
    expect(button(wrapper, '创建信保订单（未开放）').attributes('disabled')).toBeDefined();
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
