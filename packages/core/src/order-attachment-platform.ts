import type { AlibabaClient } from './alibaba-client';
import {
  detectPhotoContentType,
  encodeBase64,
  validateEncodedFile,
  type EncodedFilePayload
} from './encoded-file';
import { GatewayException } from './errors';
import { ORDER_ATTACHMENT_METHOD } from './order-fulfillment-methods';

export const ORDER_ATTACHMENT_LIMIT = 5_000_000;
const types = new Set(['image/jpeg', 'image/png', 'application/pdf', 'application/msword']);
const extensions: Readonly<Record<string, RegExp>> = {
  'image/jpeg': /\.jpe?g$/iu,
  'image/png': /\.png$/iu,
  'application/pdf': /\.pdf$/iu,
  'application/msword': /\.doc$/iu
};
function invalid(code = 'ORDER_ATTACHMENT_FILE_INVALID'): never {
  throw new GatewayException({ code, message: code, retryable: false });
}

/** The IOP file type, extension and actual header must agree; never rename another type to JPG. */
export function validateOrderAttachmentFile(file: EncodedFilePayload): Uint8Array {
  try {
    if (
      typeof file.fileName !== 'string' ||
      typeof file.contentType !== 'string' ||
      typeof file.contentBase64 !== 'string' ||
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 1 ||
      file.contentBase64.length > 4 * Math.ceil(ORDER_ATTACHMENT_LIMIT / 3) ||
      file.fileName.trim() !== file.fileName ||
      /\p{Cc}/u.test(file.fileName)
    )
      return invalid();
    const bytes = validateEncodedFile(file, { allowedContentTypes: types, maxBytes: ORDER_ATTACHMENT_LIMIT });
    if (!extensions[file.contentType]?.test(file.fileName)) return invalid();
    const signature =
      file.contentType === 'application/pdf'
        ? [0x25, 0x50, 0x44, 0x46, 0x2d]
        : file.contentType === 'application/msword'
          ? [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
          : null;
    if (
      signature
        ? !signature.every((byte, index) => bytes[index] === byte)
        : detectPhotoContentType(bytes) !== file.contentType
    )
      return invalid();
    return bytes;
  } catch {
    return invalid();
  }
}

export type OrderAttachmentPlatformClient = Pick<AlibabaClient, 'callWithFile'>;

export function createOrderAttachmentFile(fileName: string, bytes: Uint8Array): EncodedFilePayload {
  const contentType = Object.entries(extensions).find(([, extension]) => extension.test(fileName))?.[0];
  if (!contentType || bytes.byteLength > ORDER_ATTACHMENT_LIMIT) return invalid();
  const file = { fileName, contentType, byteLength: bytes.byteLength, contentBase64: encodeBase64(bytes) };
  validateOrderAttachmentFile(file);
  return file;
}

/** The documented return is a filepath, not proof of order association or file readback. */
export async function uploadOrderAttachmentPlatform(
  client: OrderAttachmentPlatformClient,
  file: EncodedFilePayload
): Promise<{ reference: string; traceId?: string }> {
  const bytes = validateOrderAttachmentFile(file);
  const response = await client.callWithFile(
    ORDER_ATTACHMENT_METHOD,
    { file_name: file.fileName },
    {
      fieldName: 'data',
      fileName: file.fileName,
      contentType: file.contentType,
      bytes
    }
  );
  const value = response.data;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('ORDER_ATTACHMENT_RESPONSE_INVALID');
  const result = value as Record<string, unknown>;
  if (result.code !== 0 && result.code !== '0') return invalid('ORDER_ATTACHMENT_RESPONSE_INVALID');
  const reference = result.value;
  if (
    typeof reference !== 'string' ||
    !/^[A-Za-z0-9_./:@-]{1,2048}$/u.test(reference) ||
    reference.includes('://') ||
    reference.startsWith('//') ||
    /(?:^|\/)\.\.(?:\/|$)/u.test(reference)
  )
    return invalid('ORDER_ATTACHMENT_RESPONSE_INVALID');
  const traceId = result.request_id;
  return {
    reference,
    ...(typeof traceId === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(traceId) ? { traceId } : {})
  };
}
