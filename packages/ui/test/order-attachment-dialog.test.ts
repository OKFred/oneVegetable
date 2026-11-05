// @vitest-environment jsdom
import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { GatewayClient, SettingsRepository } from '@one-vegetable/core';
import type { EncodedFilePayload } from '../../core/src/encoded-file';
import type { GalleryTransferContext } from '../../core/src/gallery-transfer-task';
import type { OrderAttachmentControl, OrderAttachmentReceipt } from '../../core/src/order-attachments';
import { ORDER_ATTACHMENT_METHOD } from '../../core/src/order-fulfillment-methods';
import OrderAttachmentDialog from '../src/components/OrderAttachmentDialog.vue';
import ConfirmActionDialog from '../src/components/ConfirmActionDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { uiI18n } from '../src/i18n';

const feedback = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast: feedback }));
const limit = 5_000_000;
const contextValue: GalleryTransferContext = {
  identity: 'fixture-owner',
  gateway: 'fixture-iop',
  storage: null
};
const wrappers: VueWrapper[] = [];
const hosts: HTMLElement[] = [];
const uuid = vi.fn();
let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  uuid.mockImplementation(() => '00000000-0000-4000-8000-' + String(++nextId).padStart(12, '0'));
  vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID: uuid });
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function encodedFile(overrides: Partial<EncodedFilePayload> = {}, size = 18): EncodedFilePayload {
  const bytes = Buffer.alloc(size);
  bytes.set(Buffer.from('%PDF-1.7').subarray(0, Math.min(8, size)));
  return {
    fileName: 'fixture.pdf',
    contentType: 'application/pdf',
    byteLength: bytes.length,
    contentBase64: bytes.toString('base64'),
    ...overrides
  };
}
function mockReceipt(overrides: Partial<OrderAttachmentReceipt> = {}): OrderAttachmentReceipt {
  const file = encodedFile();
  return {
    jobId: '00000000-0000-4000-8000-000000000001',
    requestId: '00000000-0000-4000-8000-000000000001',
    status: 'accepted',
    fileName: file.fileName,
    size: file.byteLength,
    sha256: createHash('sha256').update(Buffer.from(file.contentBase64, 'base64')).digest('hex'),
    createdTimeUtc: 1000,
    updatedTimeUtc: 1000,
    gatewayId: contextValue.gateway,
    protocol: 'iop',
    platformReference: 'fixture_attachment',
    errorCode: null,
    traceId: 'fixture-trace',
    ...overrides
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
interface Source {
  name: string;
  load: () => Promise<EncodedFilePayload>;
}
function source(file = encodedFile()) {
  return { name: 'fixture-storage/fixture.pdf', load: vi.fn(() => Promise.resolve(file)) };
}
function setup(
  options: {
    source?: Source;
    open?: boolean;
    control?: boolean;
    context?: boolean;
  } = {}
) {
  const props = reactive<{ source?: Source; open?: boolean }>({
    ...(options.source ? { source: options.source } : {}),
    ...(options.open === undefined ? {} : { open: options.open })
  });
  const identity = ref(contextValue.identity);
  const request = vi.fn<GatewayClient['request']>();
  const context = vi
    .fn<NonNullable<GatewayClient['galleryTransferContext']>>()
    .mockResolvedValue(contextValue);
  const upload = vi.fn<OrderAttachmentControl['upload']>().mockImplementation((input) =>
    Promise.resolve(
      mockReceipt({
        jobId: input.requestId,
        requestId: input.requestId,
        fileName: input.file.fileName,
        size: input.file.byteLength,
        sha256: createHash('sha256').update(Buffer.from(input.file.contentBase64, 'base64')).digest('hex')
      })
    )
  );
  const get = vi.fn<OrderAttachmentControl['get']>().mockImplementation((input) =>
    Promise.resolve(
      mockReceipt({
        jobId: input.jobId,
        requestId: input.jobId
      })
    )
  );
  const onClose = vi.fn(() => {
    props.open = false;
  });
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway: { request, ...(options.context === false ? {} : { galleryTransferContext: context }) },
          settings: {} as SettingsRepository,
          mode: 'bff',
          ...(options.control === false ? {} : { orderAttachments: { upload, get } })
        });
        provideListIdentityScope(computed(() => identity.value));
        return () => h(OrderAttachmentDialog, { ...props, onClose });
      }
    }),
    {
      attachTo: host,
      global: {
        stubs: {
          ModalDialog: {
            props: ['open', 'title', 'description', 'dismissible'],
            emits: ['update:open'],
            template:
              '<section v-if="open" role="dialog"><h2>{{ title }}</h2><p>{{ description }}</p><slot/><slot name="footer"/></section>'
          }
        }
      }
    }
  );
  wrappers.push(wrapper);
  return { wrapper, props, identity, request, context, upload, get, onClose };
}
function label(key: string): string {
  return uiI18n.global.t('orderAttachments.' + key);
}
function button(wrapper: Pick<VueWrapper, 'findAll'>, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === text);
  if (!found) throw new Error('Missing button: ' + text);
  return found;
}
async function ready(wrapper: VueWrapper) {
  await vi.waitFor(() => {
    expect(wrapper.find('dl').exists()).toBe(true);
  });
}
async function readSource(wrapper: VueWrapper) {
  await button(wrapper, label('read')).trigger('click');
  await ready(wrapper);
}
async function openConfirmation(wrapper: VueWrapper) {
  await button(wrapper, label('upload')).trigger('click');
  expect(wrapper.getComponent(ConfirmActionDialog).props('open')).toBe(true);
}
async function confirm(wrapper: VueWrapper) {
  await openConfirmation(wrapper);
  await button(wrapper.getComponent(ConfirmActionDialog), label('upload')).trigger('click');
}
function pickedFile(file = encodedFile(), type = file.contentType) {
  const bytes = Uint8Array.from(Buffer.from(file.contentBase64, 'base64'));
  const picked = new File([bytes.buffer], file.fileName, { type });
  const arrayBuffer = vi.fn(() => Promise.resolve(bytes.buffer.slice(0)));
  // jsdom does not implement Blob.arrayBuffer; validation and WebCrypto remain real.
  Object.defineProperty(picked, 'arrayBuffer', { value: arrayBuffer });
  return { picked, arrayBuffer };
}
async function pick(wrapper: VueWrapper, file: File) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change');
}
function noFeedback() {
  expect(feedback.success).not.toHaveBeenCalled();
  expect(feedback.warning).not.toHaveBeenCalled();
  expect(feedback.error).not.toHaveBeenCalled();
}

