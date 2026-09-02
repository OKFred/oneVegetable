// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import InsightsView from '../src/views/InsightsView.vue';

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
