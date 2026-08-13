// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core';

import CapabilitiesView from '../src/views/CapabilitiesView.vue';
import { provideServices } from '../src/lib/services';

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode
      });
      return () => h(CapabilitiesView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function methodButton(wrapper: ReturnType<typeof mountView>, method: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === method);
  if (!result) throw new Error(`Missing method: ${method}`);
  return result;
}

function callButton(wrapper: ReturnType<typeof mountView>) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text().includes('调用能力'));
  if (!result) throw new Error('Missing call button');
  return result;
}

describe('CapabilitiesView platform safeguards', () => {
  it('shows risk protocol parameters read-only and explains sensitive data handling', async () => {
    const wrapper = mountView();
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('alibaba.icbu.risk.send');
    });
    await methodButton(wrapper, 'alibaba.icbu.risk.send').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('WUA、UMID、IMEI、IMSI、MAC');
    });

    expect(wrapper.find('pre[aria-label="只读文档参数示例"]').exists()).toBe(true);
    expect(wrapper.find('textarea[aria-label="调用参数 JSON"]').exists()).toBe(false);
    expect(callButton(wrapper).attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('keeps generic file transfer separate from the gallery and closed in the extension', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('alibaba.icbu.file.urlposting.upload');
    });
    await methodButton(wrapper, 'alibaba.icbu.file.urlposting.upload').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('不返回图库 fileId');
    });

    expect(wrapper.find('textarea[aria-label="调用参数 JSON"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('扩展中不可调用');
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
