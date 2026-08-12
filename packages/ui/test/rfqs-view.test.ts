// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core';

import { provideServices } from '../src/lib/services';
import RfqsView from '../src/views/RfqsView.vue';

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode
      });
      return () => h(RfqsView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

describe('RfqsView', () => {
  it('searches RFQs, opens a detail and completes a Mock quotation', async () => {
    const wrapper = mountView();
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power stations');
    });

    const rfqButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Portable solar power stations'));
    if (!rfqButton) throw new Error('Missing RFQ row');
    await rfqButton.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Hamburg');
    });

    const textarea = wrapper.get('textarea');
    await textarea.setValue('We can supply this order.');
    const inputs = wrapper.findAll('input');
    const price = inputs.find((input) => input.attributes('placeholder') === '599.00');
    if (!price) throw new Error('Missing quotation price input');
    await price.setValue('599');
    const portLabel = wrapper.findAll('label').find((label) => label.text().includes('装运港'));
    const port = portLabel?.find('input');
    if (!port?.exists()) throw new Error('Missing shipment port input');
    await port.setValue('Shenzhen');

    const submit = wrapper.findAll('button').find((button) => button.text().includes('提交报价'));
    if (!submit) throw new Error('Missing quotation submit button');
    expect(submit.attributes('disabled')).toBeUndefined();
    await submit.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Mock 报价提交成功');
    });
    wrapper.unmount();
  });

  it('keeps real attachment upload and quotation disabled in extension mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power stations');
    });
    const rfqButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Portable solar power stations'));
    if (!rfqButton) throw new Error('Missing RFQ row');
    await rfqButton.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('真实附件上传和提交报价尚未通过账号 smoke test');
    const submit = wrapper.findAll('button').find((button) => button.text().includes('提交报价'));
    expect(submit?.attributes('disabled')).toBeDefined();
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined();
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
