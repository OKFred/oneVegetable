// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';

import { OPERATION_IDS, StaticOperationAvailabilityClient, type OperationId } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import PhotosView from '../src/views/PhotosView.vue';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn() }
}));

function mountView(
  mode: 'mock' | 'extension' = 'mock',
  allowedOperations: ReadonlySet<OperationId> = new Set(OPERATION_IDS)
) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway: new MockGatewayClient(0),
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(allowedOperations),
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
  it('opens uploading as a dedicated workflow instead of a selection picker', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).not.toContain('选择或上传素材');
    await button(wrapper, '上传图片').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('上传图片到图库');
      expect(document.body.textContent).toContain('不会自动选入商品');
    });
    wrapper.unmount();
  });

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

  it('selects gallery images and opens the honest social sharing workflow', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(button(wrapper, '分享').attributes('disabled')).toBeDefined();
    await wrapper.get('input[aria-label="选择 solar-station-front.jpg"]').setValue(true);
    expect(wrapper.text()).toContain('已选 1 张');
    expect(button(wrapper, '分享 1 张').attributes('disabled')).toBeUndefined();
    await button(wrapper, '分享 1 张').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('分享图库素材');
      expect(document.body.textContent).toContain('Facebook Page');
      expect(document.body.textContent).toContain('需要配置');
    });
    wrapper.unmount();
  });

  it('collapses the group sidebar and exposes explicit tree expansion controls', async () => {
    const wrapper = mountView();
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.find('button[aria-label="展开商品主图"]').exists()).toBe(true);
    });
    await wrapper.get('button[aria-label="展开商品主图"]').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('白底主图');
      expect(wrapper.find('button[aria-label="收起商品主图"]').exists()).toBe(true);
    });
    await wrapper.get('button[aria-label="收起商品主图"]').trigger('click');
    expect(wrapper.text()).not.toContain('白底主图');

    await wrapper.get('button[aria-label="收起图库分组"]').trigger('click');
    expect(wrapper.find('[role="tree"][aria-label="图库分组"]').exists()).toBe(false);
    await wrapper.get('button[aria-label="展开图库分组"]').trigger('click');
    expect(wrapper.find('[role="tree"][aria-label="图库分组"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('moves gallery writes into a dedicated tree management dialog', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('input[aria-label="图库分组名称"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('真实分组新增、改名和删除');
    await button(wrapper, '分组管理').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('图库分组管理');
      expect(document.body.textContent).toContain('全部图片');
      expect(document.body.textContent).toContain('商品主图');
    });
    wrapper.unmount();
  });

  it('enables the account-verified group manager outside Mock mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();

    expect(button(wrapper, '分组管理').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toMatch(/BFF|OpenAPI 演示|Extension API/);
    await button(wrapper, '分组管理').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('新增、改名和删除会直接写入当前国际站账号');
    });
    wrapper.unmount();
  });

  it('disables gallery writes with the operation availability reason', async () => {
    const wrapper = mountView('extension', new Set());
    await flushPromises();

    expect(button(wrapper, '分组管理').attributes('disabled')).toBeUndefined();
    expect(button(wrapper, '上传图片').attributes('disabled')).toBeDefined();
    await button(wrapper, '分组管理').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('当前环境未开放图库分组写入（STATIC_DISABLED）');
    });
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
