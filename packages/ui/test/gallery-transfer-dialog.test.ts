// @vitest-environment jsdom
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from '../../../mock/data/gallery-s3-mapping.json';
import photoFixture from '../../../mock/data/photos.json';
import GalleryTransferDialog from '../src/components/GalleryTransferDialog.vue';
import type { Photo } from '@one-vegetable/core';

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
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(fixture.page);
  mocks.get.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' });
  mocks.request.mockImplementation((operation: string) => {
    if (operation === 'listPhotoGroups') return Promise.resolve(photoFixture.photoGroups);
    if (operation === 'uploadPhoto') return Promise.resolve(fixture.uploaded);
    if (operation === 'downloadProductAsset') return Promise.resolve(fixture.downloaded);
    if (operation === 'operatePhotoGroup') return Promise.resolve(fixture.createdGroup);
    return Promise.resolve(fixture.emptyPhotos);
  });
});
function setup() {
  return mount(GalleryTransferDialog, {
    props: { open: true, mode: 'import', photos: [], targetGroupId: '2001', targetGroupName: '商品主图' },
    global: { stubs: { ModalDialog: modal, ConfirmActionDialog: confirmation } }
  });
}
describe('S3 gallery mapping', () => {
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
