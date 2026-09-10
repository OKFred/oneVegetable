// @vitest-environment jsdom
import { defineComponent } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from '../../../mock/data/gallery-extension-transfer.json';
import taskFixture from '../../../mock/data/gallery-transfer-task.json';
import transferFixture from '../../../mock/data/gallery-s3-mapping.json';
import GalleryZipTransferDialog from '../src/components/GalleryTransferDialog.vue';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  preview: vi.fn(),
  createTask: vi.fn(),
  run: vi.fn()
}));
vi.mock('../src/lib/services', () => ({ useServices: () => ({ gateway: { request: mocks.request } }) }));
vi.mock('../src/lib/gallery-transfer-archive', async (original) => ({
  ...(await original<object>()),
  readGalleryTransferArchive: mocks.read,
  createGalleryTransferArchive: mocks.create
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
function archive() {
  return {
    ...fixture.archive,
    assets: fixture.archive.assets.map((asset) => ({ ...asset, bytes: Uint8Array.from(asset.bytes) }))
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue(structuredClone(taskFixture));
  mocks.createTask.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue(undefined);
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
describe('durable ZIP transfer entry point', () => {
  it('prevalidates a file and creates a task only after the execution confirmation', async () => {
    const wrapper = setup();
    await select(wrapper);
    expect(mocks.createTask).not.toHaveBeenCalled();
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
    expect(mocks.run).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it('never duplicates a confirmed task even if the confirm event repeats', async () => {
    const wrapper = setup();
    await select(wrapper);
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '导入')
      ?.trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    await flushPromises();
    expect(mocks.createTask).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it('ignores a late archive result after closing and reopening', async () => {
    let finish: ((value: ReturnType<typeof archive>) => void) | undefined;
    mocks.read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const wrapper = setup();
    await select(wrapper);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    finish?.(archive());
    await flushPromises();
    await wrapper.get('[data-test="confirm"]').trigger('click');
    expect(mocks.createTask).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
