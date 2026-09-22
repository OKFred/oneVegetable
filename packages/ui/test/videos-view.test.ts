// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import VideosView from '../src/views/VideosView.vue';

vi.mock('vue-sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
const mounted: VueWrapper[] = [];
function mountView(gateway = new MockGatewayClient(0)) {
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({ gateway, mode: 'mock', settings: { load: vi.fn(), save: vi.fn() } });
        return () => h(VideosView);
      }
    }),
    { attachTo: document.body }
  );
  mounted.push(wrapper);
  return wrapper;
}

describe('VideosView search toolbar', () => {
  beforeEach(() => {
    uiI18n.global.locale.value = 'zh-CN';
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
    uiI18n.global.locale.value = 'zh-CN';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bypasses read cache on every explicit search, including unchanged conditions', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Example clothing video');
    });
    const toolbar = wrapper.get('[data-testid="video-toolbar"]');
    const form = toolbar.get('form');
    expect(form.classes()).toContain('flex-wrap');
    expect(form.get('input').classes()).toContain('sm:w-56');
    expect(form.text()).toContain('搜索');
    expect(form.text()).toContain('筛选');
    expect(form.text()).not.toContain('上传');
    expect(toolbar.text()).not.toContain('刷新');
    expect(toolbar.classes()).not.toContain('justify-between');
    await form.get('input').setValue('unlinked');
    expect(wrapper.text()).toContain('Example clothing video');
    request.mockClear();
    await form.trigger('submit');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Example unlinked video');
      expect(wrapper.text()).not.toContain('Example clothing video');
    });
    expect(request.mock.calls.filter(([operation]) => operation === 'listVideos')).toHaveLength(1);
    expect(request).toHaveBeenCalledWith(
      'listVideos',
      { page: 1, pageSize: 20, title: 'unlinked' },
      expect.anything()
    );
    await form.trigger('submit');
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([operation]) => operation === 'listVideos')).toHaveLength(2);
      expect(form.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    });
  });

  it('can retry a failed list read from search and retains the English action label', async () => {
    const gateway = new MockGatewayClient(0);
    const request = vi.spyOn(gateway, 'request');
    const wrapper = mountView(gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Example clothing video');
    });
    const form = wrapper.get('[data-testid="video-toolbar"] form');
    request.mockRejectedValueOnce(new Error('Video read unavailable'));
    await form.trigger('submit');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Video read unavailable');
    });
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(form.get('button[type="submit"]').text()).toBe('Search');
    await form.trigger('submit');
    await vi.waitFor(() => {
      expect(wrapper.text()).not.toContain('Video read unavailable');
      expect(wrapper.text()).toContain('Example clothing video');
    });
  });
});
