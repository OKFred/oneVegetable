// @vitest-environment jsdom
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VideoDrawer from '../src/components/VideoDrawer.vue';
import { provideServices } from '../src/lib/services';
import { MockGatewayClient } from '../../core/src/mock-client';
import { VIDEO_MOCK_DATA } from '../../core/src/generated/mock-data';
import { pageDetailIdentity } from '../src/lib/page-details';
import type { Video } from '../../core/src/types';
describe('video drawer resource lifetime', () => {
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
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });
  it('does not query relations before entry and releases media on close', async () => {
    const gateway = new MockGatewayClient(0),
      request = vi.spyOn(gateway, 'request');
    const identity = await pageDetailIdentity(gateway, 'mock');
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const parent = defineComponent({
      props: { video: { type: Object, required: true } },
      setup(props) {
        provideServices({ gateway, mode: 'mock', settings: { load: vi.fn(), save: vi.fn() } });
        return () => h(VideoDrawer, { video: props.video as Video, identity });
      }
    });
    const video = VIDEO_MOCK_DATA.responses.listVideos.items[0];
    if (!video) throw new Error('Missing fixture');
    const wrapper = mount(parent, {
      props: { video },
      attachTo: document.body
    });
    await flushPromises();
    const body = new DOMWrapper(document.body);
    expect(request).not.toHaveBeenCalled();
    expect(body.get('video').attributes('preload')).toBe('none');
    expect(body.get('video').attributes('autoplay')).toBeUndefined();
    await body.get('video').trigger('error');
    expect(body.text()).toContain('此视频暂时无法播放');
    expect(body.text()).not.toContain('官方视频库');
    expect(body.text()).not.toContain('打开原链接');
    await body.get('button[aria-label="素材信息"]').trigger('click');
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
    await body
      .findAll('button')
      .find((b) => b.text() === '关联商品')
      ?.trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        'listVideoRelatedProducts',
        expect.objectContaining({ type: 'main' }),
        expect.anything()
      );
    });
    wrapper.unmount();
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    pause.mockRestore();
    load.mockRestore();
  });
});
