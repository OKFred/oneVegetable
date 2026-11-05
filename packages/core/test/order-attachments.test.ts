import { describe, expect, it, vi } from 'vitest';
import {
  OrderAttachmentService,
  parseOrderAttachmentRecord,
  isOrderAttachmentReceipt,
  type OrderAttachmentBinding,
  type OrderAttachmentRecord,
  type OrderAttachmentRepository
} from '../src/order-attachments';

const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), storage: null };
const file = {
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  byteLength: 9,
  contentBase64: btoa('%PDF-1.7\n')
};
class MemoryRepository implements OrderAttachmentRepository {
  records = new Map<string, OrderAttachmentRecord>();
  get(id: string, owner: string) {
    const r = this.records.get(id);
    return Promise.resolve(r?.ownerId === owner ? structuredClone(r) : null);
  }
  insert(r: OrderAttachmentRecord) {
    if (
      this.records.has(r.receipt.jobId) ||
      [...this.records.values()].some(
        (old) =>
          old.ownerId === r.ownerId &&
          old.context.gateway === r.context.gateway &&
          old.receipt.sha256 === r.receipt.sha256 &&
          ['sending', 'unknown'].includes(old.receipt.status)
      )
    )
      return Promise.resolve(false);
    this.records.set(r.receipt.jobId, parseOrderAttachmentRecord(r));
    return Promise.resolve(true);
  }
  finish(r: OrderAttachmentRecord) {
    this.records.set(r.receipt.jobId, parseOrderAttachmentRecord(r));
    return Promise.resolve();
  }
}
function setup(overrides: Partial<OrderAttachmentBinding> = {}) {
  const repository = new MemoryRepository();
  const send = vi
    .fn<OrderAttachmentBinding['send']>()
    .mockResolvedValue({ reference: 'opaque_attachment_42', traceId: 'trace-42' });
  const binding: OrderAttachmentBinding = {
    ownerId: 'admin',
    context,
    protocol: 'iop',
    enabled: true,
    send,
    ...overrides
  };
  const service = new OrderAttachmentService(repository, binding, () => 100);
  const input = { requestId: crypto.randomUUID(), file, context };
  return { repository, send, binding, service, input };
}

