// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, it, expect, vi } from 'vitest';
import VideoDrawer from '../src/components/VideoDrawer.vue';
import { provideServices } from '../src/lib/services';
import { MockGatewayClient } from '../../core/src/mock-client';
import { VIDEO_MOCK_DATA } from '../../core/src/generated/mock-data';
import { pageDetailIdentity } from '../src/lib/page-details';
import type { Video } from '../../core/src/types';
describe('video drawer resource lifetime', () => {
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
      global: { stubs: { Sheet: { template: '<div><slot name="toolbar"/><slot/></div>' } } }
    });
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
    expect(wrapper.get('video').attributes('preload')).toBe('none');
    expect(wrapper.get('video').attributes('autoplay')).toBeUndefined();
    await wrapper.get('video').trigger('error');
    expect(wrapper.text()).toContain('此视频暂时无法播放');
    await wrapper
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
