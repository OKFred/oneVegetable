import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accepted: true, upload: vi.fn(), message: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mocks.message } } }));
vi.mock('@one-vegetable/core/alibaba-iop-business', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isAccountVerifiedIopMethod: () => mocks.accepted
}));
vi.mock('../../../packages/core/src/order-attachment-platform', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  uploadOrderAttachmentPlatform: mocks.upload
}));
import { AlibabaClient, type GatewaySettings } from '@one-vegetable/core';
import { galleryGatewayId, opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import {
  OrderAttachmentService,
  type OrderAttachmentBinding,
  type OrderAttachmentRecord
} from '@one-vegetable/core/order-attachments';
import { ExtensionOrderAttachmentRepository } from '../lib/order-attachment-repository';
import { handleOrderAttachment } from '../lib/order-attachment-service';
import { extensionOrderAttachments } from '../lib/order-attachment-client';

const file = {
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  byteLength: 9,
  contentBase64: btoa('%PDF-1.7\n')
};
const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), storage: null };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  mocks.accepted = true;
  mocks.upload.mockReset().mockResolvedValue({ reference: '/attachments/opaque.pdf', traceId: 'trace-1' });
  mocks.message.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  const repository = new ExtensionOrderAttachmentRepository();
  const send = vi
    .fn<OrderAttachmentBinding['send']>()
    .mockResolvedValue({ reference: '/attachments/opaque.pdf', traceId: 'trace-1' });
  const binding: OrderAttachmentBinding = { ownerId: 'admin', context, protocol: 'iop', enabled: true, send };
  const service = new OrderAttachmentService(repository, binding, () => 100);
  const input = { requestId: crypto.randomUUID(), file, context };
  return { repository, binding, send, service, input };
}
async function runtime() {
  const settings: GatewaySettings = {
    protocol: 'iop',
    appKey: 'fixture-app',
    appSecret: 'fixture-secret',
    accessToken: 'fixture-token',
    endpoint: 'https://api.alibaba.com/rest',
    signMethod: 'hmac-sha256'
  };
  const actual = {
    identity: await opaqueGalleryId('extension:local-admin'),
    gateway: await galleryGatewayId(settings),
    storage: null
  };
  const options = {
    loadSettings: vi.fn().mockResolvedValue(settings),
    contextId: vi.fn().mockResolvedValue(null),
    methodEnabled: vi.fn().mockReturnValue(true)
  };
  const input = {
    kind: 'order-attachment-request',
    action: 'upload',
    requestId: crypto.randomUUID(),
    file,
    context: actual
  };
  return { settings, actual, options, input };
}

