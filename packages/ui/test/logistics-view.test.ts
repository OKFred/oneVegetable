// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { OPERATION_IDS, StaticOperationAvailabilityClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import LogisticsView from '../src/views/LogisticsView.vue';

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
      return () => h(LogisticsView);
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

function bodyText(): string {
  return document.body.textContent;
}

describe('LogisticsView', () => {
  it('completes the Web Mock quote and creates an order from the selected product', async () => {
    const wrapper = mountView();
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('邮政 e 邮宝');
      expect(wrapper.text()).toContain('电池 · battery');
    });

    expect(button(wrapper, '开始试算').classes()).toContain('bg-primary');
    await button(wrapper, '开始试算').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('CNY 109.20');
      expect(wrapper.text()).toContain('可用');
    });

    await button(wrapper, '下单草稿').trigger('click');
    const create = button(wrapper, '提交物流订单');
    expect(create.attributes('disabled')).toBeUndefined();
    expect(create.classes()).toContain('bg-primary');
    await create.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('演示下单成功');
      expect(wrapper.text()).toContain('ALS00201756999');
    });
    wrapper.unmount();
  });

  it('shows typed orders, Base64 labels, address nodes and shipping templates', async () => {
    const wrapper = mountView();
    const previousWorkspace = wrapper.get('button[aria-pressed="true"]');
    expect(previousWorkspace.classes()).toContain('bg-secondary');
    await button(wrapper, '物流订单').trigger('click');
    expect(previousWorkspace.attributes('aria-pressed')).toBe('false');
    expect(previousWorkspace.classes()).not.toContain('bg-secondary');
    expect(button(wrapper, '物流订单').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '物流订单').classes()).toContain('bg-secondary');
    const search = wrapper.get('[data-testid="logistics-toolbar"] button[type="submit"]');
    expect(search.attributes('data-list-action')).toBeDefined();
    expect(search.classes()).toEqual(expect.arrayContaining(['h-9', 'border-input']));
    expect(search.find('svg[aria-hidden="true"]').exists()).toBe(true);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('ALS00201756002');
    });
    await button(wrapper, 'ALS00201756002').trigger('click');
    await vi.waitFor(() => {
      expect(bodyText()).toContain('Base64 数据已返回');
      expect(bodyText()).toContain('YT202608120001');
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    await button(wrapper, '地址与模板').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('浙江省');
      expect(wrapper.text()).toContain('北美包邮模板');
    });
    wrapper.unmount();
  });

  it('keeps every OneTouch action disabled in extension mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();

    expect(wrapper.text()).not.toContain('STATIC_DISABLED');
    expect(button(wrapper, '业务资格待验收').attributes('disabled')).toBeDefined();
    await button(wrapper, '物流订单').trigger('click');
    expect(button(wrapper, '搜索').attributes('disabled')).toBeDefined();
    await button(wrapper, '下单草稿').trigger('click');
    expect(button(wrapper, '真实下单保持禁用').attributes('disabled')).toBeDefined();
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
