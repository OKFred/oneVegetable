// @vitest-environment jsdom
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayException } from '@one-vegetable/core';
import fixture from '../../../mock/data/gallery-s3-mapping.json';
import photoFixture from '../../../mock/data/photos.json';
import GalleryTransferDialog from '../src/components/GalleryTransferDialog.vue';
import taskFixture from '../../../mock/data/gallery-transfer-task.json';
import errorFixture from '../../../mock/data/gallery-s3-errors.json';
import { uiI18n } from '../src/i18n';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  preview: vi.fn(),
  createTask: vi.fn(),
  run: vi.fn()
}));
vi.mock('../src/lib/services', () => ({
  useServices: () => ({
    gateway: { request: mocks.request },
    s3Storage: { listS3Objects: mocks.list, getS3Object: mocks.get, putS3Object: mocks.put }
  })
}));
vi.mock('../src/lib/gallery-transfer-service', () => ({
  useGalleryTransfers: () => ({ preview: mocks.preview, create: mocks.createTask, run: mocks.run })
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }));
const modal = defineComponent({ template: '<div><slot/><slot name="footer"/></div>' });
const confirmation = defineComponent({
  emits: ['confirm'],
  template: '<button data-test="confirm" @click="$emit(\'confirm\')">Confirm</button>'
});
function defaultResponse(operation: string): Promise<unknown> {
  if (operation === 'listPhotoGroups') return Promise.resolve(photoFixture.photoGroups);
  if (operation === 'uploadPhoto') return Promise.resolve(fixture.uploaded);
  if (operation === 'downloadProductAsset') return Promise.resolve(fixture.downloaded);
  if (operation === 'operatePhotoGroup') return Promise.resolve(fixture.createdGroup);
  return Promise.resolve(fixture.emptyPhotos);
}
beforeEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
  localStorage.clear();
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue(structuredClone(taskFixture));
  mocks.createTask.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue(fixture.page);
  mocks.get.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' });
  mocks.request.mockImplementation(defaultResponse);
});
afterEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
});
function setup() {
  return mount(GalleryTransferDialog, {
    props: { open: true, mode: 'import', photos: [], targetGroupId: '2001', targetGroupName: '商品主图' },
    global: { stubs: { ModalDialog: modal, ConfirmActionDialog: confirmation } }
  });
}
async function scan(wrapper: ReturnType<typeof setup>): Promise<void> {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'S3')
    ?.trigger('click');
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '扫描 S3')
    ?.trigger('click');
  await flushPromises();
}
function deferredPage() {
  type Page = Omit<typeof fixture.page, 'nextContinuationToken'> & { nextContinuationToken: string | null };
  let resolve!: (value: Page) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Page>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('S3 gallery mapping', () => {
  it.each(['backendMissing', 'extensionMissing'] as const)(
    'guides %s to settings and preserves requestId without exposing translation keys',
    async (kind) => {
      mocks.list.mockRejectedValueOnce(new GatewayException(errorFixture[kind], errorFixture.requestId));
      const wrapper = setup();
      await scan(wrapper);
      const notice = wrapper.get('[role="alert"]');
      expect(notice.text()).toContain('请先在设置中配置 S3 素材存储。');
      expect(notice.text()).toContain(errorFixture.requestId);
      expect(notice.text()).not.toContain('errors.codes.');
      expect(notice.get('a').attributes('href')).toBe('#/settings');
      expect(notice.get('a').text()).toBe('S3 素材存储');
      uiI18n.global.locale.value = 'en-US';
      await flushPromises();
      expect(notice.text()).toContain('Configure S3 asset storage in Settings first.');
      expect(notice.get('a').text()).toBe('S3 asset storage');
      expect(mocks.preview).not.toHaveBeenCalled();
      expect(mocks.createTask).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  );
  it('uses a readable fallback for unknown S3 errors without exposing internal details', async () => {
    mocks.list.mockRejectedValueOnce(new GatewayException(errorFixture.unknown, errorFixture.requestId));
    const wrapper = setup();
    await scan(wrapper);
    const notice = wrapper.get('[role="alert"]');
    expect(notice.text()).toContain('S3 操作失败。');
    expect(notice.text()).toContain(errorFixture.unknown.code);
    expect(notice.text()).not.toContain('errors.codes.');
    expect(notice.text()).not.toContain(errorFixture.unknown.message);
    expect(notice.find('a').exists()).toBe(false);
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(notice.text()).toContain('S3 operation failed.');
    wrapper.unmount();
  });
  it('also explains missing S3 configuration when previewing an export', async () => {
    mocks.preview.mockRejectedValueOnce(new GatewayException(errorFixture.backendMissing));
    const wrapper = setup();
    await wrapper.setProps({ mode: 'export', photos: photoFixture.responses.listPhotos.items.slice(0, 1) });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '导出到 S3')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('请先在设置中配置 S3 素材存储。');
    expect(mocks.createTask).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('rejects oversized ZIPs before allocating or reading their bytes', async () => {
    const wrapper = setup();
    const read = vi.fn();
    const file = new File([], 'oversized.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [file] });
    await input.trigger('change');
    await flushPromises();
    expect(read).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('50 MiB');
    wrapper.unmount();
  });
  it('discards a closed dialog scan without continuing pagination or enabling uploads', async () => {
    const pending = deferredPage();
    mocks.list.mockReturnValueOnce(pending.promise);
    const wrapper = setup();
    await scan(wrapper);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    pending.resolve({ ...fixture.page, nextContinuationToken: 'next' });
    await flushPromises();
    expect(wrapper.text()).not.toContain('catalog/a.png');
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="confirm"]').trigger('click');
    expect(mocks.request).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('does not let a stale rejection clear the next session loading state', async () => {
    const oldPage = deferredPage();
    const newPage = deferredPage();
    mocks.list.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(newPage.promise);
    const wrapper = setup();
    await scan(wrapper);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await scan(wrapper);
    oldPage.reject(new Error('Stale failure'));
    await flushPromises();
    expect(wrapper.text()).not.toContain('Stale failure');
    const button = wrapper.findAll('button').find((item) => item.text() === '扫描 S3');
    expect(button?.attributes('disabled')).toBeDefined();
    newPage.resolve(fixture.page);
    await flushPromises();
    expect(wrapper.text()).toContain('catalog/a.png');
    expect(button?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
  it('invalidates an in-flight plan when its target group changes', async () => {
    const pending = deferredPage();
    mocks.list.mockReturnValueOnce(pending.promise);
    const wrapper = setup();
    await scan(wrapper);
    await wrapper.setProps({ targetGroupId: '2101', targetGroupName: '白底主图' });
    pending.resolve(fixture.page);
    await flushPromises();
    expect(wrapper.text()).not.toContain('catalog/a.png');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    expect(mocks.request).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('freezes a plan before confirmation and runs at application scope after closing', async () => {
    const wrapper = setup();
    await scan(wrapper);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '导入')
      ?.trigger('click');
    await flushPromises();
    expect(mocks.preview).toHaveBeenCalledOnce();
    expect(mocks.createTask).not.toHaveBeenCalled();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledWith(taskFixture.id);
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    wrapper.unmount();
  });
  it('freezes the automatic group creation checkbox in the plan', async () => {
    const wrapper = setup();
    await scan(wrapper);
    await wrapper.get('input[type="checkbox"]').setValue(false);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '导入')
      ?.trigger('click');
    await flushPromises();
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ createMissingGroups: false }));
    wrapper.unmount();
  });
  it('does not create a task when preview rejects a missing target or invalid path', async () => {
    mocks.preview.mockRejectedValue(new Error('invalid plan'));
    const wrapper = setup();
    await scan(wrapper);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '导入')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
