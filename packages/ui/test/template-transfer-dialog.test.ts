// @vitest-environment jsdom
import { computed, defineComponent, h, ref } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/template-library.json';
import configuration from '../../../mock/data/template-library-s3.json';
import { MemoryProductDescriptionTemplateClient } from '../../core/src/product-description-template-client';
import { parseTemplateBundle } from '../../core/src/template-library';
import type { S3StorageControl } from '../../core/src/s3-storage';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import TemplateTransferDialog from '../src/components/TemplateTransferDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { uiI18n } from '../src/i18n';

const download = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/gallery-transfer-service', () => ({ downloadGalleryFile: download }));
const cleanup: (() => void)[] = [];
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
  download.mockClear();
});
afterEach(() => {
  for (const run of cleanup.splice(0)) run();
  document.body.replaceChildren();
  uiI18n.global.locale.value = 'zh-CN';
});

async function setup(mode: 'import' | 'export' = 'import') {
  const client = new MemoryProductDescriptionTemplateClient();
  const portable = parseTemplateBundle(new TextEncoder().encode(JSON.stringify(fixture))).templates;
  const first = portable[0];
  if (!first) throw new Error('Missing template fixture');
  const template = await client.create(first);
  const create = vi.spyOn(client, 'create');
  const scope = ref('account-a');
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
        provideServices({
          gateway: new MockGatewayClient(0),
          mode: 'extension',
          s3Storage: s3,
          productDescriptionTemplates: client,
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
          }
        });
        return () => h(TemplateTransferDialog, { open: true, mode, templates: [template] });
      }
    }),
    { attachTo: document.body }
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
    const input = body.get('input[type=file]');
    const file = new File([JSON.stringify(value)], 'templates.json', { type: 'application/json' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(value)).buffer)
    });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();
  }
  return { client, create, scope, s3, body, button, choose, template };
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
