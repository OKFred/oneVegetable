import { sha256 } from '@noble/hashes/sha2.js';
import type { EncodedFilePayload } from './encoded-file';
import { isRequestId } from './network';
import {
  sameGalleryTransferContext,
  validGalleryTransferContext,
  type GalleryTransferContext
} from './gallery-transfer-task';
import { ORDER_ATTACHMENT_LIMIT, validateOrderAttachmentFile } from './order-attachment-platform';
import { ORDER_ATTACHMENT_METHOD } from './order-fulfillment-methods';
import {
  validateOrderAttachmentUploadRequest,
  validateOrderAttachmentGetRequest
} from './generated/validators-order-attachments';
import {
  isOrderAttachmentReceipt,
  recordObject,
  safeText,
  safeId,
  opaqueReference,
  hashText,
  keys
} from './order-attachment-receipt';
export { isOrderAttachmentReceipt } from './order-attachment-receipt';
export { ORDER_ATTACHMENT_METHOD } from './order-fulfillment-methods';

export const ORDER_ATTACHMENT_MAX_BYTES = ORDER_ATTACHMENT_LIMIT;
const SENDING_WINDOW_MS = 90_000;
export interface OrderAttachmentReceipt {
  jobId: string;
  status: 'sending' | 'accepted' | 'failed' | 'unknown';
  fileName: string;
  sha256: string;
  size: number;
  createdTimeUtc: number;
  updatedTimeUtc: number;
  gatewayId: string;
  protocol: 'iop';
  platformReference: string | null;
  errorCode: string | null;
  requestId: string;
  traceId: string | null;
}
export interface OrderAttachmentControl {
  upload(input: {
    requestId: string;
    file: EncodedFilePayload;
    context: GalleryTransferContext;
  }): Promise<OrderAttachmentReceipt>;
  get(input: { requestId: string; jobId: string }): Promise<OrderAttachmentReceipt>;
}
export type OrderAttachmentRequest =
  | ({ action: 'upload' } & Parameters<OrderAttachmentControl['upload']>[0])
  | ({ action: 'get' } & Parameters<OrderAttachmentControl['get']>[0]);
export function parseOrderAttachmentRequest(v: unknown): OrderAttachmentRequest {
  if (!recordObject(v) || !isRequestId(v.requestId)) return orderAttachmentFail('REQUEST_CONTRACT_INVALID');
  const { action, ...transport } = v;
  if (action === 'get' && validateOrderAttachmentGetRequest(transport) && isRequestId(v.jobId))
    return { action: 'get', requestId: v.requestId, jobId: v.jobId };
  if (
    action === 'upload' &&
    validateOrderAttachmentUploadRequest(transport) &&
    validGalleryTransferContext(v.context) &&
    recordObject(v.file) &&
    keys(v.file, ['fileName', 'contentType', 'byteLength', 'contentBase64']) &&
    typeof v.file.fileName === 'string' &&
    typeof v.file.contentType === 'string' &&
    typeof v.file.contentBase64 === 'string' &&
    typeof v.file.byteLength === 'number'
  )
    return {
      action: 'upload',
      requestId: v.requestId,
      context: v.context,
      file: {
        fileName: v.file.fileName,
        contentType: v.file.contentType,
        byteLength: v.file.byteLength,
        contentBase64: v.file.contentBase64
      }
    };
  return orderAttachmentFail('REQUEST_CONTRACT_INVALID');
}
export interface OrderAttachmentRecord {
  ownerId: string;
  context: GalleryTransferContext;
  fingerprint: string;
  receipt: OrderAttachmentReceipt;
}
export interface OrderAttachmentRepository {
  get(jobId: string, ownerId: string): Promise<OrderAttachmentRecord | null>;
  /** Atomic job-ID and pending owner/gateway/SHA claim. False means an existing claim won. */
  insert(record: OrderAttachmentRecord): Promise<boolean>;
  /** Only the original sending record may transition to a final receipt. */
  finish(record: OrderAttachmentRecord): Promise<void>;
}
export interface OrderAttachmentBinding {
  ownerId: string;
  context: GalleryTransferContext;
  protocol: 'top' | 'iop';
  enabled: boolean;
  /** Context-fixed native client, maxAttempts: 1; never a generic operation callback. */
  send(file: EncodedFilePayload, requestId: string): Promise<{ reference: string; traceId?: string }>;
}
export class OrderAttachmentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function orderAttachmentFail(code: string): never {
  throw new OrderAttachmentError(code);
}
export function orderAttachmentSelection(fileName: string) {
  return {
    operation: 'callCapability' as const,
    payload: { method: ORDER_ATTACHMENT_METHOD, parameters: { file_name: fileName } }
  };
}

