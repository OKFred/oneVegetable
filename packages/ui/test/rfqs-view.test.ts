// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core/mock';

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

function bodyText(): string {
  return document.body.textContent;
}

function bodyButton(text: string): HTMLButtonElement {
  const result = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent.includes(text)
  );
  if (!result) throw new Error(`Missing body button: ${text}`);
  return result;
}

function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
      expect(bodyText()).toContain('Hamburg');
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('Missing quotation message input');
    inputValue(textarea, 'We can supply this order.');
    const price = document.body.querySelector<HTMLInputElement>('input[placeholder="599.00"]');
    if (!price) throw new Error('Missing quotation price input');
    inputValue(price, '599');
    const portLabel = [...document.body.querySelectorAll<HTMLLabelElement>('label')].find((label) =>
      label.textContent.includes('装运港')
    );
    const port = portLabel?.querySelector<HTMLInputElement>('input');
    if (!port) throw new Error('Missing shipment port input');
    inputValue(port, 'Shenzhen');
    await flushPromises();

    const submit = bodyButton('提交报价');
    expect(submit.disabled).toBe(false);
    submit.click();
    await flushPromises();
    await vi.waitFor(() => {
      expect(bodyText()).toContain('Mock 报价提交成功');
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

    expect(bodyText()).toContain('真实附件上传和提交报价尚未通过账号 smoke test');
    expect(bodyButton('提交报价').disabled).toBe(true);
    expect(document.body.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
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
