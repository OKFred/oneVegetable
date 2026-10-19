// @vitest-environment jsdom
import { computed, defineComponent, h, ref } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/template-library.json';
import configuration from '../../../mock/data/template-library-s3.json';
import materialFixture from '../../../mock/data/template-material-ui/package.json';
import { MemoryProductDescriptionTemplateClient } from '../../core/src/product-description-template-client';
import { parseTemplateBundle, templateError } from '../../core/src/template-library';
import type { S3StorageControl } from '../../core/src/s3-storage';
import type { TemplateMaterialPackage } from '../../core/src/template-materials';
import type { AppServices } from '../src/lib/services';
import { templateMaterials as materialZh } from '../src/i18n/messages/zh-CN/templateMaterials';
import { templateMaterials as materialEn } from '../src/i18n/messages/en-US/templateMaterials';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GalleryTaskError } from '@one-vegetable/core/gallery-transfer-task';
import { splitUserVisibleErrorMessages } from '@one-vegetable/core/errors';
import TemplateTransferDialog from '../src/components/TemplateTransferDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { uiI18n } from '../src/i18n';
import ConfirmActionDialog from '../src/components/ConfirmActionDialog.vue';
import ModalDialog from '../src/components/ui/ModalDialog.vue';
import PhotoGroupNavigation from '../src/components/PhotoGroupNavigation.vue';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  transfers: undefined as { show: ReturnType<typeof vi.fn> } | undefined,
  readArchive: vi.fn(),
  createArchive: vi.fn(),
  prepareExport: vi.fn(),
  prepareImport: vi.fn(),
  executeImport: vi.fn(),
  prepareBackup: vi.fn(),
  executeBackup: vi.fn(),
  verifyBackup: vi.fn(),
  readBackup: vi.fn()
}));
const download = mocks.download;
vi.mock('../src/lib/gallery-transfer-service', () => ({
  downloadGalleryFile: mocks.download,
  useGalleryTransfers: () => mocks.transfers
}));
vi.mock('../src/lib/template-material-archive', () => ({
  readTemplateMaterialArchive: mocks.readArchive,
  createTemplateMaterialArchive: mocks.createArchive
}));
vi.mock('../src/lib/template-material-transfer', () => ({
  prepareTemplateMaterialExport: mocks.prepareExport,
  prepareTemplateMaterialImport: mocks.prepareImport,
  executeTemplateMaterialImport: mocks.executeImport
}));
vi.mock('../src/lib/template-material-s3', () => ({
  prepareTemplateMaterialBackup: mocks.prepareBackup,
  executeTemplateMaterialBackup: mocks.executeBackup,
  verifyTemplateMaterialBackup: mocks.verifyBackup,
  readTemplateMaterialBackup: mocks.readBackup
}));
const zipBytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
function materialPackage(): TemplateMaterialPackage {
  const document = structuredClone(materialFixture.document) as TemplateMaterialPackage['document'];
  return { document, assets: document.assets.map(({ path }) => ({ path, bytes: new Uint8Array(8) })) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanup: (() => void)[] = [];
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
  vi.clearAllMocks();
  mocks.transfers = { show: vi.fn() };
  mocks.readArchive.mockReset().mockImplementation(() => Promise.resolve(materialPackage()));
  mocks.createArchive.mockReset().mockResolvedValue(zipBytes);
  mocks.prepareExport
    .mockReset()
    .mockImplementation(() => Promise.resolve({ package: materialPackage(), context: null }));
  mocks.prepareImport
    .mockReset()
    .mockImplementation(
      (_transfers: unknown, pack: TemplateMaterialPackage, groupId: string, groupName: string) =>
        Promise.resolve({ package: pack, groupId, groupName })
    );
  mocks.executeImport
    .mockReset()
    .mockResolvedValue([{ name: 'Portable company', status: 'created', error: null }]);
  mocks.prepareBackup.mockReset().mockResolvedValue({ key: 'templates/material-batch/templates.json' });
  mocks.executeBackup.mockReset().mockResolvedValue(undefined);
  mocks.verifyBackup.mockReset().mockResolvedValue(undefined);
  mocks.readBackup.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  for (const run of cleanup.splice(0)) run();
  document.body.replaceChildren();
  uiI18n.global.locale.value = 'zh-CN';
});

