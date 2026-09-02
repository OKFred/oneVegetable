// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GatewayException,
  OPERATION_IDS,
  StaticOperationAvailabilityClient,
  type GatewayClient,
  type OperationId,
  type RequestOf,
  type ResponseOf
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import RfqsView from '../src/views/RfqsView.vue';

function mountView(
  mode: 'mock' | 'extension' | 'bff' = 'mock',
  gateway: GatewayClient = new MockGatewayClient(0)
) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(
          new Set(mode === 'mock' ? OPERATION_IDS : [])
        ),
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

afterEach(() => {
  globalThis.document.body.innerHTML = '';
});

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
      expect(bodyText()).toContain('演示报价提交成功');
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

    expect(bodyText()).toContain('真实附件上传或报价提交未开放');
    expect(bodyButton('提交报价').disabled).toBe(true);
    expect(document.body.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    wrapper.unmount();
  });

  it('stops RFQ requests after the real account is denied the API package', async () => {
    const gateway = new TrackingGateway(true);
    const wrapper = mountView('bff', gateway);

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('当前应用未获得 RFQ API 包权限');
      expect(wrapper.text()).toContain('isv.permission-api-package-limit');
    });
    expect(gateway.calls).toEqual(['getRfqEquity']);
    const marketplace = wrapper.get('a[href="https://sourcing.alibaba.com/"]');
    expect(marketplace.text()).toContain('前往 Alibaba.com RFQ 市场');
    expect(marketplace.attributes()).toMatchObject({ target: '_blank', rel: 'noreferrer' });
    wrapper.unmount();
  });

  it('applies search filters explicitly instead of querying for every keystroke', async () => {
    const gateway = new TrackingGateway();
    const wrapper = mountView('mock', gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power stations');
    });
    const initialSearches = gateway.calls.filter((operation) => operation === 'listRfqs').length;

    await wrapper.get('input[placeholder="搜索采购标题或描述"]').setValue('battery');
    await flushPromises();
    expect(gateway.calls.filter((operation) => operation === 'listRfqs')).toHaveLength(initialSearches);

    bodyButton('查询').click();
    await flushPromises();
    await vi.waitFor(() => {
      expect(gateway.calls.filter((operation) => operation === 'listRfqs')).toHaveLength(initialSearches + 1);
    });
    wrapper.unmount();
  });

  it('keeps BFF attachment and quotation controls disabled before account validation', async () => {
    const wrapper = mountView('bff');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Portable solar power stations');
      expect(wrapper.text()).toContain('真实附件上传或报价提交未开放（STATIC_DISABLED）');
    });
    const rfqButton = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Portable solar power stations'));
    if (!rfqButton) throw new Error('Missing RFQ row');
    await rfqButton.trigger('click');
    await flushPromises();

    expect(bodyButton('提交报价').disabled).toBe(true);
    expect(document.body.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    wrapper.unmount();
  });
});

class TrackingGateway extends MockGatewayClient {
  readonly calls: OperationId[] = [];

  constructor(private readonly denyRfqPackage = false) {
    super(0);
  }

  override request<K extends OperationId>(operation: K, request: RequestOf<K>): Promise<ResponseOf<K>> {
    this.calls.push(operation);
    if (this.denyRfqPackage && operation === 'getRfqEquity') {
      return Promise.reject(
        new GatewayException({
          code: '11',
          subCode: 'isv.permission-api-package-limit',
          message: 'RFQ API package permission denied',
          traceId: 'rfq-test-trace',
          retryable: false
        })
      );
    }
    return super.request(operation, request);
  }
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
