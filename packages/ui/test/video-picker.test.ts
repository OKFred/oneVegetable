// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { VIDEO_MOCK_DATA } from '../../core/src/generated/mock-data';
import type { VideoPage } from '@one-vegetable/core/video';
import VideoPicker from '../src/components/VideoPicker.vue';
import VideoDrawer from '../src/components/VideoDrawer.vue';
import TablePagination from '../src/components/TablePagination.vue';
import { provideServices } from '../src/lib/services';
import { pageDetailIdentity } from '../src/lib/page-details';

const wrappers: VueWrapper[] = [];
async function settle(wrapper: VueWrapper) {
  await flushPromises();
  await vi.waitFor(() => {
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
});
async function setup() {
  const gateway = new MockGatewayClient(0);
  const identity = await pageDetailIdentity(gateway, 'mock');
  const request = vi.spyOn(gateway, 'request');
  const Host = defineComponent({
    props: { identity: { type: String, required: true } },
    setup(props) {
      provideServices({ gateway, mode: 'mock', settings: { load: vi.fn(), save: vi.fn() } });
      return () => h(VideoPicker, { identity: props.identity, language: 'en_US' });
    }
  });
  const wrapper = mount(Host, {
    props: { identity },
    global: {
      stubs: {
        VideoDrawer: true,
        ActionTooltip: { template: '<span><slot/></span>' }
      }
    }
  });
  wrappers.push(wrapper);
  await settle(wrapper);
  return { wrapper, gateway, request };
}
describe('reusable video picker', () => {
  it('queries only videos, searches titles/IDs and paginates server-side', async () => {
    const { wrapper, request } = await setup();
    await settle(wrapper);
    expect(request).toHaveBeenCalledWith('listVideos', { page: 1, pageSize: 20 }, expect.any(Object));
    await wrapper.get('input[aria-label="视频标题"]').setValue('Demo');
    await wrapper.get('form').trigger('submit');
    await settle(wrapper);
    expect(request).toHaveBeenLastCalledWith(
      'listVideos',
      { page: 1, pageSize: 20, title: 'Demo' },
      expect.any(Object)
    );
    const pagination = wrapper.findComponent(TablePagination);
    const paginationVm = pagination.vm as { $emit: (event: 'update:page', value: number) => void };
    paginationVm.$emit('update:page', 2);
    await settle(wrapper);
    expect(request).toHaveBeenLastCalledWith(
      'listVideos',
      { page: 2, pageSize: 20, title: 'Demo' },
      expect.any(Object)
    );
    await wrapper.get('input[aria-label="明文视频 ID"]').setValue('9001');
    await wrapper.get('form').trigger('submit');
    await settle(wrapper);
    expect(request).toHaveBeenLastCalledWith(
      'listVideos',
      { page: 1, pageSize: 20, title: 'Demo', id: '9001' },
      expect.any(Object)
    );
    expect(request.mock.calls.every(([operation]) => operation === 'listVideos')).toBe(true);
  });

  it('opens the existing drawer for preview and emits an explicit selection without a mutation', async () => {
    const { wrapper, request } = await setup();
    await flushPromises();
    const view = wrapper.findAll('button').find((button) => button.text() === '查看');
    if (!view) throw new Error('No preview');
    await view.trigger('click');
    expect(wrapper.getComponent(VideoDrawer).props('video')).toEqual(
      VIDEO_MOCK_DATA.responses.listVideos.items[0]
    );
    await wrapper.get('[data-testid="choose-video"]').trigger('click');
    expect(wrapper.getComponent(VideoPicker).emitted('select')?.[0]?.[0]).toEqual(
      VIDEO_MOCK_DATA.responses.listVideos.items[0]
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe ID searches without a new request', async () => {
    const { wrapper, request } = await setup();
    await flushPromises();
    await wrapper.get('input[aria-label="明文视频 ID"]').setValue('9007199254740993');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('未超过安全精度');
  });

  it('discards late query results when identity changes and clears preview immediately', async () => {
    const { wrapper, request, gateway } = await setup();
    await flushPromises();
    let complete: (page: VideoPage) => void = () => undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const refresh = wrapper.findAll('button').find((button) => button.text() === '刷新');
    if (!refresh) throw new Error('No refresh');
    await refresh.trigger('click');
    await flushPromises();
    const context = await gateway.galleryTransferContext();
    vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({ ...context, identity: 'changed' });
    await wrapper.setProps({ identity: '' });
    complete(VIDEO_MOCK_DATA.responses.listVideos);
    await flushPromises();
    expect(wrapper.findAll('[data-testid="choose-video"]')).toHaveLength(0);
    expect(wrapper.getComponent(VideoDrawer).props('video')).toBeNull();
  });

  it('disables rows lacking encrypted IDs instead of inventing one', async () => {
    const { wrapper, request } = await setup();
    await flushPromises();
    request.mockResolvedValueOnce({
      ...VIDEO_MOCK_DATA.responses.listVideos,
      items: VIDEO_MOCK_DATA.responses.listVideos.items.map((video) => ({ ...video, encryptedId: null }))
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')
      ?.trigger('click');
    await settle(wrapper);
    expect(wrapper.findAll('[data-testid="choose-video"]').length).toBeGreaterThan(0);
    expect(
      wrapper
        .findAll('[data-testid="choose-video"]')
        .every((button) => button.attributes('disabled') !== undefined)
    ).toBe(true);
  });
});
