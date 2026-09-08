// @vitest-environment jsdom
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from '../../../mock/data/gallery-extension-transfer.json';
import photoFixture from '../../../mock/data/photos.json';
import transferFixture from '../../../mock/data/gallery-s3-mapping.json';
import GalleryZipTransferDialog from '../src/components/GalleryTransferDialog.vue';
import type { Photo } from '@one-vegetable/core';

const mocks = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn(), create: vi.fn() }));
vi.mock('../src/lib/services', () => ({ useServices: () => ({ gateway: { request: mocks.request } }) }));
vi.mock('../src/lib/gallery-transfer-archive', async (original) => ({
  ...(await original<object>()),
  readGalleryTransferArchive: mocks.read,
  createGalleryTransferArchive: mocks.create
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn() } }));
const modal = defineComponent({ template: '<div><slot/><slot name="footer"/></div>' });
const confirmation = defineComponent({
  emits: ['confirm'],
  template: '<button data-test="confirm" @click="$emit(\'confirm\')">Confirm</button>'
});
function archive() {
  return {
    ...fixture.archive,
    assets: fixture.archive.assets.map((asset) => ({ ...asset, bytes: Uint8Array.from(asset.bytes) }))
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(archive());
  mocks.request.mockResolvedValue(transferFixture.uploaded);
  mocks.create.mockResolvedValue(new Uint8Array([1, 2]));
});
function setup() {
  return mount(GalleryZipTransferDialog, {
    props: { open: true, mode: 'import', photos: [], targetGroupId: '2001', targetGroupName: 'Test' },
    global: { stubs: { ModalDialog: modal, ConfirmActionDialog: confirmation } }
  });
}
async function select(wrapper: ReturnType<typeof setup>) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [{ name: 'gallery.zip', size: 8, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }]
  });
  await input.trigger('change');
  await flushPromises();
}
describe('extension gallery ZIP dialog', () => {
  it('previews without uploading and imports only after confirmation', async () => {
    const wrapper = setup();
    await select(wrapper);
    expect(mocks.request).not.toHaveBeenCalled();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenCalledWith(
      'uploadPhoto',
      expect.objectContaining({ groupId: '2001', fileName: 'a.png' })
    );
    expect(wrapper.emitted('imported')).toEqual([[2]]);
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    wrapper.unmount();
  });
  it('preserves partial completion and prevents retrying an unconfirmed batch', async () => {
    mocks.request
      .mockResolvedValueOnce(transferFixture.uploaded)
      .mockRejectedValueOnce(new Error('Response lost'));
    const wrapper = setup();
    await select(wrapper);
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('imported')).toEqual([[1]]);
    expect(wrapper.text()).toContain('b.png：上传未取得成功确认');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('update:open')).toBeUndefined();
    wrapper.unmount();
  });
  it('ignores a late archive result after closing and reopening', async () => {
    let finish!: (value: ReturnType<typeof archive>) => void;
    mocks.read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const wrapper = setup();
    await select(wrapper);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    finish(archive());
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    expect(mocks.request).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('prevents double submission while an upload is pending', async () => {
    let finish!: (value: unknown) => void;
    mocks.request.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const wrapper = setup();
    await select(wrapper);
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await wrapper.get('[data-test="confirm"]').trigger('click');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    finish(transferFixture.uploaded);
    await flushPromises();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('downloads an archive only after export confirmation', async () => {
    const wrapper = setup();
    await wrapper.setProps({ mode: 'export', photos: [photoFixture.responses.listPhotos.items[0] as Photo] });
    mocks.request.mockResolvedValue(transferFixture.downloaded);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:archive'), revokeObjectURL: vi.fn() })
    );
    expect(mocks.request).not.toHaveBeenCalled();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.request).toHaveBeenCalledWith('downloadProductAsset', expect.any(Object));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    vi.unstubAllGlobals();
    wrapper.unmount();
  });
});
