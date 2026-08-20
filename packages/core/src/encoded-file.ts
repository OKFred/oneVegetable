import type { components } from './generated/api';

export type EncodedFilePayload = components['schemas']['EncodedFilePayload'];

export const MAX_ENCODED_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTOBANK_IMAGE_BYTES = 5 * 1024 * 1024;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const IMAGE_SIGNATURES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) =>
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a,
  'image/gif': (bytes) =>
    bytesToAscii(bytes.subarray(0, 6)) === 'GIF87a' || bytesToAscii(bytes.subarray(0, 6)) === 'GIF89a',
  'image/webp': (bytes) =>
    bytesToAscii(bytes.subarray(0, 4)) === 'RIFF' && bytesToAscii(bytes.subarray(8, 12)) === 'WEBP',
  'image/bmp': (bytes) => bytes[0] === 0x42 && bytes[1] === 0x4d,
  'image/avif': (bytes) =>
    bytesToAscii(bytes.subarray(4, 8)) === 'ftyp' &&
    ['avif', 'avis'].includes(bytesToAscii(bytes.subarray(8, 12)))
};

export interface EncodedFileValidationOptions {
  allowedContentTypes?: ReadonlySet<string>;
  maxBytes?: number;
  requireImageSignature?: boolean;
}

export function validateEncodedFile(
  payload: EncodedFilePayload,
  options: EncodedFileValidationOptions = {}
): Uint8Array {
  const fileName = payload.fileName.trim();
  if (!fileName || fileName.length > 255 || /[\0\\/]/.test(fileName)) {
    throw new Error('文件名无效');
  }
  if (payload.contentBase64.startsWith('data:') || !BASE64_PATTERN.test(payload.contentBase64)) {
    throw new Error('contentBase64 必须是纯 Base64 内容');
  }
  const contentType = payload.contentType.trim().toLocaleLowerCase();
  if (!contentType || contentType.length > 127) throw new Error('Content-Type 无效');
  if (options.allowedContentTypes?.has(contentType) === false) {
    throw new Error(`不支持的文件类型：${contentType}`);
  }

  const bytes = base64ToBytes(payload.contentBase64);
  const maxBytes = Math.min(options.maxBytes ?? MAX_ENCODED_FILE_BYTES, MAX_ENCODED_FILE_BYTES);
  if (bytes.byteLength > maxBytes) throw new Error(`文件超过 ${formatBytes(maxBytes)} 上限`);
  if (payload.byteLength !== bytes.byteLength) throw new Error('byteLength 与文件实际大小不一致');

  if (options.requireImageSignature) {
    const matches = IMAGE_SIGNATURES[contentType];
    if (!matches?.(bytes)) throw new Error('图片文件头与 Content-Type 不一致');
  }
  return bytes;
}

export const PHOTO_CONTENT_TYPES = new Set(Object.keys(IMAGE_SIGNATURES));

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = globalThis.atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('contentBase64 不是有效 Base64');
  }
}

function bytesToAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function formatBytes(bytes: number): string {
  return `${Math.floor(bytes / 1024 / 1024)} MiB`;
}
