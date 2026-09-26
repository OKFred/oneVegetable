// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { VIDEO_MOCK_DATA } from '../../core/src/generated/mock-data';
import VideoProductAssociationDialog from '../src/components/VideoProductAssociationDialog.vue';
import ProductPicker from '../src/components/ProductPicker.vue';
import ProductVideoAssociation from '../src/components/ProductVideoAssociation.vue';
import ActionTooltip from '../src/components/ActionTooltip.vue';
import { provideServices, type AppServices } from '../src/lib/services';
import { pageDetailIdentity } from '../src/lib/page-details';
import { uiI18n } from '../src/i18n';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';

const video = VIDEO_MOCK_DATA.responses.listVideos.items[0];
if (!video?.id) throw new Error('Missing fixture');
const videoId = video.id;
const mounted: VueWrapper[] = [];
async function setup(mode: AppServices['mode'] = 'mock') {
  const gateway = new MockGatewayClient(0);
  const identity = await pageDetailIdentity(gateway, mode);
  const request = vi.spyOn(gateway, 'request');
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway,
          mode,
          settings: { load: vi.fn(), save: vi.fn() },
          operationAvailability: {
            get: (operations) =>
              Promise.resolve({
                items: operations.map((operation) => ({ operation, allowed: true, reasonCode: null }))
              })
          }
        });
        return () => h(VideoProductAssociationDialog, { target: { videoId, identity } });
      }
    }),
    { attachTo: document.body, global: { stubs: { VideoDrawer: true } } }
  );
  mounted.push(wrapper);
  await vi.waitFor(() => {
    expect(wrapper.findComponent(ProductPicker).findAll('li').length).toBeGreaterThan(0);
  });
  return { wrapper, gateway, request, body: new DOMWrapper(document.body) };
}
async function choose(wrapper: VueWrapper) {
  const picker = wrapper.getComponent(ProductPicker);
  await vi.waitFor(() => {
    expect(picker.findAll('li').length).toBeGreaterThan(0);
  });
  await picker.get('li button').trigger('click');
  await flushPromises();
}
describe('video to existing product dialog', () => {
  beforeEach(() => {
    localStorage.clear();
    uiI18n.global.locale.value = 'zh-CN';
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, _options: unknown, run: (lock: object) => Promise<unknown>) => run({})
      }
    });
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
  it('re-reads the exact video, reuses the product picker and waits for a separate confirmation', async () => {
    const s = await setup();
    expect(s.request).toHaveBeenCalledWith(
      'listVideos',
      { page: 1, pageSize: 20, id: videoId },
      expect.anything()
    );
    await choose(s.wrapper);
    const section = s.wrapper.getComponent(ProductVideoAssociation);
    expect(section.text()).toContain(videoId);
    expect(section.text()).not.toContain('选择视频');
    expect(s.request.mock.calls.map(([op]) => op)).toEqual(['listVideos', 'listProducts']);
    await section.get('[data-testid="associate-video"]').trigger('click');
    await flushPromises();
    expect(s.request).toHaveBeenCalledTimes(2);
    const confirmation = s.body.findAll('[role="dialog"]').find((d) => d.text().includes('固定 ID'));
    if (!confirmation) throw new Error('Missing confirmation');
    const confirm = confirmation.findAll('button').find((button) => button.text() === '确认');
    if (!confirm) throw new Error('Missing confirm button');
    await confirm.trigger('click');
    await flushPromises();
    expect(s.request.mock.calls.filter(([op]) => op === 'associateProductVideo')).toHaveLength(1);
    expect(s.request.mock.calls.find(([op]) => op === 'associateProductVideo')?.[1]).toMatchObject({
      videoId,
      encryptedVideoId: video.encryptedId,
      confirmed: true
    });
    await vi.waitFor(() => {
      expect(section.text()).toContain('回读已确认');
    });
    expect(
      s.request.mock.calls.some(([op]) =>
        ['publishProduct', 'updateProduct', 'saveProductDraft'].includes(op)
      )
    ).toBe(false);
  });
  it.each(['bff', 'extension'] as const)(
    'keeps real association disabled in %s, even if availability says allowed',
    async (mode) => {
      const s = await setup(mode);
      await choose(s.wrapper);
      const section = s.wrapper.getComponent(ProductVideoAssociation);
      expect(section.get('[data-testid="associate-video"]').attributes('disabled')).toBeDefined();
      expect(section.getComponent(ActionTooltip).props('reason')).toContain('视频关联写入尚未开放');
      expect(s.request.mock.calls.map(([op]) => op)).toEqual(['listVideos', 'listProducts']);
    }
  );
  it('changes UI language without fetching, loses no selection, and closes without a write', async () => {
    const s = await setup();
    await choose(s.wrapper);
    const before = s.request.mock.calls.length;
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(s.body.text()).toContain('Use in product');
    expect(s.body.text()).toContain('Change product');
    expect(s.body.text()).toContain(videoId);
    expect(s.request).toHaveBeenCalledTimes(before);
    const close = s.body.findAll('button').find((b) => b.attributes('aria-label')?.startsWith('Close'));
    if (!close) throw new Error('Missing close button');
    await close.trigger('click');
    expect(s.wrapper.getComponent(VideoProductAssociationDialog).emitted('close')).toHaveLength(1);
    expect(Object.keys(localStorage).filter((k) => k.includes('video-association'))).toHaveLength(0);
  });
  it('refuses a product selection after an account change and does not rebind the video', async () => {
    const s = await setup();
    const context = await s.gateway.galleryTransferContext();
    vi.spyOn(s.gateway, 'galleryTransferContext').mockResolvedValue({
      ...context,
      identity: 'other-account'
    });
    await choose(s.wrapper);
    expect(s.wrapper.findComponent(ProductVideoAssociation).exists()).toBe(false);
    expect(s.request.mock.calls.map(([op]) => op)).toEqual(['listVideos', 'listProducts']);
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await flushPromises();
    expect(s.wrapper.findComponent(ProductPicker).exists()).toBe(false);
    expect(s.request).toHaveBeenCalledTimes(2);
  });
});
