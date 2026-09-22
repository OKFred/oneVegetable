// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount, DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPERATION_IDS, StaticOperationAvailabilityClient, type OperationId } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import PhotosView from '../src/views/PhotosView.vue';
import { uiI18n } from '../src/i18n';

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));
const mounted: VueWrapper[] = [];

function mountView(
  mode: 'mock' | 'extension' = 'mock',
  allowedOperations: ReadonlySet<OperationId> = new Set(OPERATION_IDS),
  gateway = new MockGatewayClient(0)
) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(allowedOperations),
        mode
      });
      return () => h(PhotosView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
  mounted.push(wrapper);
  return wrapper;
}

function button(wrapper: ReturnType<typeof mountView>, text: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

async function applyLowResolution(wrapper: ReturnType<typeof mountView>) {
  await button(wrapper, '筛选').trigger('click');
  await flushPromises();
  const select = document.querySelector<HTMLSelectElement>('select[data-testid="photo-dimension-filter"]');
  if (!select) throw new Error('Missing dimension filter');
  select.value = 'lowResolution';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flushPromises();
  Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent === '应用筛选')
    ?.click();
  await flushPromises();
}

describe('PhotosView', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
  });
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => {
      wrapper.unmount();
    });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    uiI18n.global.locale.value = 'zh-CN';
  });

  it('applies filters only after confirmation and keeps cancelled changes out of requests', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView('mock', undefined, gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('solar-station-front.jpg');
    });
    const body = new DOMWrapper(document.body);
    request.mockClear();
    await button(wrapper, '筛选').trigger('click');
    await flushPromises();
    await body.get('select[data-testid="photo-dimension-filter"]').setValue('lowResolution');
    await body
      .findAll('button')
      .find((candidate) => candidate.text() === '取消')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('solar-station-front.jpg');
    expect(request).not.toHaveBeenCalled();
    await applyLowResolution(wrapper);
    expect(wrapper.text()).not.toContain('solar-station-front.jpg');
    expect(wrapper.text()).toContain('dehydrator-detail.jpg');
    expect(request).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('requests server pages even when totals are unknown, and clears selection on page changes', async () => {
    const gateway = new MockGatewayClient(0);
    const original = gateway.request.bind(gateway);
    const request = vi.spyOn(gateway, 'request').mockImplementation(async (operation, payload) => {
      if (operation !== 'listPhotos') return original(operation, payload);
      const result = await original('listPhotos', {});
      return { ...result, total: null, hasNextPage: true };
    });
    const wrapper = mountView('mock', undefined, gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('solar-station-front.jpg');
    });
    await wrapper.get('input[aria-label="选择 solar-station-front.jpg"]').setValue(true);
    request.mockClear();
    await wrapper.get('button[aria-label="下一页"]').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledWith('listPhotos', { page: 2, pageSize: 24, groupId: '-1' });
    expect(wrapper.text()).toContain('已选 0 张');
    await vi.waitFor(() => {
      expect(wrapper.get('select[aria-label="每页条数"]').attributes('disabled')).toBeUndefined();
    });
    await wrapper.get('select[aria-label="每页条数"]').setValue('48');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listPhotos', { page: 1, pageSize: 48, groupId: '-1' });
    });
    wrapper.unmount();
  });

  it('does not preview an image when its name or row is clicked', async () => {
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('solar-station-front.jpg');
    });
    await button(wrapper, '列表').trigger('click');
    const name = wrapper.findAll('p').find((candidate) => candidate.text() === 'solar-station-front.jpg');
    await name?.trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="image-preview-stage"]')).toBeNull();
    await wrapper.get('button[aria-label="预览 solar-station-front.jpg"]').trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="image-preview-stage"]')).not.toBeNull();
    wrapper.unmount();
  });

  it('keeps search and filters together with one toolbar and no duplicate refresh button', async () => {
    const wrapper = mountView();
    await flushPromises();
    const toolbar = wrapper.get('[data-testid="photo-toolbar"]');
    const form = toolbar.get('form');
    expect(form.classes()).toContain('flex-wrap');
    expect(form.get('input').classes()).toContain('sm:w-56');
    expect(form.find('input[aria-label="本页名称 / fileId"]').exists()).toBe(true);
    expect(form.get('button[type="submit"]').text()).toBe('搜索');
    expect(form.text()).toContain('筛选');
    expect(form.text()).not.toContain('导入');
    expect(toolbar.text()).toContain('导入');
    expect(toolbar.text()).toContain('卡片');
    expect(toolbar.text()).not.toContain('刷新');
    expect(toolbar.classes()).not.toContain('justify-between');
    wrapper.unmount();
  });

  it('applies the page search before refreshing the new page key and groups', async () => {
    const gateway = new MockGatewayClient(20);
    const original = gateway.request.bind(gateway);
    const request = vi.spyOn(gateway, 'request').mockImplementation(async (operation, payload) => {
      if (operation !== 'listPhotos') return original(operation, payload);
      return { ...(await original('listPhotos', {})), total: null, hasNextPage: true };
    });
    const wrapper = mountView('mock', undefined, gateway);
    await vi.waitFor(() => {
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
      expect(wrapper.text()).toContain('solar-station-front.jpg');
    });
    await wrapper.get('button[aria-label="下一页"]').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listPhotos', { page: 2, pageSize: 24, groupId: '-1' });
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    await wrapper.get('input[aria-label="本页名称 / fileId"]').setValue('dehydrator');
    expect(wrapper.text()).toContain('solar-station-front.jpg');
    request.mockClear();
    await button(wrapper, '搜索').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listPhotos', { page: 1, pageSize: 24, groupId: '-1' });
      expect(request).toHaveBeenCalledWith('listPhotoGroups', undefined);
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    expect(request.mock.calls.filter(([operation]) => operation === 'listPhotos')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('solar-station-front.jpg');
    expect(wrapper.text()).toContain('dehydrator-detail.jpg');
    wrapper.unmount();
  });

  it('uses repeated search to refresh photos and expanded groups while retaining filters and layout', async () => {
    const gateway = new MockGatewayClient(40);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView('mock', undefined, gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('详情素材');
    });
    await button(wrapper, '详情素材').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('户外场景');
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    await applyLowResolution(wrapper);
    await wrapper.get('input[aria-label="选择 dehydrator-detail.jpg"]').setValue(true);
    await button(wrapper, '列表').trigger('click');
    request.mockClear();

    await button(wrapper, '搜索').trigger('click');
    await flushPromises();
    expect(button(wrapper, '搜索').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '搜索').attributes('aria-busy')).toBe('true');
    await button(wrapper, '搜索').trigger('click');
    await vi.waitFor(() => {
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });

    expect(request.mock.calls).toEqual([
      ['listPhotos', { page: 1, pageSize: 24, groupId: '2002' }],
      ['listPhotoGroups', undefined],
      ['listPhotoGroups', { parentId: '2002' }]
    ]);
    expect(wrapper.find('[data-testid="photo-list-table"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('已选 0 张');
    expect(wrapper.find('button[aria-label="收起详情素材"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('户外场景');
    request.mockClear();
    await button(wrapper, '搜索').trigger('click');
    await vi.waitFor(() => {
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
      expect(request).toHaveBeenCalledWith('listPhotos', { page: 1, pageSize: 24, groupId: '2002' });
      expect(request).toHaveBeenCalledWith('listPhotoGroups', { parentId: '2002' });
    });
    await button(wrapper, '全部图片').trigger('click');
    await vi.waitFor(() => {
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    expect(wrapper.find('[data-testid="photo-list-table"]').text()).not.toContain('solar-station-front.jpg');
    wrapper.unmount();
  });

  it('refreshes groups even with the sidebar collapsed and renders the control in English', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView('mock', undefined, gateway);
    await vi.waitFor(() => {
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    await wrapper.get('button[aria-label="收起图片分组"]').trigger('click');
    request.mockClear();
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();

    await button(wrapper, 'Search').trigger('click');
    await vi.waitFor(() => {
      expect(button(wrapper, 'Search').attributes('disabled')).toBeUndefined();
    });
    expect(request.mock.calls).toEqual([
      ['listPhotos', { page: 1, pageSize: 24, groupId: '-1' }],
      ['listPhotoGroups', undefined]
    ]);
    expect(wrapper.find('[role="tree"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows read errors and allows another search to recover', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView('mock', undefined, gateway);
    await vi.waitFor(() => {
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    request.mockRejectedValueOnce(new Error('Photo refresh failed'));

    await button(wrapper, '搜索').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Photo refresh failed');
      expect(button(wrapper, '搜索').attributes('disabled')).toBeUndefined();
    });
    expect(wrapper.text()).toContain('商品主图');
    await button(wrapper, '搜索').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).not.toContain('Photo refresh failed');
      expect(wrapper.text()).toContain('solar-station-front.jpg');
    });
    wrapper.unmount();
  });

  it('opens uploading as a dedicated workflow instead of a selection picker', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).not.toContain('选择或上传素材');
    await button(wrapper, '上传').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('上传图片到图片库');
      expect(document.body.textContent).toContain('不会自动选入商品');
    });
    wrapper.unmount();
  });

  it('shows file metadata and non-blocking governance filters', async () => {
    const wrapper = mountView();
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('低于 750 × 750');
      expect(wrapper.text()).toContain('fileId：ph_001');
      expect(wrapper.text()).toContain('低于 750 × 750');
    });
    expect(wrapper.find('button[aria-label^="预览 "]').exists()).toBe(true);
    await applyLowResolution(wrapper);
    expect(wrapper.text()).toContain('dehydrator-detail.jpg');
    expect(wrapper.text()).not.toContain('solar-station-front.jpg');
    wrapper.unmount();
  });

  it('switches between card and list views without losing the current selection', async () => {
    const wrapper = mountView();
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="photo-card-grid"]').exists()).toBe(true);
    });
    const viewSwitcher = wrapper.get('[role="group"][aria-label="图片展示方式"]');
    const cardButton = viewSwitcher.findAll('button').find((candidate) => candidate.text() === '卡片');
    const listButton = viewSwitcher.findAll('button').find((candidate) => candidate.text() === '列表');
    if (!cardButton || !listButton) throw new Error('Missing gallery view switcher buttons');

    expect(cardButton.attributes('aria-pressed')).toBe('true');
    await listButton.trigger('click');

    expect(wrapper.find('[data-testid="photo-card-grid"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="photo-list-table"] table').exists()).toBe(true);
    expect(listButton.attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[data-testid="photo-list-table"]').text()).toContain('solar-station-front.jpg');
    expect(wrapper.find('[data-testid="photo-list-table"]').text()).toContain('fileId：ph_001');

    await wrapper.get('input[aria-label="选择 solar-station-front.jpg"]').setValue(true);
    expect(wrapper.text()).toContain('已选 1 张');
    await cardButton.trigger('click');

    expect(wrapper.find('[data-testid="photo-card-grid"]').exists()).toBe(true);
    expect(
      (wrapper.get('input[aria-label="取消选择 solar-station-front.jpg"]').element as HTMLInputElement)
        .checked
    ).toBe(true);
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
      expect(document.body.textContent).toContain('分享图片素材');
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

    await wrapper.get('button[aria-label="收起图片分组"]').trigger('click');
    expect(wrapper.find('[role="tree"][aria-label="图片分组"]').exists()).toBe(false);
    await wrapper.get('button[aria-label="展开图片分组"]').trigger('click');
    expect(wrapper.find('[role="tree"][aria-label="图片分组"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('moves gallery writes into a dedicated tree management dialog', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find('input[aria-label="图片分组名称"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('真实分组新增、改名和删除');
    await button(wrapper, '分组管理').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('图片分组管理');
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
    expect(button(wrapper, '上传').attributes('disabled')).toBeDefined();
    await button(wrapper, '分组管理').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('当前环境未开放图片分组写入（STATIC_DISABLED）');
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