describe('extension order attachment durable repository', () => {
  it('explicitly clears only its own store in a completed transaction', async () => {
    const t = setup();
    await t.service.upload(t.input);
    const removeDatabase = vi.spyOn(indexedDB, 'deleteDatabase');
    await t.repository.clearAll();
    expect(await new ExtensionOrderAttachmentRepository().get(t.input.requestId, 'admin')).toBeNull();
    expect(removeDatabase).not.toHaveBeenCalled();
  });
  it('commits sending before dispatch and survives a repository/service restart', async () => {
    const t = setup();
    t.send.mockImplementation(async (_file, id) => {
      expect(await new ExtensionOrderAttachmentRepository().get(id, 'admin')).toMatchObject({
        receipt: { status: 'sending' }
      });
      return { reference: '/attachments/opaque.pdf' };
    });
    const saved = await t.service.upload(t.input);
    const repository = new ExtensionOrderAttachmentRepository();
    const restarted = new OrderAttachmentService(repository, t.binding);
    expect(await restarted.get({ requestId: crypto.randomUUID(), jobId: saved.jobId })).toEqual(saved);
    expect(await restarted.upload(t.input)).toEqual(saved);
    expect(t.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(await repository.get(saved.jobId, 'admin'))).not.toContain('contentBase64');
  });
  it('serializes concurrent same-ID and pending-content claims across repository instances', async () => {
    const t = setup();
    let release!: (result: { reference: string }) => void;
    t.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const first = t.service.upload(t.input);
    await vi.waitFor(() => {
      expect(t.send).toHaveBeenCalledOnce();
    });
    const parallel = new OrderAttachmentService(
      new ExtensionOrderAttachmentRepository(),
      t.binding,
      () => 100
    );
    expect(await parallel.upload(t.input)).toMatchObject({ status: 'sending' });
    await expect(parallel.upload({ ...t.input, requestId: crypto.randomUUID() })).rejects.toThrow(
      'ORDER_ATTACHMENT_UPLOAD_PENDING'
    );
    release({ reference: '/attachments/opaque.pdf' });
    await first;
    expect(t.send).toHaveBeenCalledOnce();
  });
  it('blocks changed request IDs while unknown, but permits a deliberate new accepted upload', async () => {
    const t = setup();
    t.send.mockRejectedValueOnce(new Error('https://private.invalid/?secret=never-log'));
    expect(await t.service.upload(t.input)).toMatchObject({ status: 'unknown' });
    await expect(t.service.upload({ ...t.input, requestId: crypto.randomUUID() })).rejects.toThrow(
      'ORDER_ATTACHMENT_UPLOAD_PENDING'
    );
    const otherContent = { ...file, byteLength: 10, contentBase64: btoa('%PDF-1.7\nx') };
    const next = { ...t.input, requestId: crypto.randomUUID(), file: otherContent };
    expect(await t.service.upload(next)).toMatchObject({ status: 'accepted' });
    expect(await t.service.upload({ ...next, requestId: crypto.randomUUID() })).toMatchObject({
      status: 'accepted'
    });
    expect(t.send).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(await t.repository.get(t.input.requestId, 'admin'))).not.toContain(
      'private.invalid'
    );
  });
  it('prevents owner/context/intent rewrites and final-state resets', async () => {
    const t = setup();
    await t.service.upload(t.input);
    const record = await t.repository.get(t.input.requestId, 'admin');
    if (!record) throw new Error('fixture record missing');
    expect(await t.repository.get(t.input.requestId, 'other')).toBeNull();
    await expect(t.repository.finish({ ...record, ownerId: 'other' })).rejects.toThrow(
      'ORDER_ATTACHMENT_REQUEST_CONFLICT'
    );
    await expect(t.repository.finish(record)).rejects.toThrow('ORDER_ATTACHMENT_REQUEST_CONFLICT');
    await expect(
      t.repository.insert({ ...record, contentBase64: 'secret' } as OrderAttachmentRecord)
    ).rejects.toThrow('ORDER_ATTACHMENT_RECORD_CORRUPT');
  });
  it('does not send without storage and preserves sending after final storage failure', async () => {
    const t = setup();
    const insert = vi.spyOn(t.repository, 'insert').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(t.service.upload(t.input)).rejects.toThrow('storage unavailable');
    expect(t.send).not.toHaveBeenCalled();
    insert.mockRestore();
    vi.spyOn(t.repository, 'finish').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(t.service.upload(t.input)).rejects.toThrow('storage unavailable');
    expect(
      await new OrderAttachmentService(
        new ExtensionOrderAttachmentRepository(),
        t.binding,
        () => 100_000
      ).upload(t.input)
    ).toMatchObject({ status: 'unknown' });
    expect(t.send).toHaveBeenCalledOnce();
  });
});