async function setup(
  mode: 'import' | 'export' = 'import',
  options: { services?: Partial<AppServices>; omit?: (keyof AppServices)[] } = {}
) {
  const client = new MemoryProductDescriptionTemplateClient();
  const portable = parseTemplateBundle(new TextEncoder().encode(JSON.stringify(fixture))).templates;
  const first = portable[0];
  if (!first) throw new Error('Missing template fixture');
  const template = await client.create(first);
  const create = vi.spyOn(client, 'create');
  const scope = ref('account-a');
  const open = ref(true);
  const gateway = new MockGatewayClient(0);
  const permissionRequest = vi.fn().mockResolvedValue(true);
  const availability = {
    get: vi.fn().mockResolvedValue({
      items: [{ operation: 'uploadPhoto', allowed: true, reasonCode: 'ADMIN_MUTATION_ALLOWED' }]
    })
  };
  const s3 = {
    s3StorageConfiguration: vi
      .fn<S3StorageControl['s3StorageConfiguration']>()
      .mockResolvedValue(configuration),
    getS3Object: vi.fn<S3StorageControl['getS3Object']>(),
    putS3Object: vi.fn<S3StorageControl['putS3Object']>(),
    listS3Objects: vi.fn<S3StorageControl['listS3Objects']>(),
    updateS3StorageConfiguration: vi.fn<S3StorageControl['updateS3StorageConfiguration']>(),
    clearS3StorageConfiguration: vi.fn<S3StorageControl['clearS3StorageConfiguration']>(),
    testS3StorageConnection: vi.fn<S3StorageControl['testS3StorageConnection']>()
  };
  const host = mount(
    defineComponent({
      setup() {
        provideListIdentityScope(computed(() => scope.value));
        const supplied: AppServices = {
          gateway,
          permissions: {
            list: () => Promise.resolve([]),
            revoke: () => Promise.resolve(false),
            request: permissionRequest
          },
          mode: 'extension',
          s3Storage: s3,
          productDescriptionTemplates: client,
          operationAvailability: availability,
          settings: {
            load: () =>
              Promise.resolve({
                appKey: '',
                appSecret: '',
                accessToken: '',
                endpoint: '',
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          },
          ...options.services
        };
        for (const key of options.omit ?? []) Reflect.deleteProperty(supplied, key);
        provideServices(supplied);
        return () => h(TemplateTransferDialog, { open: open.value, mode, templates: [template] });
      }
    }),
    { attachTo: document.body, global: { stubs: { PhotoGroupNavigation: true } } }
  );
  cleanup.push(() => {
    host.unmount();
  });
  await flushPromises();
  const body = new DOMWrapper(document.body);
  const button = (name: string) => {
    const found = body.findAll('button').find((item) => item.text() === name);
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
  };
  async function choose(value: unknown = fixture) {
    await chooseBytes(new TextEncoder().encode(JSON.stringify(value)), 'templates.json', 'application/json');
  }
  async function chooseBytes(
    bytes = zipBytes,
    name = 'materials.zip',
    type = 'application/zip',
    size?: number
  ) {
    const input = body.get('input[type=file]');
    const file = new File([Uint8Array.from(bytes)], name, { type });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(Uint8Array.from(bytes).buffer)
    });
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();
  }
  const dialog = host.getComponent(TemplateTransferDialog);
  async function selectGroup(id = 'group-real', name = 'Product materials') {
    (dialog.getComponent(PhotoGroupNavigation) as Pick<VueWrapper, 'vm'>).vm.$emit('select', {
      id,
      name,
      parentId: null,
      level: 1,
      photoCount: 0
    });
    await flushPromises();
  }
  return {
    client,
    create,
    scope,
    open,
    s3,
    gateway,
    availability,
    body,
    button,
    choose,
    chooseBytes,
    selectGroup,
    template,
    dialog
  };
}

