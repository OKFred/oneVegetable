// @vitest-environment jsdom
import { defineComponent, h, ref, shallowRef } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core/errors';
import type { GatewayClient } from '@one-vegetable/core';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import { VIDEO_MOCK_DATA } from '../../core/src/generated/mock-data';
import type { VideoUploadControl, VideoUploadTask } from '@one-vegetable/core/video-upload';
import fixture from '../../../mock/data/video/upload.json';
import taskFixture from '../../../mock/data/video/upload-task.json';
import VideoUploadDialog from '../src/components/VideoUploadDialog.vue';
import VideoProductAssociationDialog from '../src/components/VideoProductAssociationDialog.vue';
import ProductPicker from '../src/components/ProductPicker.vue';
import ProductVideoAssociation from '../src/components/ProductVideoAssociation.vue';
import { provideServices, type AppServices } from '../src/lib/services';
import type { VideoProductTarget } from '../src/lib/video-library';
import { uiI18n } from '../src/i18n';

vi.mock('vue-sonner', () => ({ toast: { info: vi.fn(), success: vi.fn() } }));
const mounted: VueWrapper[] = [];
function setup(
  initial: VideoUploadTask[] = [],
  enabled = true,
  options: { paired?: boolean; handoff?: boolean; replacementAfterEmit?: GalleryTransferContext } = {}
) {
  let tasks = initial;
  const gateway: GatewayClient = new MockGatewayClient(0);
  const pageContext = options.paired ? { ...fixture.context, gateway: 'paired-image-iop' } : fixture.context;
  const context = vi
    .spyOn(gateway, 'galleryTransferContext')
    .mockImplementation((operation) =>
      Promise.resolve(
        options.paired && (operation === undefined || operation === 'listProducts')
          ? pageContext
          : fixture.context
      )
    );
  const request = vi.spyOn(gateway, 'request');
  const availability = vi.fn<NonNullable<AppServices['operationAvailability']>['get']>((operations) =>
    Promise.resolve({
      items: operations.map((operation) => ({ operation, allowed: true, reasonCode: null }))
    })
  );
  const target = shallowRef<VideoProductTarget | null>(null);
  const open = ref(true);
  const call = vi.fn<VideoUploadControl['videoUpload']>().mockImplementation((command) => {
    if (command.action === 'create')
      tasks = [{ ...taskFixture, schemaVersion: 1, source: 'url', objectKey: null, status: 'prepared' }];
    if (command.action === 'submit') tasks = tasks.map((task) => ({ ...task, status: 'needs-review' }));
    return Promise.resolve({ tasks, uploadEnabled: enabled });
  });
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        mode: 'bff',
        videoUploads: { videoUpload: call },
        operationAvailability: { get: availability },
        settings: { load: vi.fn(), save: vi.fn() }
      });
      return () => [
        h(VideoUploadDialog, {
          open: open.value,
          'onUpdate:open': (value: boolean) => {
            if (options.handoff) open.value = value;
          },
          onAssociate: (value: VideoProductTarget) => {
            const replacement = options.replacementAfterEmit;
            if (replacement)
              context.mockImplementation((operation) =>
                Promise.resolve(
                  operation === undefined || operation === 'listProducts' ? pageContext : replacement
                )
              );
            if (options.handoff) target.value = value;
          }
        }),
        target.value ? h(VideoProductAssociationDialog, { target: target.value }) : null
      ];
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  mounted.push(wrapper);
  return {
    wrapper,
    call,
    gateway,
    context,
    request,
    availability,
    pageContext,
    body: new DOMWrapper(document.body)
  };
}
function findButton(body: DOMWrapper<Element>, label: string) {
  const target = body.findAll('button').find((button) => button.text() === label);
  if (!target) throw new Error(`Missing button ${label}`);
  return target;
}
describe('video upload dialog', () => {
  it('hands a confirmed TOP upload to the real association dialog and IOP product picker using the page anchor', async () => {
    const video = VIDEO_MOCK_DATA.responses.listVideos.items[0];
    if (!video?.id) throw new Error('Missing video fixture');
    const task: VideoUploadTask = {
      ...taskFixture,
      schemaVersion: 1,
      source: 'url',
      status: 'confirmed',
      videoId: video.id
    };
    const before = structuredClone(task);
    const s = setup([task], true, { paired: true, handoff: true });
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    await s.body.get('[data-testid="upload-use-in-product"]').trigger('click');
    await vi.waitFor(
      () => {
        expect(s.wrapper.findComponent(ProductPicker).findAll('li').length).toBeGreaterThan(0);
      },
      { timeout: 5000 }
    );
    const stamp = JSON.stringify([s.pageContext.identity, s.pageContext.gateway]);
    expect(s.wrapper.getComponent(VideoUploadDialog).emitted('associate')).toEqual([
      [{ videoId: video.id, identity: stamp, sourceContext: fixture.context }]
    ]);
    const picker = s.wrapper.getComponent(ProductPicker);
    expect(picker.props('expectedIdentity')).toBe(stamp);
    expect(s.request).toHaveBeenCalledWith(
      'listVideos',
      { page: 1, pageSize: 20, id: video.id },
      { galleryContext: fixture.context }
    );
    expect(s.request).toHaveBeenCalledWith('listProducts', expect.anything(), {
      galleryContext: s.pageContext
    });
    await picker.get('li button').trigger('click');
    await vi.waitFor(() => {
      expect(s.wrapper.findComponent(ProductVideoAssociation).exists()).toBe(true);
      expect(s.availability).toHaveBeenCalledWith(
        ['associateProductVideo', 'verifyProductVideoAssociation'],
        { galleryContext: fixture.context }
      );
    });
    expect(s.wrapper.getComponent(ProductVideoAssociation).props('preset')).toMatchObject({
      identity: stamp,
      sourceContext: fixture.context
    });
    expect(
      s.wrapper
        .getComponent(ProductVideoAssociation)
        .get('[data-testid="associate-video"]')
        .attributes('disabled')
    ).toBeDefined();
    expect(s.request.mock.calls.map(([operation]) => operation)).toEqual(['listVideos', 'listProducts']);
    expect(s.call.mock.calls).toEqual([[{ action: 'list' }, fixture.context]]);
    expect(task).toEqual(before);
    expect(task.context.gateway).not.toBe(s.pageContext.gateway);
  });
  it('rejects a TOP replacement after emission with the same IOP anchor and zero provider dispatches', async () => {
    const video = VIDEO_MOCK_DATA.responses.listVideos.items[0];
    if (!video?.id) throw new Error('Missing video fixture');
    const task: VideoUploadTask = {
      ...taskFixture,
      schemaVersion: 1,
      source: 'url',
      status: 'confirmed',
      videoId: video.id
    };
    const before = structuredClone(task);
    const s = setup([task], true, {
      paired: true,
      handoff: true,
      replacementAfterEmit: { ...fixture.context, gateway: 'replacement-top' }
    });
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    await s.body.get('[data-testid="upload-use-in-product"]').trigger('click');
    await flushPromises();
    expect(s.wrapper.getComponent(VideoUploadDialog).emitted('associate')).toEqual([
      [
        {
          videoId: video.id,
          identity: JSON.stringify([s.pageContext.identity, s.pageContext.gateway]),
          sourceContext: fixture.context
        }
      ]
    ]);
    expect(s.wrapper.findComponent(VideoProductAssociationDialog).exists()).toBe(true);
    expect(s.wrapper.findComponent(ProductPicker).exists()).toBe(false);
    expect(s.wrapper.findComponent(ProductVideoAssociation).exists()).toBe(false);
    expect(s.context).toHaveBeenCalledWith('listVideos', { page: 1, pageSize: 20, id: video.id });
    expect(s.request).not.toHaveBeenCalled();
    expect(task).toEqual(before);
  });
  it.each(['identity', 'gateway', 'storage'] as const)(
    'keeps an old TOP task read-only when its %s differs, even with a valid IOP page anchor',
    async (field) => {
      const task: VideoUploadTask = {
        ...taskFixture,
        schemaVersion: 1,
        source: 'url',
        status: 'confirmed',
        videoId: '10001',
        context: { ...fixture.context, [field]: `old-${field}` }
      };
      const before = structuredClone(task);
      const s = setup([task], true, { paired: true, handoff: true });
      await flushPromises();
      await s.body.get('select').setValue(task.id);
      expect(s.body.get('fieldset').attributes('disabled')).toBeDefined();
      await s.body.get('[data-testid="upload-use-in-product"]').trigger('click');
      await flushPromises();
      expect(s.wrapper.getComponent(VideoUploadDialog).emitted('associate')).toBeUndefined();
      expect(s.wrapper.findComponent(VideoProductAssociationDialog).exists()).toBe(false);
      expect(s.request).not.toHaveBeenCalled();
      expect(s.call.mock.calls).toEqual([[{ action: 'list' }, fixture.context]]);
      expect(task).toEqual(before);
    }
  );
  it.each(['identity', 'gateway', 'storage', 'video-route', 'foreign-identity', 'foreign-storage'] as const)(
    'blocks the %s change during handoff without rebinding the task or opening the picker',
    async (changed) => {
      const task: VideoUploadTask = {
        ...taskFixture,
        schemaVersion: 1,
        source: 'url',
        status: 'confirmed',
        videoId: '10001'
      };
      const before = structuredClone(task);
      const s = setup([task], true, { paired: true, handoff: true });
      await flushPromises();
      await s.body.get('select').setValue(task.id);
      let anchorReads = 0;
      let videoContext = fixture.context;
      s.context.mockImplementation((operation) => {
        if (operation !== undefined) return Promise.resolve(videoContext);
        anchorReads++;
        if (changed === 'video-route') {
          videoContext = { ...fixture.context, gateway: 'changed-top' };
          return Promise.resolve(s.pageContext);
        }
        const field =
          changed === 'foreign-identity' ? 'identity' : changed === 'foreign-storage' ? 'storage' : changed;
        return Promise.resolve(
          anchorReads > 1 || changed.startsWith('foreign-')
            ? { ...s.pageContext, [field]: `changed-${field}` }
            : s.pageContext
        );
      });
      await s.body.get('[data-testid="upload-use-in-product"]').trigger('click');
      await flushPromises();
      expect(s.wrapper.getComponent(VideoUploadDialog).emitted('associate')).toBeUndefined();
      expect(s.wrapper.findComponent(VideoProductAssociationDialog).exists()).toBe(false);
      expect(s.request).not.toHaveBeenCalled();
      expect(s.call.mock.calls).toEqual([[{ action: 'list' }, fixture.context]]);
      expect(task).toEqual(before);
    }
  );
  it('only offers a verified upload for a separate product association and rechecks its context', async () => {
    const task: VideoUploadTask = {
      ...taskFixture,
      schemaVersion: 1,
      source: 'url',
      status: 'confirmed',
      videoId: '10001'
    };
    const s = setup([task]);
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    await s.body.get('[data-testid="upload-use-in-product"]').trigger('click');
    await flushPromises();
    expect(s.wrapper.getComponent(VideoUploadDialog).emitted('associate')).toEqual([
      [
        {
          videoId: task.videoId,
          identity: JSON.stringify([fixture.context.identity, fixture.context.gateway]),
          sourceContext: fixture.context
        }
      ]
    ]);
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list']);
  });
  it.each(['accepted', 'needs-review', 'submitting'] as const)(
    'does not offer an unconfirmed %s upload for use',
    async (status) => {
      const task: VideoUploadTask = {
        ...taskFixture,
        schemaVersion: 1,
        source: 'url',
        status,
        videoId: '10001'
      };
      const s = setup([task]);
      await flushPromises();
      await s.body.get('select').setValue(task.id);
      expect(s.body.find('[data-testid="upload-use-in-product"]').exists()).toBe(false);
    }
  );
  it('does not reuse a confirmed upload after configuration changes', async () => {
    const task: VideoUploadTask = {
      ...taskFixture,
      schemaVersion: 1,
      source: 'url',
      status: 'confirmed',
      videoId: '10001'
    };
    const s = setup([task]);
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    vi.spyOn(s.gateway, 'galleryTransferContext').mockResolvedValue({
      ...fixture.context,
      gateway: 'changed'
    });
    await s.body.get('[data-testid="upload-use-in-product"]').trigger('click');
    await flushPromises();
    expect(s.wrapper.getComponent(VideoUploadDialog).emitted('associate')).toBeUndefined();
    expect(s.body.text()).toContain('旧任务只读');
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list']);
  });
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    uiI18n.global.locale.value = 'zh-CN';
  });
  it('only lists tasks on open, with separate preparation and platform confirmations', async () => {
    const s = setup();
    await flushPromises();
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list']);
    expect(s.context).toHaveBeenCalledWith('callCapability', {
      method: 'alibaba.icbu.video.upload'
    });
    await s.body.get('input[maxlength="180"]').setValue('Fixture');
    await s.body.get('select').setValue('url');
    await s.body.get('input[type="url"]').setValue(fixture.sourceUrl);
    await findButton(s.body, '准备任务').trigger('click');
    await flushPromises();
    expect(s.call).toHaveBeenCalledTimes(1);
    await findButton(s.body, '确认').trigger('click');
    await flushPromises();
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list', 'create']);
    await findButton(s.body, '提交至 Alibaba').trigger('click');
    await flushPromises();
    expect(s.call).toHaveBeenCalledTimes(2);
    await findButton(s.body, '取消').trigger('click');
    expect(s.call).toHaveBeenCalledTimes(2);
    await findButton(s.body, '提交至 Alibaba').trigger('click');
    await flushPromises();
    await findButton(s.body, '确认').trigger('click');
    await flushPromises();
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list', 'create', 'submit']);
    for (const args of s.context.mock.calls)
      expect(args).toEqual(['callCapability', { method: 'alibaba.icbu.video.upload' }]);
    expect(s.body.text()).toContain('需手动核对');
  });
  it('restores task records but never schedules uploads or verification on mount', async () => {
    const task: VideoUploadTask = { ...taskFixture, schemaVersion: 1, source: 'file', status: 'staged' };
    const s = setup([task], false);
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    expect(findButton(s.body, '提交至 Alibaba').attributes('disabled')).toBeDefined();
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list']);
    expect(s.body.text()).toContain('平台提交关闭');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(s.body.text()).toContain('S3 verified; awaiting submission confirmation');
    expect(s.call).toHaveBeenCalledTimes(1);
  });
  it('shows uncertain cancellation as S3 verification without offering platform submission or resumed upload', async () => {
    const task: VideoUploadTask = {
      ...taskFixture,
      schemaVersion: 1,
      source: 'file',
      status: 'needs-review',
      reasonCode: 'VIDEO_CANCELLATION_PENDING'
    };
    const s = setup([task]);
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    expect(s.body.text()).toContain('取消结果待核对');
    expect(
      s.body
        .findAll('button')
        .some((button) => ['继续 S3 暂存', '提交至 Alibaba', '核对平台结果'].includes(button.text()))
    ).toBe(false);
    await findButton(s.body, '核对 S3 结果').trigger('click');
    await flushPromises();
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list', 'reconcile']);
  });
  it('keeps old account tasks read-only and does not expose arbitrary provider errors', async () => {
    const task: VideoUploadTask = {
      ...taskFixture,
      schemaVersion: 1,
      source: 'file',
      status: 'staged',
      context: { ...fixture.context, identity: 'old-account' }
    };
    const s = setup([task]);
    await flushPromises();
    await s.body.get('select').setValue(task.id);
    expect(s.body.text()).toContain('旧任务只读');
    expect(s.body.get('fieldset').attributes('disabled')).toBeDefined();
    s.call.mockRejectedValueOnce(new Error('https://private.test?X-Amz-Signature=secret'));
    await findButton(s.body, '刷新任务记录').trigger('click');
    await flushPromises();
    expect(s.body.text()).not.toContain('X-Amz-Signature');
    expect(s.body.text()).toContain('操作未完成');
  });
  it('explains safe storage failures without exposing raw provider text or replaying writes', async () => {
    const s = setup();
    await flushPromises();
    s.call.mockRejectedValueOnce(
      new GatewayException({
        code: 'S3_REQUEST_FAILED',
        subCode: 'HTTP_411:MissingContentLength',
        message: 'secret-provider-url',
        retryable: false
      })
    );
    await findButton(s.body, '刷新任务记录').trigger('click');
    await flushPromises();
    expect(s.body.text()).toContain('反向代理');
    expect(s.body.text()).toContain('HTTP_411:MissingContentLength');
    expect(s.body.text()).not.toContain('secret-provider-url');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(s.body.text()).toContain('proxy chunked transfer');
    expect(s.call.mock.calls.map(([command]) => command.action)).toEqual(['list', 'list']);
  });
});
