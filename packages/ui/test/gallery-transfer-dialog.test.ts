// @vitest-environment jsdom
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from '../../../mock/data/gallery-s3-mapping.json';
import photoFixture from '../../../mock/data/photos.json';
import GalleryTransferDialog from '../src/components/GalleryTransferDialog.vue';
import type { Photo } from '@one-vegetable/core';
import {
  defaultGalleryImportRuleSet,
  saveGalleryImportRuleSet
} from '../src/lib/gallery-import-rules-storage';

const mocks = vi.hoisted(() => ({ request: vi.fn(), list: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock('../src/lib/services', () => ({
  useServices: () => ({
    gateway: { request: mocks.request },
    control: { listS3Objects: mocks.list, getS3Object: mocks.get, putS3Object: mocks.put }
  })
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
  localStorage.clear();
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(fixture.page);
  mocks.get.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' });
  mocks.request.mockImplementation(defaultResponse);
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
  it('creates only the missing third level under its actual parent ID', async () => {
    const rules = defaultGalleryImportRuleSet();
    if (rules.rules[0]) rules.rules[0].targetGroupPath = '商品主图/白底主图/Leaf';
    saveGalleryImportRuleSet(rules);
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request.mock.calls.filter((call) => call[0] === 'operatePhotoGroup')).toEqual([
      ['operatePhotoGroup', { operation: 'add', groupId: '2101', groupName: 'Leaf' }]
    ]);
    wrapper.unmount();
  });
  it('retains successful receipts and never resends an uncertain upload on retry or rescan', async () => {
    mocks.list.mockResolvedValue(fixture.batchPage);
    let uploads = 0;
    mocks.request.mockImplementation((operation: string) => {
      if (operation === 'uploadPhoto' && ++uploads === 2)
        return Promise.reject(new Error('Simulated response timeout'));
      return defaultResponse(operation);
    });
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper.get('select').setValue('current');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('reused-file');
    expect(wrapper.text()).toContain('b.png：上传未取得成功确认');
    expect(wrapper.emitted('imported')).toEqual([[1]]);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(uploads).toBe(2);
    expect(wrapper.text()).toContain('reused-file');
    wrapper.unmount();
  });
  it('retries a download failure without losing prior receipts or re-uploading successful items', async () => {
    mocks.list.mockResolvedValue(fixture.batchPage);
    let downloads = 0;
    mocks.get.mockImplementation(() =>
      ++downloads === 2
        ? Promise.reject(new Error('Download unavailable'))
        : Promise.resolve({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' })
    );
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper.get('select').setValue('current');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Download unavailable');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('a.png：上传接口已接收');
    expect(wrapper.text()).toContain('b.png：上传接口已接收');
    expect(mocks.request.mock.calls.filter((call) => call[0] === 'uploadPhoto')).toHaveLength(2);
    wrapper.unmount();
  });
  it('rejects a fourth directory level before creating anything', async () => {
    const rules = defaultGalleryImportRuleSet();
    if (rules.rules[0]) rules.rules[0].targetGroupPath = 'One/Two/Three/Four';
    saveGalleryImportRuleSet(rules);
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('一至三级');
    expect(
      mocks.request.mock.calls.some((call) => call[0] === 'operatePhotoGroup' || call[0] === 'uploadPhoto')
    ).toBe(false);
    wrapper.unmount();
  });
  it('requires platform review after an uncertain group creation instead of retrying it', async () => {
    mocks.request.mockImplementation((operation: string) =>
      operation === 'operatePhotoGroup'
        ? Promise.reject(new Error('Simulated creation timeout'))
        : defaultResponse(operation)
    );
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('本次不会重复创建');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request.mock.calls.filter((call) => call[0] === 'operatePhotoGroup')).toHaveLength(1);
    expect(mocks.request.mock.calls.some((call) => call[0] === 'uploadPhoto')).toBe(false);
    wrapper.unmount();
  });
  it('exports to a custom prefix with group hierarchy and a manifest', async () => {
    const wrapper = setup();
    await wrapper.setProps({ mode: 'export', photos: [photoFixture.responses.listPhotos.items[0] as Photo] });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper.get('input').setValue('backup/catalog');
    await wrapper.get('select').setValue('groups');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    const keys = mocks.put.mock.calls.map((call) => (call[0] as { key: string }).key);
    expect(keys[0]).toMatch(/^backup\/catalog\/[^/]+\/assets\/%E5%95%86%E5%93%81%E4%B8%BB%E5%9B%BE\//u);
    expect(keys[1]).toMatch(/\/gallery\.json$/u);
    wrapper.unmount();
  });
  it('creates missing groups by default before uploading', async () => {
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request).toHaveBeenCalledWith('operatePhotoGroup', {
      operation: 'add',
      groupId: null,
      groupName: 'Imported'
    });
    expect(wrapper.emitted('groupsChanged')).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledWith(
      'uploadPhoto',
      expect.objectContaining({ groupId: 'new-group' })
    );
    wrapper.unmount();
  });
  it('does not create groups or upload when automatic creation is unchecked', async () => {
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper.get('input[type="checkbox"]').setValue(false);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(
      mocks.request.mock.calls.some((call) => call[0] === 'operatePhotoGroup' || call[0] === 'uploadPhoto')
    ).toBe(false);
    wrapper.unmount();
  });
  it('imports into selected group and retains unconfirmed fileId without allowing repeat execution', async () => {
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper.get('select').setValue('current');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('商品主图');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request).toHaveBeenCalledWith('uploadPhoto', expect.objectContaining({ groupId: '2001' }));
    expect(wrapper.text()).toContain('reused-file');
    expect(wrapper.text()).toContain('勿重复上传');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request.mock.calls.filter((call) => call[0] === 'uploadPhoto')).toHaveLength(1);
    expect(wrapper.emitted('update:open')).toBeUndefined();
    wrapper.unmount();
  });
  it('invalidates a scanned plan when the mapping mode changes', async () => {
    const wrapper = setup();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'S3')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫描 S3')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('catalog/a.png');
    await wrapper.get('select').setValue('current');
    expect(wrapper.text()).not.toContain('catalog/a.png');
    wrapper.unmount();
  });
});
