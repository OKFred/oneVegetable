// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core/errors';
import type { VideoUploadControl, VideoUploadTask } from '@one-vegetable/core/video-upload';
import fixture from '../../../mock/data/video/upload.json';
import taskFixture from '../../../mock/data/video/upload-task.json';
import VideoUploadDialog from '../src/components/VideoUploadDialog.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';

vi.mock('vue-sonner', () => ({ toast: { info: vi.fn(), success: vi.fn() } }));
const mounted: VueWrapper[] = [];
function setup(initial: VideoUploadTask[] = [], enabled = true) {
  let tasks = initial;
  const gateway = new MockGatewayClient(0);
  vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue(fixture.context);
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
        settings: { load: vi.fn(), save: vi.fn() }
      });
      return () => h(VideoUploadDialog, { open: true });
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  mounted.push(wrapper);
  return { wrapper, call, body: new DOMWrapper(document.body) };
}
function findButton(body: DOMWrapper<Element>, label: string) {
  const target = body.findAll('button').find((button) => button.text() === label);
  if (!target) throw new Error(`Missing button ${label}`);
  return target;
}
describe('video upload dialog', () => {
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
