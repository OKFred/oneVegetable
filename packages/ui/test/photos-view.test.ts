// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { MockGatewayClient } from '@one-vegetable/core';

import { provideServices } from '../src/lib/services';
import PhotosView from '../src/views/PhotosView.vue';

function mountView(mode: 'mock' | 'extension' = 'mock') {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        mode
      });
      return () => h(PhotosView);
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

describe('PhotosView', () => {
  it('shows file metadata and non-blocking governance filters', async () => {
    const wrapper = mountView();
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('素材治理');
      expect(wrapper.text()).toContain('建议不阻断使用');
      expect(wrapper.text()).toContain('图库 fileId：ph_001');
      expect(wrapper.text()).toContain('低分辨率 1');
    });
    expect(wrapper.find('button[aria-label^="预览 "]').exists()).toBe(true);
    await button(wrapper, '低分辨率 1').trigger('click');
    expect(wrapper.text()).toContain('dehydrator-detail.jpg');
    expect(wrapper.text()).not.toContain('solar-station-front.jpg');
    wrapper.unmount();
  });

  it('supports group rename in Mock mode', async () => {
    const wrapper = mountView();
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('商品主图');
    });
    await button(wrapper, '商品主图').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('白底主图');
    });
    await wrapper.get('input[aria-label="图库分组名称"]').setValue('主图新版');
    await button(wrapper, '改名').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('分组已保存：主图新版');
      expect(wrapper.text()).toContain('主图新版');
    });
    wrapper.unmount();
  });

  it('keeps real group mutations disabled before account verification', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await wrapper.get('input[aria-label="图库分组名称"]').setValue('真实分组');

    expect(button(wrapper, '新增').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Extension API 查询');
    expect(wrapper.text()).toContain('真实分组写操作尚未完成账号 smoke test');
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
