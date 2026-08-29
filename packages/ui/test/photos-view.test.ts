// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';

import { OPERATION_IDS, StaticOperationAvailabilityClient, type OperationId } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import PhotosView from '../src/views/PhotosView.vue';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn() }
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
      expect(toast.success).toHaveBeenCalledWith('分组已保存：主图新版');
      expect(wrapper.text()).toContain('主图新版');
    });
    wrapper.unmount();
  });

  it('enables account-verified group mutations outside Mock mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await wrapper.get('input[aria-label="图库分组名称"]').setValue('真实分组');

    expect(button(wrapper, '新增').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('Extension API 查询');
    expect(wrapper.text()).toContain('真实分组新增、改名和删除已完成账号验证');
    wrapper.unmount();
  });

  it('requires confirmation before deleting a real gallery group', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('商品主图');
    });
    await button(wrapper, '商品主图').trigger('click');
    await button(wrapper, '删除').trigger('click');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('删除图库分组');
    });
    expect(document.body.textContent).toContain('这是国际站真实写操作');
    const confirm = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
      candidate.textContent.includes('确认删除')
    );
    if (!(confirm instanceof HTMLButtonElement)) throw new Error('Missing delete confirmation button');
    confirm.click();
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('已删除所选分组');
    });
    wrapper.unmount();
  });

  it('disables gallery writes with the operation availability reason', async () => {
    const wrapper = mountView('extension', new Set());
    await flushPromises();
    await wrapper.get('input[aria-label="图库分组名称"]').setValue('不可写分组');

    expect(button(wrapper, '新增').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '上传图片').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('当前环境未开放图库分组写入（STATIC_DISABLED）');
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