describe('independent order attachment service', () => {
  it('durably claims before sending and stores only an allowlisted receipt', async () => {
    const t = setup();
    t.send.mockImplementation(async (sent, id) => {
      expect(await t.repository.get(id, 'admin')).toMatchObject({
        receipt: { status: 'sending', platformReference: null }
      });
      expect(sent).toEqual(file);
      return { reference: 'opaque_attachment_42', traceId: 'trace-42' };
    });
    const receipt = await t.service.upload(t.input);
    expect(receipt).toMatchObject({
      jobId: t.input.requestId,
      requestId: t.input.requestId,
      status: 'accepted',
      size: 9,
      protocol: 'iop',
      platformReference: 'opaque_attachment_42',
      traceId: 'trace-42'
    });
    expect(isOrderAttachmentReceipt(receipt)).toBe(true);
    const json = JSON.stringify([...t.repository.records.values()]);
    expect(json).not.toContain('contentBase64');
    expect(json).not.toContain(file.contentBase64);
    expect(json).not.toContain('accessToken');
    expect(await t.service.upload(t.input)).toEqual(receipt);
    expect(t.send).toHaveBeenCalledOnce();
    expect(await t.service.upload({ ...t.input, requestId: crypto.randomUUID() })).toMatchObject({
      status: 'accepted'
    });
    expect(t.send).toHaveBeenCalledTimes(2);
  });
  it('rejects another fingerprint under the same request ID', async () => {
    const t = setup();
    await t.service.upload(t.input);
    await expect(t.service.upload({ ...t.input, file: { ...file, fileName: 'other.pdf' } })).rejects.toThrow(
      'ORDER_ATTACHMENT_REQUEST_CONFLICT'
    );
    await expect(
      t.service.upload({ ...t.input, file: { ...file, byteLength: 10, contentBase64: btoa('%PDF-1.7\nx') } })
    ).rejects.toThrow('ORDER_ATTACHMENT_REQUEST_CONFLICT');
    expect(t.send).toHaveBeenCalledOnce();
  });
  it('freezes request identity and file bytes while persistence is pending', async () => {
    const t = setup();
    const requestId = t.input.requestId;
    const input = { ...t.input, file: { ...file } };
    const get = vi.spyOn(t.repository, 'get');
    get.mockImplementationOnce(() => {
      input.requestId = crypto.randomUUID();
      input.file.fileName = 'changed.pdf';
      input.file.contentBase64 = btoa('not-a-pdf');
      return Promise.resolve(null);
    });
    expect(await t.service.upload(input)).toMatchObject({ jobId: requestId, fileName: file.fileName });
    expect(t.send).toHaveBeenCalledWith(file, requestId);
  });
  it('does not resend an explicitly failed receipt under its original request ID', async () => {
    const t = setup();
    await t.service.upload(t.input);
    const record = t.repository.records.get(t.input.requestId);
    if (!record) throw new Error('fixture record missing');
    record.receipt.status = 'failed';
    record.receipt.platformReference = null;
    record.receipt.errorCode = 'ORDER_ATTACHMENT_REJECTED';
    expect(await t.service.upload(t.input)).toMatchObject({ status: 'failed' });
    expect(t.send).toHaveBeenCalledOnce();
  });
  it('never retries unknown, even under a different request ID', async () => {
    const t = setup();
    t.send.mockRejectedValue(new Error('https://private.invalid/file?signature=secret'));
    const receipt = await t.service.upload(t.input);
    expect(receipt).toMatchObject({ status: 'unknown', errorCode: 'ORDER_ATTACHMENT_RESULT_UNKNOWN' });
    expect(await t.service.upload(t.input)).toEqual(receipt);
    await expect(t.service.upload({ ...t.input, requestId: crypto.randomUUID() })).rejects.toThrow(
      'ORDER_ATTACHMENT_UPLOAD_PENDING'
    );
    expect(await t.service.get({ requestId: crypto.randomUUID(), jobId: receipt.jobId })).toEqual(receipt);
    expect(t.send).toHaveBeenCalledOnce();
    expect(JSON.stringify([...t.repository.records.values()])).not.toContain('private.invalid');
  });
  it('atomically handles same-ID and different-ID concurrent claims', async () => {
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
    const other = new OrderAttachmentService(t.repository, t.binding, () => 100);
    expect(await other.upload(t.input)).toMatchObject({ status: 'sending' });
    await expect(other.upload({ ...t.input, requestId: crypto.randomUUID() })).rejects.toThrow(
      'ORDER_ATTACHMENT_UPLOAD_PENDING'
    );
    release({ reference: 'opaque_attachment_42' });
    expect(await first).toMatchObject({ status: 'accepted' });
    expect(t.send).toHaveBeenCalledOnce();
  });
  it('blocks changed identity/gateway/storage and hides other owners', async () => {
    const t = setup();
    await t.service.upload(t.input);
    for (const changed of [
      { ...context, identity: 'c'.repeat(64) },
      { ...context, gateway: 'c'.repeat(64) },
      { ...context, storage: 'c'.repeat(64) }
    ]) {
      const service = new OrderAttachmentService(t.repository, { ...t.binding, context: changed });
      await expect(service.get({ requestId: crypto.randomUUID(), jobId: t.input.requestId })).rejects.toThrow(
        'GALLERY_CONTEXT_CHANGED'
      );
      await expect(service.upload(t.input)).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    }
    const other = new OrderAttachmentService(t.repository, { ...t.binding, ownerId: 'other-admin' });
    await expect(other.get({ requestId: crypto.randomUUID(), jobId: t.input.requestId })).rejects.toThrow(
      'ORDER_ATTACHMENT_NOT_FOUND'
    );
    await expect(other.upload(t.input)).rejects.toThrow('ORDER_ATTACHMENT_UPLOAD_PENDING');
    expect(t.send).toHaveBeenCalledOnce();
  });
  it.each([{ enabled: false }, { protocol: 'top' as const }])(
    'performs runtime preflight before claiming: %o',
    async (override) => {
      const t = setup(override);
      await expect(t.service.upload(t.input)).rejects.toThrow();
      expect(t.repository.records.size).toBe(0);
      expect(t.send).not.toHaveBeenCalled();
    }
  );
  it('validates file signature, size and request ID before claiming', async () => {
    const t = setup();
    for (const bad of [
      { ...file, byteLength: 10 },
      { ...file, fileName: '../invoice.pdf' },
      { ...file, contentBase64: btoa('not-a-pdf') },
      { ...file, byteLength: 5_000_001 }
    ]) {
      await expect(t.service.upload({ ...t.input, file: bad })).rejects.toThrow(
        'ORDER_ATTACHMENT_FILE_INVALID'
      );
    }
    await expect(t.service.upload({ ...t.input, requestId: 'not-a-uuid' })).rejects.toThrow(
      'REQUEST_CONTRACT_INVALID'
    );
    expect(t.repository.records.size).toBe(0);
    expect(t.send).not.toHaveBeenCalled();
  });
  it('never sends if the initial persistence fails', async () => {
    const t = setup();
    vi.spyOn(t.repository, 'insert').mockRejectedValue(new Error('disk unavailable'));
    await expect(t.service.upload(t.input)).rejects.toThrow('disk unavailable');
    expect(t.send).not.toHaveBeenCalled();
  });
  it('keeps the sending claim after final persistence fails, including across restart', async () => {
    const t = setup();
    vi.spyOn(t.repository, 'finish').mockRejectedValue(new Error('disk unavailable'));
    await expect(t.service.upload(t.input)).rejects.toThrow('disk unavailable');
    const restarted = new OrderAttachmentService(t.repository, t.binding, () => 100_000);
    expect(await restarted.upload(t.input)).toMatchObject({ status: 'unknown' });
    expect(await t.repository.get(t.input.requestId, 'admin')).toMatchObject({
      receipt: { status: 'sending' }
    });
    await expect(restarted.upload({ ...t.input, requestId: crypto.randomUUID() })).rejects.toThrow(
      'ORDER_ATTACHMENT_UPLOAD_PENDING'
    );
    expect(t.send).toHaveBeenCalledOnce();
  });
  it('does not persist a signed URL returned as a reference', async () => {
    const t = setup();
    t.send.mockResolvedValue({ reference: 'https://private.invalid/file?signature=secret' });
    expect(await t.service.upload(t.input)).toMatchObject({ status: 'unknown', platformReference: null });
    expect(JSON.stringify([...t.repository.records.values()])).not.toContain('private.invalid');
  });
  it.each(['trace.with.dot', 'trace:colon', 'a'.repeat(161)])(
    'rejects trace IDs outside the native/transport contract: %s',
    async (traceId) => {
      const t = setup();
      t.send.mockResolvedValue({ reference: '/attachments/opaque.pdf', traceId });
      const receipt = await t.service.upload(t.input);
      expect(receipt).toMatchObject({ status: 'unknown', traceId: null });
      expect(isOrderAttachmentReceipt(receipt)).toBe(true);
    }
  );
  it('rejects extra persisted fields and treats malformed provider success as unknown', async () => {
    const t = setup();
    t.send.mockResolvedValue({ reference: '' });
    expect(await t.service.upload(t.input)).toMatchObject({ status: 'unknown' });
    const record = [...t.repository.records.values()][0];
    if (!record) throw new Error('fixture record missing');
    expect(() => parseOrderAttachmentRecord({ ...record, contentBase64: 'secret' })).toThrow(
      'ORDER_ATTACHMENT_RECORD_CORRUPT'
    );
    expect(() =>
      parseOrderAttachmentRecord({ ...record, receipt: { ...record.receipt, response: {} } })
    ).toThrow('ORDER_ATTACHMENT_RECORD_CORRUPT');
  });
});