describe('template package confirmation and safe writes', () => {
  it('previews a valid file and creates nothing before confirmation; duplicates default to skip', async () => {
    const { choose, create, button, body, client } = await setup();
    await choose();
    expect(body.text()).toContain('2 templates');
    expect(create).not.toHaveBeenCalled();
    await button('Import').trigger('click');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(create).toHaveBeenCalledOnce();
    expect((await client.list()).total).toBe(2);
  });
  it('copy mode keeps existing content and creates a deterministic distinct name', async () => {
    const { choose, button, body, client } = await setup();
    await choose();
    await body.get('select:nth-of-type(1)').setValue('json');
    const conflict = body.findAll('select').at(-1);
    if (!conflict) throw new Error('Missing conflict selector');
    await conflict.setValue('copy');
    await button('Import').trigger('click');
    await flushPromises();
    await button('Confirm').trigger('click');
    await flushPromises();
    const page = await client.list();
    expect(page.total).toBe(3);
    expect(page.items.some((item) => item.name.endsWith(' (2)'))).toBe(true);
  });
  it('rejects malformed packages without enabling import or writing', async () => {
    const { choose, create, button, body } = await setup();
    await choose({ kind: 'invalid' });
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(body.text()).not.toContain('2 templates');
    expect(create).not.toHaveBeenCalled();
  });
  it('downloads only after confirmation and freezes the chosen template snapshot', async () => {
    const { template, button } = await setup('export');
    const original = template.name;
    template.name = 'Changed after opening';
    await button('Export').trigger('click');
    await flushPromises();
    expect(download).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(download).toHaveBeenCalledOnce();
    const bytes = download.mock.calls[0]?.[1] as Uint8Array;
    expect(parseTemplateBundle(bytes).templates[0]?.name).toBe(original);
  });
  it('never repeats an uncertain S3 PUT; retry only verifies the saved path', async () => {
    const { s3, body, button } = await setup('export');
    await body.get('select').setValue('s3');
    s3.putS3Object.mockRejectedValueOnce(new Error('Write uncertain'));
    await button('Export').trigger('click');
    await flushPromises();
    expect(s3.putS3Object).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    expect(button('Export').attributes('disabled')).toBeDefined();
    const sent = s3.putS3Object.mock.calls[0]?.[0];
    if (!sent) throw new Error('Missing upload');
    s3.getS3Object.mockResolvedValue({
      key: sent.key,
      bytes: sent.bytes,
      contentType: 'application/json',
      etag: null
    });
    await button('Verify results').trigger('click');
    await flushPromises();
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    expect(s3.getS3Object).toHaveBeenCalledWith(sent.key);
  });
  it('does not write after the account context changes', async () => {
    const { choose, scope, button, create } = await setup();
    await choose();
    scope.value = 'account-b';
    await flushPromises();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('template material UI without provider writes', () => {
  it('recognizes ZIP by signature even with a JSON filename and renders a safe, read-only preview', async () => {
    const { chooseBytes, create, body, button, s3, availability } = await setup();
    expect(body.get('input[type=file]').attributes('accept')).toContain('.zip');
    await chooseBytes(zipBytes, 'misnamed.json', 'application/json');
    expect(mocks.readArchive).toHaveBeenCalledWith(zipBytes);
    expect(body.text()).toContain('1 templates · 1 image files');
    expect(body.text()).toContain('company.png');
    expect(body.text()).toContain('Safe material preview');
    expect(body.find('script').exists()).toBe(false);
    expect(body.find('img').exists()).toBe(false);
    expect(availability.get).toHaveBeenCalledWith(['uploadPhoto']);
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(mocks.prepareImport).not.toHaveBeenCalled();
    expect(mocks.executeImport).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });

  it('recognizes legacy JSON with a ZIP filename without invoking the archive reader', async () => {
    const { chooseBytes, body, button } = await setup();
    await chooseBytes(new TextEncoder().encode(JSON.stringify(fixture)), 'misnamed.zip');
    expect(body.text()).toContain('2 templates');
    expect(mocks.readArchive).not.toHaveBeenCalled();
    expect(button('Import').attributes('disabled')).toBeUndefined();
  });

  it('requires a real non-empty photo group and prepares without uploads before confirmation', async () => {
    const { chooseBytes, selectGroup, button, body, s3 } = await setup();
    await chooseBytes();
    await selectGroup('-1', 'All photos');
    expect(button('Import').attributes('disabled')).toBeDefined();
    await selectGroup('', 'Ungrouped');
    expect(button('Import').attributes('disabled')).toBeDefined();
    await selectGroup('group-real', '');
    expect(button('Import').attributes('disabled')).toBeDefined();
    await selectGroup();
    expect(button('Import').attributes('disabled')).toBeUndefined();
    expect(body.text()).toContain('1 image files will be uploaded');
    await button('Import').trigger('click');
    await flushPromises();
    expect(mocks.prepareImport).toHaveBeenCalledWith(
      mocks.transfers,
      expect.any(Object),
      'group-real',
      'Product materials',
      expect.any(Function),
      false
    );
    expect(body.text()).toContain('upload or reuse 1 image files in “Product materials”');
    expect(mocks.executeImport).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(mocks.executeImport).toHaveBeenCalledOnce();
    expect(mocks.executeImport.mock.calls[0]?.[3]).toBe('skip');
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });

  it('keeps existing-image reuse off by default and includes opt-in in final confirmation', async () => {
    const { chooseBytes, selectGroup, button, body } = await setup();
    await chooseBytes();
    await selectGroup();
    const checkbox = body.get<HTMLInputElement>('[data-testid="template-reuse-existing-photos"]');
    expect(checkbox.element.checked).toBe(false);
    await checkbox.setValue(true);
    await button('Import').trigger('click');
    await flushPromises();
    // Confirmation follows async package hashing; a single microtask flush is not enough under load.
    await vi.waitFor(() => {
      expect(mocks.prepareImport.mock.calls.at(-1)?.[5]).toBe(true);
      expect(body.text()).toContain('Reuse verified existing images in their actual groups');
    });
    expect(mocks.executeImport).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(mocks.executeImport).toHaveBeenCalledOnce();
  });

  it('requests exact image-host permissions only on confirmation and refuses writes after denial', async () => {
    const request = vi.fn().mockResolvedValue(false);
    const { chooseBytes, selectGroup, button, body } = await setup('import', {
      services: {
        permissions: { list: () => Promise.resolve([]), revoke: () => Promise.resolve(false), request }
      }
    });
    await chooseBytes();
    await selectGroup();
    await body.get('[data-testid="template-reuse-existing-photos"]').setValue(true);
    await button('Import').trigger('click');
    await flushPromises();
    // Package hashing runs outside the promise queue; wait for confirmation, not just one flush.
    await vi.waitFor(() => {
      expect(body.text()).toContain('Confirming requests extension access');
    });
    expect(request).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^https:\/\/[^*]+\.alicdn\.com\/\*$/u)])
    );
    expect(mocks.executeImport).not.toHaveBeenCalled();
    expect(body.text()).toContain('No upload started');
  });

  it('passes copy conflicts to the material executor and cancels confirmation when the group changes', async () => {
    const { chooseBytes, selectGroup, button, body, dialog } = await setup();
    await chooseBytes();
    await selectGroup();
    await body.findAll('select').at(-1)?.setValue('copy');
    await button('Import').trigger('click');
    await flushPromises();
    await selectGroup('another-real', 'Another group');
    expect(dialog.getComponent(ConfirmActionDialog).props('open')).toBe(false);
    (dialog.getComponent(ConfirmActionDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('confirm');
    await flushPromises();
    expect(mocks.executeImport).not.toHaveBeenCalled();
    await button('Import').trigger('click');
    await flushPromises();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(mocks.executeImport.mock.calls[0]?.[3]).toBe('copy');
    expect(mocks.prepareImport.mock.calls.at(-1)?.[2]).toBe('another-real');
  });

  it('shows an accurate disabled reason when persistent gallery transfers are missing', async () => {
    mocks.transfers = undefined;
    const { chooseBytes, button, body } = await setup();
    await chooseBytes();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(body.text()).toContain('persistent gallery transfer service is unavailable');
    expect(mocks.prepareImport).not.toHaveBeenCalled();
  });

  it('shows an accurate disabled reason when the upload availability service is missing', async () => {
    const { chooseBytes, button, body } = await setup('import', { omit: ['operationAvailability'] });
    await chooseBytes();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(body.text()).toContain('image upload availability service is unavailable');
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('does not imply that an explicitly disabled upload operation can write', async () => {
    const { chooseBytes, button, body, availability } = await setup();
    availability.get.mockResolvedValue({
      items: [{ operation: 'uploadPhoto', allowed: false, reasonCode: 'MUTATION_FLAG_DISABLED' }]
    });
    await chooseBytes();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(body.text()).toContain('MUTATION_FLAG_DISABLED');
    expect(body.findComponent(PhotoGroupNavigation).exists()).toBe(false);
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('fails closed while upload availability is pending or fails', async () => {
    const { chooseBytes, button, body, availability } = await setup();
    const pending = deferred<{ items: [] }>();
    availability.get.mockReturnValueOnce(pending.promise);
    await chooseBytes();
    expect(body.text()).toContain('Checking gallery permissions');
    expect(button('Import').attributes('disabled')).toBeDefined();
    pending.resolve({ items: [] });
    await flushPromises();
    expect(body.text()).toContain('OPERATION_AVAILABILITY_UNAVAILABLE');
    expect(button('Import').attributes('disabled')).toBeDefined();
  });

  it('rejects ordinary BFF users even if an availability service claims uploads are allowed', async () => {
    const session = vi.fn().mockResolvedValue({ principal: { role: 'user' } });
    const { chooseBytes, body, button, availability } = await setup('import', {
      services: { mode: 'bff', control: { session } as unknown as NonNullable<AppServices['control']> }
    });
    await chooseBytes();
    expect(session).toHaveBeenCalledOnce();
    expect(body.text()).toContain('no gallery write permission');
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(availability.get).not.toHaveBeenCalled();
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('requires a verifiable BFF session for material uploads', async () => {
    const { chooseBytes, body, button } = await setup('import', { services: { mode: 'bff' } });
    await chooseBytes();
    expect(body.text()).toContain('Gallery write permissions could not be verified');
    expect(button('Import').attributes('disabled')).toBeDefined();
  });

  it('rechecks upload permission after confirmation before sending any write', async () => {
    const { chooseBytes, selectGroup, availability, button, body } = await setup();
    await chooseBytes();
    await selectGroup();
    await button('Import').trigger('click');
    await flushPromises();
    availability.get.mockResolvedValue({
      items: [{ operation: 'uploadPhoto', allowed: false, reasonCode: 'REAL_MUTATIONS_PAUSED' }]
    });
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(mocks.executeImport).not.toHaveBeenCalled();
    expect(body.text()).toContain('REAL_MUTATIONS_PAUSED');
  });

  it('permits text-only material imports without gallery services or a target group', async () => {
    const pack = materialPackage();
    pack.document.assets = [];
    const first = pack.document.templates[0];
    if (!first) throw new Error('Missing material template');
    first.html = '<p>Text only</p>';
    pack.assets = [];
    mocks.readArchive.mockResolvedValue(pack);
    mocks.transfers = undefined;
    const { chooseBytes, button } = await setup('import', { omit: ['operationAvailability'] });
    await chooseBytes();
    expect(button('Import').attributes('disabled')).toBeUndefined();
    await button('Import').trigger('click');
    await flushPromises();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(mocks.executeImport).toHaveBeenCalledOnce();
  });

  it('disables every import accurately when the template service is absent', async () => {
    const { choose, body, button } = await setup('import', { omit: ['productDescriptionTemplates'] });
    await choose();
    expect(body.text()).toContain('template library service is unavailable');
    expect(button('Import').attributes('disabled')).toBeDefined();
  });

  it('rejects a ZIP over 50 MiB before decoding and keeps import disabled', async () => {
    const { chooseBytes, button } = await setup();
    await chooseBytes(zipBytes, 'huge.zip', 'application/zip', 50 * 1024 * 1024 + 1);
    expect(mocks.readArchive).not.toHaveBeenCalled();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('retains the legacy 5 MiB JSON limit', async () => {
    const { chooseBytes, button } = await setup();
    await chooseBytes(
      new TextEncoder().encode(JSON.stringify(fixture)),
      'large.json',
      'application/json',
      5 * 1024 * 1024 + 1
    );
    expect(mocks.readArchive).not.toHaveBeenCalled();
    expect(button('Import').attributes('disabled')).toBeDefined();
  });

  it.each([
    'TEMPLATE_MATERIAL_ASSET_INVALID',
    'TEMPLATE_MATERIAL_UNCOMPRESSED_LIMIT',
    'TEMPLATE_MATERIAL_DIGEST_MISMATCH',
    'TEMPLATE_MATERIAL_ASSET_LIMIT',
    'TEMPLATE_MATERIAL_INVALID_DOCUMENT'
  ])('keeps import disabled when archive validation rejects %s', async (code) => {
    const { chooseBytes, button, create } = await setup();
    mocks.readArchive.mockRejectedValue(templateError(code));
    await chooseBytes();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(create).not.toHaveBeenCalled();
    expect(mocks.prepareImport).not.toHaveBeenCalled();
  });

  it('discards the material preview when a replacement file is invalid', async () => {
    const { chooseBytes, choose, button, body } = await setup();
    await chooseBytes();
    expect(body.text()).toContain('company.png');
    await choose({ kind: 'invalid' });
    expect(body.text()).not.toContain('company.png');
    expect(button('Import').attributes('disabled')).toBeDefined();
  });

  it('clears preview and forbids writes after identity switches, even if it switches back', async () => {
    const { chooseBytes, selectGroup, scope, button, body, dialog } = await setup();
    await chooseBytes();
    await selectGroup();
    await button('Import').trigger('click');
    await flushPromises();
    scope.value = 'account-b';
    await flushPromises();
    expect(body.text()).not.toContain('company.png');
    expect(dialog.getComponent(ConfirmActionDialog).props('open')).toBe(false);
    scope.value = 'account-a';
    await flushPromises();
    expect(button('Import').attributes('disabled')).toBeDefined();
    (dialog.getComponent(ConfirmActionDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('confirm');
    await flushPromises();
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('does not expose a late ZIP read after identity changes', async () => {
    const { chooseBytes, scope, body, button } = await setup();
    const pending = deferred<TemplateMaterialPackage>();
    mocks.readArchive.mockReturnValueOnce(pending.promise);
    await chooseBytes();
    scope.value = 'account-b';
    await flushPromises();
    pending.resolve(materialPackage());
    await flushPromises();
    expect(body.text()).not.toContain('company.png');
    expect(button('Import').attributes('disabled')).toBeDefined();
  });

  it('blocks closing and duplicate confirmations while executing material import', async () => {
    const { chooseBytes, selectGroup, button, dialog } = await setup();
    await chooseBytes();
    await selectGroup();
    await button('Import').trigger('click');
    await flushPromises();
    const pending = deferred<[]>();
    mocks.executeImport.mockReturnValueOnce(pending.promise);
    await button('Confirm').trigger('click');
    await flushPromises();
    const outerModal = dialog.findAllComponents(ModalDialog)[0];
    expect(outerModal?.props('dismissible')).toBe(false);
    if (outerModal) (outerModal as Pick<VueWrapper, 'vm'>).vm.$emit('update:open', false);
    (dialog.getComponent(ConfirmActionDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('confirm');
    await flushPromises();
    expect(dialog.emitted('update:open')).toBeUndefined();
    expect(mocks.executeImport).toHaveBeenCalledOnce();
    pending.resolve([]);
    await flushPromises();
  });

  it.each([
    ['zh-CN', 'gateway'],
    ['zh-CN', 'task'],
    ['en-US', 'gateway'],
    ['en-US', 'task']
  ] as const)('keeps a preflight busy task editable in %s (%s)', async (locale, kind) => {
    uiI18n.global.locale.value = locale;
    const { chooseBytes, selectGroup, button, body, create } = await setup();
    await chooseBytes();
    await selectGroup();
    const importLabel = locale === 'zh-CN' ? '导入' : 'Import';
    const confirmLabel = locale === 'zh-CN' ? '确认' : 'Confirm';
    await button(importLabel).trigger('click');
    await flushPromises();
    mocks.executeImport.mockRejectedValueOnce(
      kind === 'gateway' ? templateError('GALLERY_TASK_BUSY') : new GalleryTaskError('GALLERY_TASK_BUSY')
    );
    await button(confirmLabel).trigger('click');
    await flushPromises();
    const messages = locale === 'zh-CN' ? materialZh : materialEn;
    for (const message of splitUserVisibleErrorMessages(messages.codes.GALLERY_TASK_BUSY))
      expect(body.text()).toContain(message);
    expect(body.text()).not.toContain(messages.unknownImport);
    expect(button(importLabel).attributes('disabled')).toBeUndefined();
    expect(body.get('[data-testid=template-reuse-existing-photos]').attributes('disabled')).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    await button(importLabel).trigger('click');
    await flushPromises();
    await button(confirmLabel).trigger('click');
    await flushPromises();
    expect(mocks.executeImport).toHaveBeenCalledTimes(2);
  });

  it('never repeats unknown image imports and points to persistent gallery tasks', async () => {
    const { chooseBytes, selectGroup, button, dialog, body } = await setup();
    await chooseBytes();
    await selectGroup();
    await button('Import').trigger('click');
    await flushPromises();
    mocks.executeImport.mockRejectedValueOnce(new Error('Upload uncertain'));
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(body.text()).toContain('Do not resend');
    expect(body.text()).toContain('same account/gallery context');
    expect(body.text()).toContain('select the same real photo group');
    expect(body.text()).toContain('only verified, never resent');
    expect(button('Import').attributes('disabled')).toBeDefined();
    (dialog.getComponent(ConfirmActionDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('confirm');
    await flushPromises();
    expect(mocks.executeImport).toHaveBeenCalledOnce();
    await button('Open gallery tasks').trigger('click');
    await flushPromises();
    expect(dialog.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(mocks.transfers?.show).toHaveBeenCalledOnce();
  });

  it('states zero new uploads when a reopened package has uncertain gallery receipts', async () => {
    const { chooseBytes, selectGroup, button, body } = await setup();
    await chooseBytes();
    await selectGroup();
    mocks.prepareImport.mockResolvedValueOnce({
      package: materialPackage(),
      groupId: 'group-real',
      task: { status: 'attention', items: [{ kind: 'asset', status: 'unknown' }] }
    });
    await button('Import').trigger('click');
    await flushPromises();
    expect(body.text()).toContain('Planned new uploads: 0');
    expect(body.text()).toContain('only verifies their results');
    expect(body.text()).toContain('No new image uploads will be sent');
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('states zero new uploads and the confirmed reuse count for completed gallery receipts', async () => {
    const { chooseBytes, selectGroup, button, body } = await setup();
    await chooseBytes();
    await selectGroup();
    mocks.prepareImport.mockResolvedValueOnce({
      package: materialPackage(),
      groupId: 'group-real',
      task: {
        status: 'completed',
        items: [{ kind: 'asset', status: 'confirmed', fileId: 'image-confirmed' }]
      }
    });
    await button('Import').trigger('click');
    await flushPromises();
    expect(body.text()).toContain('Planned new uploads: 0 · confirmed materials to reuse: 1');
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('discards late ZIP export preparation after the account context changes', async () => {
    const { button, body, scope, dialog } = await setup('export');
    await body.get('[data-testid=template-material-format]').setValue('zip');
    const pending = deferred<{ package: TemplateMaterialPackage; context: null }>();
    mocks.prepareExport.mockReturnValueOnce(pending.promise);
    await button('Export').trigger('click');
    await flushPromises();
    scope.value = 'account-b';
    await flushPromises();
    pending.resolve({ package: materialPackage(), context: null });
    await flushPromises();
    expect(dialog.getComponent(ConfirmActionDialog).props('open')).toBe(false);
    expect(mocks.createArchive).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('clears preview when externally closed and ignores confirmations after closing', async () => {
    const { chooseBytes, selectGroup, button, open, body, dialog } = await setup();
    await chooseBytes();
    await selectGroup();
    await button('Import').trigger('click');
    await flushPromises();
    open.value = false;
    await flushPromises();
    expect(body.text()).not.toContain('company.png');
    (dialog.getComponent(ConfirmActionDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('confirm');
    await flushPromises();
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it('disables material image import when gallery context support is missing', async () => {
    const gateway = new MockGatewayClient(0);
    const { chooseBytes, button, body } = await setup('import', {
      services: { gateway: { request: gateway.request.bind(gateway) } }
    });
    await chooseBytes();
    expect(button('Import').attributes('disabled')).toBeDefined();
    expect(body.text()).toContain('gallery context service is unavailable');
  });

  it('allows a text-only ZIP export without requiring a gallery context service', async () => {
    const gateway = new MockGatewayClient(0);
    const { button, body } = await setup('export', {
      services: { gateway: { request: gateway.request.bind(gateway) } }
    });
    await body.get('[data-testid=template-material-format]').setValue('zip');
    expect(button('Export').attributes('disabled')).toBeUndefined();
    await button('Export').trigger('click');
    await flushPromises();
    expect(mocks.prepareExport).toHaveBeenCalledOnce();
  });

  it('packs a local ZIP and downloads only after confirmation, without any S3 PUT', async () => {
    const { button, body, s3, template } = await setup('export');
    await body.get('[data-testid=template-material-format]').setValue('zip');
    const original = template.name;
    template.name = 'Later change';
    await button('Export').trigger('click');
    await flushPromises();
    const snapshot = mocks.prepareExport.mock.calls[0]?.[1] as (typeof template)[];
    expect(snapshot[0]?.name).toBe(original);
    expect(mocks.createArchive).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(download).toHaveBeenCalledWith(
      'one-vegetable-template-materials.zip',
      zipBytes,
      'application/zip'
    );
    expect(s3.putS3Object).not.toHaveBeenCalled();
    expect(mocks.executeBackup).not.toHaveBeenCalled();
  });

  it('uses the multipart S3 backup helper only after confirmation and never uploads a ZIP', async () => {
    const { button, body, s3 } = await setup('export');
    await body.get('select').setValue('s3');
    expect(body.get('input[type=checkbox]').element).toHaveProperty('checked', false);
    await body.get('input[type=checkbox]').setValue(true);
    await button('Export').trigger('click');
    await flushPromises();
    expect(mocks.prepareBackup).toHaveBeenCalledWith(
      s3,
      expect.any(Object),
      'templates',
      expect.any(Function)
    );
    expect(mocks.executeBackup).not.toHaveBeenCalled();
    expect(s3.putS3Object).not.toHaveBeenCalled();
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(mocks.executeBackup).toHaveBeenCalledOnce();
    expect(mocks.verifyBackup).toHaveBeenCalledOnce();
    expect(mocks.createArchive).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps prefix/key and exposes read-only verification after an uncertain multipart backup', async () => {
    const { button, body, dialog, s3 } = await setup('export');
    await body.get('select').setValue('s3');
    await body.get('input[type=checkbox]').setValue(true);
    await button('Export').trigger('click');
    await flushPromises();
    mocks.executeBackup.mockRejectedValueOnce(new Error('Second image write uncertain'));
    await button('Confirm').trigger('click');
    await flushPromises();
    expect(body.text()).toContain('templates/material-batch/templates.json');
    expect(body.text()).toContain('Backup prefix: templates');
    expect(button('Export').attributes('disabled')).toBeDefined();
    expect(body.get('input[type=checkbox]').attributes('disabled')).toBeDefined();
    (dialog.getComponent(ConfirmActionDialog) as Pick<VueWrapper, 'vm'>).vm.$emit('confirm');
    await flushPromises();
    await button('Verify results').trigger('click');
    await flushPromises();
    expect(mocks.executeBackup).toHaveBeenCalledOnce();
    expect(mocks.verifyBackup).toHaveBeenCalledOnce();
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });

  it('reads and verifies an S3 material manifest without creating images or templates', async () => {
    const { s3, body, button, create } = await setup();
    await body.get('select').setValue('s3');
    s3.listS3Objects.mockResolvedValue({
      items: [{ key: 'templates/assets/templates.json', size: 500, etag: null, lastModifiedTimeUtc: null }],
      nextContinuationToken: null
    });
    await button('Find packages').trigger('click');
    await flushPromises();
    await body.findAll('select')[1]?.setValue('templates/assets/templates.json');
    mocks.readBackup.mockResolvedValueOnce(materialPackage());
    await button('Preview package').trigger('click');
    await flushPromises();
    expect(mocks.readBackup).toHaveBeenCalledWith(
      s3,
      'templates/assets/templates.json',
      expect.any(Function)
    );
    expect(body.text()).toContain('company.png');
    expect(create).not.toHaveBeenCalled();
    expect(mocks.executeImport).not.toHaveBeenCalled();
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });

  it('retains legacy S3 JSON parsing when the material reader returns null', async () => {
    const { s3, body, button } = await setup();
    await body.get('select').setValue('s3');
    s3.listS3Objects.mockResolvedValue({
      items: [{ key: 'templates/old/templates.json', size: 500, etag: null, lastModifiedTimeUtc: null }],
      nextContinuationToken: null
    });
    await button('Find packages').trigger('click');
    await flushPromises();
    await body.findAll('select')[1]?.setValue('templates/old/templates.json');
    s3.getS3Object.mockResolvedValue({
      key: 'templates/old/templates.json',
      bytes: new TextEncoder().encode(JSON.stringify(fixture)),
      contentType: 'application/json',
      etag: null
    });
    await button('Preview package').trigger('click');
    await flushPromises();
    expect(body.text()).toContain('2 templates');
    expect(button('Import').attributes('disabled')).toBeUndefined();
    expect(mocks.prepareImport).not.toHaveBeenCalled();
  });

  it('provides bilingual lazy namespace messages without adding them to the main message modules', async () => {
    const { body } = await setup('export');
    expect(body.text()).toContain('Local export format');
    uiI18n.global.locale.value = 'zh-CN';
    await flushPromises();
    expect(body.text()).toContain('本地导出格式');
    expect(Object.keys(materialZh.codes).sort()).toEqual(Object.keys(materialEn.codes).sort());
    for (const code of [
      'TEMPLATE_MATERIAL_LIMIT',
      'TEMPLATE_MATERIAL_INVALID_IMAGE',
      'TEMPLATE_MATERIAL_GROUP_REQUIRED',
      'TEMPLATE_MATERIAL_UNAVAILABLE'
    ]) {
      expect(uiI18n.global.te(`errors.codes.${code}`, 'zh-CN')).toBe(true);
      expect(uiI18n.global.te(`errors.codes.${code}`, 'en-US')).toBe(true);
    }
  });
});