describe('order attachment dialog', () => {
  it.each([true, false])('does not read or upload merely by opening: %s', async (open) => {
    const selected = source();
    const s = setup({ source: selected, open });
    await flushPromises();
    expect(selected.load).not.toHaveBeenCalled();
    expect(s.context).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  });
  it('defaults open and has no available upload until a valid file is explicitly selected', () => {
    const s = setup();
    expect(s.wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(button(s.wrapper, label('upload')).attributes('disabled')).toBeDefined();
    expect(s.wrapper.getComponent(ConfirmActionDialog).props('open')).toBe(false);
  });
  it('explicitly reads the source locally but does not query context or upload before confirmation', async () => {
    const file = encodedFile();
    const selected = source(file);
    const s = setup({ source: selected });
    await readSource(s.wrapper);
    expect(selected.load).toHaveBeenCalledTimes(1);
    expect(s.wrapper.get('dl').text()).toContain(file.fileName);
    expect(s.wrapper.get('dl').text()).toContain(
      createHash('sha256').update(Buffer.from(file.contentBase64, 'base64')).digest('hex')
    );
    expect(s.wrapper.get('dl').attributes('data-feedback-redact')).toBeDefined();
    await openConfirmation(s.wrapper);
    expect(s.context).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    await button(
      s.wrapper.getComponent(ConfirmActionDialog),
      uiI18n.global.t('common.actions.cancel')
    ).trigger('click');
    expect(s.wrapper.getComponent(ConfirmActionDialog).props('open')).toBe(false);
    expect(s.upload).not.toHaveBeenCalled();
  });
  it('selects the real attachment method with the actual filename before one upload, even on double confirm', async () => {
    const file = encodedFile({ fileName: 'actual-selected.pdf' });
    const s = setup({ source: source(file) });
    const pending = deferred<GalleryTransferContext>();
    s.context.mockReturnValueOnce(pending.promise);
    await readSource(s.wrapper);
    await openConfirmation(s.wrapper);
    const confirmButton = button(s.wrapper.getComponent(ConfirmActionDialog), label('upload'));
    await Promise.all([confirmButton.trigger('click'), confirmButton.trigger('click')]);
    expect(s.context).toHaveBeenCalledExactlyOnceWith('callCapability', {
      method: ORDER_ATTACHMENT_METHOD,
      parameters: { file_name: 'actual-selected.pdf' }
    });
    expect(s.upload).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    pending.resolve(contextValue);
    await vi.waitFor(() => {
      expect(s.upload).toHaveBeenCalledTimes(1);
    });
    await flushPromises();
    expect(s.upload).toHaveBeenCalledExactlyOnceWith({
      requestId: '00000000-0000-4000-8000-000000000001',
      file,
      context: contextValue
    });
    expect(s.request).not.toHaveBeenCalled();
    expect(s.get).not.toHaveBeenCalled();
    expect(uuid).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['application/pdf', 'fixture.pdf', [37, 80, 68, 70, 45, 49]],
    ['image/png', 'fixture.png', [137, 80, 78, 71, 13, 10, 26, 10]],
    ['image/jpeg', 'fixture.jpeg', [255, 216, 255, 224]],
    ['application/msword', 'fixture.doc', [208, 207, 17, 224, 161, 177, 26, 225]]
  ] as const)(
    'accepts a matching %s file header without any provider call',
    async (contentType, fileName, header) => {
      const file = encodedFile({
        contentType,
        fileName,
        byteLength: header.length,
        contentBase64: Buffer.from(header).toString('base64')
      });
      const local = pickedFile(file, contentType === 'application/msword' ? '' : contentType);
      const s = setup();
      await pick(s.wrapper, local.picked);
      await ready(s.wrapper);
      expect(s.wrapper.get('dl').text()).toContain(fileName);
      expect(local.arrayBuffer).toHaveBeenCalledTimes(1);
      expect(s.context).not.toHaveBeenCalled();
      expect(s.upload).not.toHaveBeenCalled();
      expect(s.request).not.toHaveBeenCalled();
    }
  );
  it.each([
    { fileName: 'renamed.jpg', contentType: 'image/jpeg' },
    { fileName: 'fixture.pdf', contentType: 'text/html' },
    { fileName: 'fixture.png', contentType: 'image/png' },
    { contentBase64: 'AAAA', byteLength: 3 },
    { byteLength: 99 },
    { fileName: '../fixture.pdf' }
  ])('rejects mismatched headers, types, lengths or unsafe names: %j', async (change) => {
    const s = setup({ source: source(encodedFile(change)) });
    await button(s.wrapper, label('read')).trigger('click');
    await vi.waitFor(() => {
      expect(s.wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(s.wrapper.find('dl').exists()).toBe(false);
    expect(button(s.wrapper, label('upload')).attributes('disabled')).toBeDefined();
    expect(s.context).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
  });
  it.each([limit - 1, limit])('accepts a valid local file of %i bytes (5 MB inclusive)', async (size) => {
    const file = encodedFile({}, size);
    const local = pickedFile(file);
    const s = setup();
    await pick(s.wrapper, local.picked);
    await ready(s.wrapper);
    expect(s.wrapper.get('dl').text()).toContain(String(size) + ' B');
    expect(button(s.wrapper, label('upload')).attributes('disabled')).toBeUndefined();
    expect(s.context).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
  });
  it.each([0, limit + 1])('rejects a local %i-byte file before even reading its bytes', async (size) => {
    const local = pickedFile(encodedFile({}, size));
    const s = setup();
    await pick(s.wrapper, local.picked);
    await vi.waitFor(() => {
      expect(s.wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(local.arrayBuffer).not.toHaveBeenCalled();
    expect(s.context).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
  });
  it('also rejects an oversized S3 payload rather than relying only on the browser input', async () => {
    const s = setup({ source: source(encodedFile({}, limit + 1)) });
    await button(s.wrapper, label('read')).trigger('click');
    await vi.waitFor(() => {
      expect(s.wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(s.wrapper.find('dl').exists()).toBe(false);
    expect(s.context).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
  });
  it.each(['accepted', 'sending', 'unknown', 'failed'] as const)(
    'shows a %s receipt without claiming order association',
    async (status) => {
      const s = setup({ source: source() });
      s.upload.mockImplementationOnce((input) =>
        Promise.resolve(
          mockReceipt({
            jobId: input.requestId,
            requestId: input.requestId,
            status,
            platformReference: status === 'accepted' ? 'fixture_attachment' : null,
            errorCode: status === 'unknown' ? 'ORDER_ATTACHMENT_RESULT_UNKNOWN' : null
          })
        )
      );
      await readSource(s.wrapper);
      await confirm(s.wrapper);
      await flushPromises();
      if (status === 'accepted') {
        expect(s.wrapper.text()).toContain('Attachment received by platform');
        expect(s.wrapper.text()).toContain(
          'Upload accepted only; this does not mean it is associated with an order.'
        );
        expect(feedback.success).toHaveBeenCalledExactlyOnceWith(label('accepted'));
      } else {
        expect(s.wrapper.text()).not.toContain(label('acceptedNote'));
        expect(feedback.success).not.toHaveBeenCalled();
      }
      expect(s.wrapper.text()).not.toMatch(
        /associated successfully|order association complete|订单关联完成/iu
      );
      expect(s.upload).toHaveBeenCalledTimes(1);
      expect(s.get).not.toHaveBeenCalled();
    }
  );
  it('keeps an ambiguous upload on its original job ID and only permits get, never a resend', async () => {
    const s = setup({ source: source() });
    s.upload.mockRejectedValueOnce(new Error('Network interrupted after sending'));
    await readSource(s.wrapper);
    await confirm(s.wrapper);
    await flushPromises();
    const original = s.upload.mock.calls[0]?.[0].requestId;
    expect(original).toBe('00000000-0000-4000-8000-000000000001');
    expect(s.wrapper.text()).toContain(label('unknown'));
    expect(s.wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(s.wrapper.findAll('button').some((item) => item.text() === label('upload'))).toBe(false);
    expect(s.wrapper.findAll('button').some((item) => item.text() === label('read'))).toBe(false);
    expect(uuid).toHaveBeenCalledTimes(1);
    await button(s.wrapper, label('query')).trigger('click');
    await flushPromises();
    expect(s.get).toHaveBeenCalledExactlyOnceWith({
      requestId: '00000000-0000-4000-8000-000000000002',
      jobId: original
    });
    expect(s.upload).toHaveBeenCalledTimes(1);
    expect(s.context).toHaveBeenCalledTimes(1);
    expect(s.request).not.toHaveBeenCalled();
  });
  it('keeps an ambiguous job query-only across close and reopen', async () => {
    const s = setup({ source: source() });
    s.upload.mockRejectedValueOnce(new Error('Ambiguous upload'));
    await readSource(s.wrapper);
    await confirm(s.wrapper);
    await flushPromises();
    await button(s.wrapper, label('close')).trigger('click');
    s.props.open = true;
    await nextTick();
    expect(s.wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(s.wrapper.findAll('button').some((item) => item.text() === label('upload'))).toBe(false);
    await button(s.wrapper, label('query')).trigger('click');
    await flushPromises();
    expect(s.get).toHaveBeenCalledExactlyOnceWith({
      requestId: '00000000-0000-4000-8000-000000000002',
      jobId: '00000000-0000-4000-8000-000000000001'
    });
    expect(s.upload).toHaveBeenCalledTimes(1);
  });
  it('clears the old transport error when get confirms an accepted receipt', async () => {
    const s = setup({ source: source() });
    s.upload.mockRejectedValueOnce(new Error('Ambiguous upload'));
    await readSource(s.wrapper);
    await confirm(s.wrapper);
    await flushPromises();
    expect(s.wrapper.find('[role="alert"]').exists()).toBe(true);
    await button(s.wrapper, label('query')).trigger('click');
    await flushPromises();
    expect(s.wrapper.text()).toContain(label('acceptedNote'));
    expect(s.wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(s.upload).toHaveBeenCalledTimes(1);
  });
  it('keeps get errors on the same original job instead of returning to upload', async () => {
    const s = setup({ source: source() });
    s.upload.mockRejectedValueOnce(new Error('Ambiguous upload'));
    s.get.mockRejectedValueOnce(new Error('Receipt temporarily unavailable'));
    await readSource(s.wrapper);
    await confirm(s.wrapper);
    await flushPromises();
    await button(s.wrapper, label('query')).trigger('click');
    await flushPromises();
    expect(s.wrapper.text()).toContain(label('unknown'));
    expect(s.wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(s.upload).toHaveBeenCalledTimes(1);
    await button(s.wrapper, label('query')).trigger('click');
    await flushPromises();
    expect(s.get.mock.calls.map(([input]) => input.jobId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001'
    ]);
    expect(s.upload).toHaveBeenCalledTimes(1);
  });
  for (const phase of ['source', 'context', 'upload', 'get'] as const) {
    it.each([
      ['identity', 'success'],
      ['identity', 'failure'],
      ['source', 'success'],
      ['source', 'failure']
    ] as const)('drops late ' + phase + ' %s/%s results', async (change, outcome) => {
      const hashes = vi.spyOn(webcrypto.subtle, 'digest');
      const selected = source();
      const s = setup({ source: selected });
      const loadPending = deferred<EncodedFilePayload>();
      const contextPending = deferred<GalleryTransferContext>();
      const uploadPending = deferred<OrderAttachmentReceipt>();
      const getPending = deferred<OrderAttachmentReceipt>();
      if (phase === 'source') {
        selected.load.mockReturnValueOnce(loadPending.promise);
        await button(s.wrapper, label('read')).trigger('click');
      } else {
        await readSource(s.wrapper);
        if (phase === 'context') s.context.mockReturnValueOnce(contextPending.promise);
        else if (phase === 'upload') s.upload.mockReturnValueOnce(uploadPending.promise);
        else {
          s.upload.mockRejectedValueOnce(new Error('Ambiguous upload'));
          s.get.mockReturnValueOnce(getPending.promise);
        }
        await confirm(s.wrapper);
        if (phase === 'get') {
          await flushPromises();
          await button(s.wrapper, label('query')).trigger('click');
        }
      }
      const replacement = source(encodedFile({ fileName: 'replacement.pdf' }));
      if (change === 'identity') s.identity.value = 'different-owner';
      else s.props.source = replacement;
      await nextTick();
      const failure = new Error('Late failure must not become current');
      if (phase === 'source') {
        if (outcome === 'success') loadPending.resolve(encodedFile());
        else loadPending.reject(failure);
      } else if (phase === 'context') {
        if (outcome === 'success') contextPending.resolve(contextValue);
        else contextPending.reject(failure);
      } else if (phase === 'upload') {
        if (outcome === 'success') uploadPending.resolve(mockReceipt());
        else uploadPending.reject(failure);
      } else {
        if (outcome === 'success') getPending.resolve(mockReceipt());
        else getPending.reject(failure);
      }
      await flushPromises();
      for (const hash of hashes.mock.results) if (hash.type === 'return') await hash.value;
      await flushPromises();
      expect(s.wrapper.find('dl').exists()).toBe(false);
      expect(s.wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(s.wrapper.text()).not.toContain(label('acceptedNote'));
      expect(replacement.load).not.toHaveBeenCalled();
      if (phase === 'source' || phase === 'context') expect(s.upload).not.toHaveBeenCalled();
      else expect(s.upload).toHaveBeenCalledTimes(1);
      if (phase !== 'get') expect(s.get).not.toHaveBeenCalled();
      noFeedback();
    });
  }
  it('clears a prepared file and confirmation when the parent closes, then reopens without reading', async () => {
    const selected = source();
    const s = setup({ source: selected });
    await readSource(s.wrapper);
    await openConfirmation(s.wrapper);
    s.props.open = false;
    await nextTick();
    expect(s.wrapper.find('dl').exists()).toBe(false);
    expect(s.wrapper.getComponent(ConfirmActionDialog).props('open')).toBe(false);
    s.props.open = true;
    await nextTick();
    expect(s.wrapper.find('dl').exists()).toBe(false);
    expect(button(s.wrapper, label('upload')).attributes('disabled')).toBeDefined();
    expect(selected.load).toHaveBeenCalledTimes(1);
    expect(s.context).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
  });
  it('emits close through the footer and releases selected bytes on the parent close handoff', async () => {
    const s = setup({ source: source() });
    await readSource(s.wrapper);
    await button(s.wrapper, label('close')).trigger('click');
    await nextTick();
    expect(s.onClose).toHaveBeenCalledTimes(1);
    s.props.open = true;
    await nextTick();
    expect(s.wrapper.find('dl').exists()).toBe(false);
    expect(s.upload).not.toHaveBeenCalled();
  });
  it('discards a pending file read on unmount', async () => {
    const pending = deferred<EncodedFilePayload>();
    const selected = source();
    selected.load.mockReturnValueOnce(pending.promise);
    const s = setup({ source: selected });
    await button(s.wrapper, label('read')).trigger('click');
    s.wrapper.unmount();
    wrappers.splice(wrappers.indexOf(s.wrapper), 1);
    pending.resolve(encodedFile());
    await flushPromises();
    expect(s.context).not.toHaveBeenCalled();
    expect(s.upload).not.toHaveBeenCalled();
    noFeedback();
  });
  it.each(['control', 'context'] as const)(
    'disables upload when the %s capability is absent',
    async (missing) => {
      const s = setup({ source: source(), [missing]: false });
      await readSource(s.wrapper);
      expect(s.wrapper.text()).toContain(label('unavailable'));
      expect(button(s.wrapper, label('upload')).attributes('disabled')).toBeDefined();
      expect(s.upload).not.toHaveBeenCalled();
      expect(s.context).not.toHaveBeenCalled();
    }
  );
  it('renders filename and reference as redacted text, never HTML or an upstream link', async () => {
    const file = encodedFile({ fileName: '<img src=x onerror=alert(1)>.pdf' });
    const s = setup({ source: source(file) });
    await readSource(s.wrapper);
    await confirm(s.wrapper);
    await flushPromises();
    expect(s.wrapper.get('dl').text()).toContain(file.fileName);
    expect(s.wrapper.get('dl').attributes('data-feedback-redact')).toBeDefined();
    expect(s.wrapper.findAll('img,script,iframe,a')).toHaveLength(0);
    expect(
      s.wrapper.findAll('[data-feedback-redact]').some((item) => item.text().includes('fixture_attachment'))
    ).toBe(true);
  });
  it.each([
    [
      'en-US',
      'Platform attachments',
      'Upload accepted only; this does not mean it is associated with an order.'
    ],
    ['zh-CN', '平台附件', '仅表示上传已受理，不代表已关联订单。']
  ] as const)('shows the %s upload and acceptance wording', async (locale, title, note) => {
    uiI18n.global.locale.value = locale;
    const s = setup({ source: source() });
    expect(s.wrapper.text()).toContain(title);
    await readSource(s.wrapper);
    await openConfirmation(s.wrapper);
    expect(s.wrapper.text()).toContain(label('confirmation'));
    await button(s.wrapper.getComponent(ConfirmActionDialog), label('upload')).trigger('click');
    await flushPromises();
    expect(s.wrapper.text()).toContain(note);
    expect(s.wrapper.text()).not.toMatch(/orderAttachments\.[A-Za-z]/u);
    expect(s.context).toHaveBeenCalledTimes(1);
    expect(s.upload).toHaveBeenCalledTimes(1);
  });
});