/** No queue, automatic retry, order association, or file-body persistence. */
export class OrderAttachmentService implements OrderAttachmentControl {
  private readonly binding: OrderAttachmentBinding;
  constructor(
    private readonly repository: OrderAttachmentRepository,
    binding: OrderAttachmentBinding,
    private readonly now: () => number = Date.now
  ) {
    this.binding = { ...binding, context: structuredClone(binding.context) };
    if (!binding.ownerId || !validGalleryTransferContext(binding.context))
      orderAttachmentFail('ORDER_ATTACHMENT_CONTEXT_INVALID');
  }
  async upload(input: Parameters<OrderAttachmentControl['upload']>[0]): Promise<OrderAttachmentReceipt> {
    if (!recordObject(input) || !isRequestId(input.requestId) || !validGalleryTransferContext(input.context))
      orderAttachmentFail('REQUEST_CONTRACT_INVALID');
    const requestId = input.requestId;
    this.assertContext(input.context);
    const raw = input.file;
    if (
      !recordObject(raw) ||
      typeof raw.fileName !== 'string' ||
      typeof raw.contentType !== 'string' ||
      typeof raw.contentBase64 !== 'string' ||
      !Number.isSafeInteger(raw.byteLength) ||
      raw.byteLength <= 0 ||
      raw.byteLength > ORDER_ATTACHMENT_MAX_BYTES ||
      raw.contentBase64.length > Math.ceil(ORDER_ATTACHMENT_MAX_BYTES / 3) * 4 ||
      /\p{Cc}/u.test(raw.fileName)
    )
      orderAttachmentFail('ORDER_ATTACHMENT_FILE_INVALID');
    // Copy only the contract: caller mutations and extra properties cannot reach storage/send.
    const file: EncodedFilePayload = {
      fileName: raw.fileName,
      contentType: raw.contentType,
      byteLength: raw.byteLength,
      contentBase64: raw.contentBase64
    };
    let bytes: Uint8Array;
    try {
      bytes = validateOrderAttachmentFile(file);
    } catch {
      return orderAttachmentFail('ORDER_ATTACHMENT_FILE_INVALID');
    }
    if (
      !bytes.byteLength ||
      bytes.byteLength !== file.byteLength ||
      bytes.byteLength > ORDER_ATTACHMENT_MAX_BYTES
    )
      orderAttachmentFail('ORDER_ATTACHMENT_FILE_INVALID');
    const hash = digest(bytes);
    const fingerprint = digest(
      new TextEncoder().encode(JSON.stringify([file.fileName, file.contentType, bytes.byteLength, hash]))
    );
    const prior = await this.repository.get(requestId, this.binding.ownerId);
    if (prior) return this.existing(prior, fingerprint);
    if (this.binding.protocol !== 'iop') orderAttachmentFail('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
    if (!this.binding.enabled) orderAttachmentFail('ORDER_ATTACHMENT_UPLOAD_DISABLED');
    const time = this.now();
    const record: OrderAttachmentRecord = {
      ownerId: this.binding.ownerId,
      context: structuredClone(this.binding.context),
      fingerprint,
      receipt: {
        jobId: requestId,
        requestId,
        status: 'sending',
        fileName: file.fileName,
        sha256: hash,
        size: bytes.byteLength,
        createdTimeUtc: time,
        updatedTimeUtc: time,
        gatewayId: this.binding.context.gateway,
        protocol: 'iop',
        platformReference: null,
        errorCode: null,
        traceId: null
      }
    };
    // The durable unique claim MUST finish before the provider can see the write.
    if (!(await this.repository.insert(record))) {
      const winner = await this.repository.get(requestId, this.binding.ownerId);
      if (!winner) orderAttachmentFail('ORDER_ATTACHMENT_UPLOAD_PENDING');
      return this.existing(winner, fingerprint);
    }
    try {
      const result = await this.binding.send(file, requestId);
      if (!opaqueReference(result.reference) || (result.traceId !== undefined && !safeId(result.traceId)))
        orderAttachmentFail('ORDER_ATTACHMENT_RESULT_INVALID');
      record.receipt.status = 'accepted';
      // A URL may contain credentials/signatures. Only safe opaque references belong in receipts.
      record.receipt.platformReference = result.reference;
      record.receipt.traceId = result.traceId ?? null;
    } catch {
      // Provider exceptions may echo credentials/signed URLs; never copy their text or response.
      record.receipt.status = 'unknown';
      record.receipt.errorCode = 'ORDER_ATTACHMENT_RESULT_UNKNOWN';
    }
    record.receipt.updatedTimeUtc = Math.max(time, this.now());
    // Failure leaves the original sending claim intact, blocking every subsequent send.
    await this.repository.finish(record);
    return structuredClone(record.receipt);
  }
  async get(input: Parameters<OrderAttachmentControl['get']>[0]): Promise<OrderAttachmentReceipt> {
    if (!recordObject(input) || !isRequestId(input.requestId) || !isRequestId(input.jobId))
      orderAttachmentFail('REQUEST_CONTRACT_INVALID');
    const record = await this.repository.get(input.jobId, this.binding.ownerId);
    if (!record) orderAttachmentFail('ORDER_ATTACHMENT_NOT_FOUND');
    this.assertContext(record.context);
    return this.receipt(record);
  }
  private assertContext(context: GalleryTransferContext): void {
    if (!sameGalleryTransferContext(context, this.binding.context))
      orderAttachmentFail('GALLERY_CONTEXT_CHANGED');
  }
  private existing(record: OrderAttachmentRecord, fingerprint: string): OrderAttachmentReceipt {
    this.assertContext(record.context);
    if (record.fingerprint !== fingerprint) orderAttachmentFail('ORDER_ATTACHMENT_REQUEST_CONFLICT');
    // failed is terminal too; a new upload requires a deliberately new request ID.
    return this.receipt(record);
  }
  private receipt(record: OrderAttachmentRecord): OrderAttachmentReceipt {
    const receipt = structuredClone(record.receipt);
    // Read-only recovery: preserve the durable claim and never race a late final receipt.
    if (receipt.status === 'sending' && this.now() - receipt.updatedTimeUtc >= SENDING_WINDOW_MS) {
      receipt.status = 'unknown';
      receipt.errorCode = 'ORDER_ATTACHMENT_RESULT_UNKNOWN';
    }
    return receipt;
  }
}

function digest(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Strict allowlist prevents accidental persistence of bytes, credentials or response envelopes. */
export function parseOrderAttachmentRecord(v: unknown): OrderAttachmentRecord {
  if (
    !recordObject(v) ||
    !keys(v, ['ownerId', 'context', 'fingerprint', 'receipt']) ||
    !safeText(v.ownerId, 256) ||
    !v.ownerId ||
    !validGalleryTransferContext(v.context) ||
    !hashText(v.fingerprint) ||
    !isOrderAttachmentReceipt(v.receipt) ||
    v.receipt.gatewayId !== v.context.gateway
  )
    return orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
  return {
    ownerId: v.ownerId,
    context: structuredClone(v.context),
    fingerprint: v.fingerprint,
    receipt: structuredClone(v.receipt)
  };
}
