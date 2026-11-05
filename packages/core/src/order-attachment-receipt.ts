import { isRequestId } from './network';
import { validateOrderAttachmentReceipt } from './generated/validators-order-attachment-receipt';
import { ORDER_ATTACHMENT_LIMIT } from './order-attachment-platform';
import type { OrderAttachmentReceipt } from './order-attachments';

export const recordObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const safeText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && !/\p{Cc}/u.test(v);
export const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(v);
export const opaqueReference = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9_./:@-]{1,2048}$/u.test(v) &&
  !v.includes('://') &&
  !v.startsWith('//') &&
  !/(?:^|\/)\.\.(?:\/|$)/u.test(v);
export const hashText = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
export const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length && expected.every((key) => Object.hasOwn(v, key));
export function isOrderAttachmentReceipt(v: unknown): v is OrderAttachmentReceipt {
  return (
    validateOrderAttachmentReceipt(v) &&
    recordObject(v) &&
    keys(v, [
      'jobId',
      'status',
      'fileName',
      'sha256',
      'size',
      'createdTimeUtc',
      'updatedTimeUtc',
      'gatewayId',
      'protocol',
      'platformReference',
      'errorCode',
      'requestId',
      'traceId'
    ]) &&
    isRequestId(v.jobId) &&
    v.requestId === v.jobId &&
    typeof v.status === 'string' &&
    ['sending', 'accepted', 'failed', 'unknown'].includes(v.status) &&
    safeText(v.fileName, 255) &&
    v.fileName.length > 0 &&
    !/[\\/]/u.test(v.fileName) &&
    hashText(v.sha256) &&
    typeof v.size === 'number' &&
    Number.isSafeInteger(v.size) &&
    v.size > 0 &&
    v.size <= ORDER_ATTACHMENT_LIMIT &&
    typeof v.createdTimeUtc === 'number' &&
    Number.isSafeInteger(v.createdTimeUtc) &&
    v.createdTimeUtc >= 0 &&
    typeof v.updatedTimeUtc === 'number' &&
    Number.isSafeInteger(v.updatedTimeUtc) &&
    v.updatedTimeUtc >= v.createdTimeUtc &&
    safeText(v.gatewayId, 128) &&
    v.gatewayId.length > 0 &&
    v.protocol === 'iop' &&
    (v.platformReference === null || opaqueReference(v.platformReference)) &&
    (v.errorCode === null ||
      (typeof v.errorCode === 'string' &&
        ['ORDER_ATTACHMENT_RESULT_UNKNOWN', 'ORDER_ATTACHMENT_REJECTED'].includes(v.errorCode))) &&
    (v.traceId === null || safeId(v.traceId)) &&
    (v.status === 'accepted' ? v.errorCode === null : v.platformReference === null)
  );
}