describe('independent extension order attachment handler/client', () => {
  it('requires trusted sender and account-verified method before touching settings/storage', async () => {
    const t = await runtime();
    expect(await handleOrderAttachment(t.input, false, t.options)).toMatchObject({
      ok: false,
      error: { code: 'ORDER_ATTACHMENT_UNTRUSTED_SENDER' }
    });
    mocks.accepted = false;
    expect(await handleOrderAttachment(t.input, true, t.options)).toMatchObject({
      ok: false,
      error: { code: 'ORDER_ATTACHMENT_UPLOAD_DISABLED' }
    });
    expect(t.options.loadSettings).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('routes the actual native file method with maxAttempts 1; get never constructs or calls a client', async () => {
    const t = await runtime();
    const create = vi.spyOn(AlibabaClient, 'create');
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
    const response = await handleOrderAttachment(t.input, true, t.options);
    expect(response).toMatchObject({
      requestId: t.input.requestId,
      ok: true,
      data: { status: 'accepted', jobId: t.input.requestId }
    });
    expect(t.options.loadSettings).toHaveBeenCalledWith(
      {
        operation: 'callCapability',
        payload: { method: '/alibaba/order/attachment/upload', parameters: { file_name: file.fileName } }
      },
      t.actual
    );
    expect(create).toHaveBeenCalledWith(t.settings, { maxAttempts: 1, requestId: t.input.requestId });
    mocks.accepted = false;
    const lookup = {
      kind: 'order-attachment-request',
      action: 'get',
      requestId: crypto.randomUUID(),
      jobId: t.input.requestId
    };
    expect(await handleOrderAttachment(lookup, true, t.options)).toMatchObject({
      requestId: lookup.requestId,
      ok: true,
      data: { requestId: t.input.requestId, status: 'accepted' }
    });
    expect(create).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
    const restarted = new ExtensionOrderAttachmentRepository();
    expect(JSON.stringify(await restarted.get(t.input.requestId, 'extension:local-admin'))).not.toContain(
      'fixture-secret'
    );
  });
  it('rejects changed credentials, TOP, invalid file and unrequested order linkage before a claim', async () => {
    const t = await runtime();
    t.options.loadSettings.mockResolvedValueOnce({ ...t.settings, appKey: 'changed' });
    expect(await handleOrderAttachment(t.input, true, t.options)).toMatchObject({
      ok: false,
      error: { code: 'GALLERY_CONTEXT_CHANGED' }
    });
    t.options.loadSettings.mockResolvedValueOnce({ ...t.settings, protocol: 'top' });
    expect(await handleOrderAttachment(t.input, true, t.options)).toMatchObject({
      ok: false,
      error: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }
    });
    expect(
      await handleOrderAttachment({ ...t.input, file: { ...file, byteLength: 999 } }, true, t.options)
    ).toMatchObject({ ok: false, error: { code: 'ORDER_ATTACHMENT_FILE_INVALID' } });
    expect(
      await handleOrderAttachment({ ...t.input, orderId: 'not-requested' }, true, t.options)
    ).toMatchObject({ ok: false, error: { code: 'REQUEST_CONTRACT_INVALID' } });
    expect(
      await new ExtensionOrderAttachmentRepository().get(t.input.requestId, 'extension:local-admin')
    ).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('sends typed upload/get messages and validates request and job correlation', async () => {
    const t = setup();
    const saved = await t.service.upload(t.input);
    mocks.message.mockResolvedValue({ requestId: t.input.requestId, ok: true, data: saved });
    expect(await extensionOrderAttachments.upload(t.input)).toEqual(saved);
    expect(mocks.message).toHaveBeenCalledWith({
      kind: 'order-attachment-request',
      action: 'upload',
      ...t.input
    });
    const lookup = { requestId: crypto.randomUUID(), jobId: saved.jobId };
    mocks.message.mockResolvedValue({ requestId: lookup.requestId, ok: true, data: saved });
    expect(await extensionOrderAttachments.get(lookup)).toEqual(saved);
    mocks.message.mockResolvedValue({
      requestId: lookup.requestId,
      ok: true,
      data: { ...saved, jobId: crypto.randomUUID() }
    });
    await expect(extensionOrderAttachments.get(lookup)).rejects.toThrow('ORDER_ATTACHMENT_RESPONSE_INVALID');
    mocks.message.mockResolvedValue({
      requestId: lookup.requestId,
      ok: false,
      error: { code: 'https://private.invalid/?token=secret' }
    });
    await expect(extensionOrderAttachments.get(lookup)).rejects.toThrow('ORDER_ATTACHMENT_FAILED');
  });
});
