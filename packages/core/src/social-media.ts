import { MAX_PHOTOBANK_IMAGE_BYTES, validateEncodedFile } from './encoded-file';

import type { EncodedFilePayload } from './encoded-file';
import type { SocialPlatform } from './social-meta';

export const SOCIAL_MEDIA_MAX_IMAGE_BYTES = MAX_PHOTOBANK_IMAGE_BYTES;
export const SOCIAL_MEDIA_ASSET_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;
export const SOCIAL_MEDIA_JOB_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
export const INSTAGRAM_MIN_IMAGE_WIDTH = 320;
export const INSTAGRAM_MAX_IMAGE_WIDTH = 1440;
export const INSTAGRAM_MIN_ASPECT_RATIO = 0.8;
export const INSTAGRAM_MAX_ASPECT_RATIO = 1.91;

const FACEBOOK_CONTENT_TYPES = new Set(['image/jpeg', 'image/png']);
const INSTAGRAM_CONTENT_TYPES = new Set(['image/jpeg']);

export interface SocialImageMetadata {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

export function validateSocialImagePayload(
  payload: EncodedFilePayload,
  platform: SocialPlatform
): SocialImageMetadata {
  const bytes = validateEncodedFile(payload, {
    allowedContentTypes: platform === 'instagram' ? INSTAGRAM_CONTENT_TYPES : FACEBOOK_CONTENT_TYPES,
    maxBytes: SOCIAL_MEDIA_MAX_IMAGE_BYTES,
    requireImageSignature: true
  });
  const dimensions = readImageDimensions(bytes, payload.contentType);
  if (!dimensions) throw new Error('无法读取图片尺寸');
  if (platform === 'instagram') {
    if (dimensions.width < INSTAGRAM_MIN_IMAGE_WIDTH || dimensions.width > INSTAGRAM_MAX_IMAGE_WIDTH) {
      throw new Error(
        `Instagram 图片宽度需在 ${INSTAGRAM_MIN_IMAGE_WIDTH}–${INSTAGRAM_MAX_IMAGE_WIDTH} 像素之间`
      );
    }
    const aspectRatio = dimensions.width / dimensions.height;
    if (aspectRatio < INSTAGRAM_MIN_ASPECT_RATIO || aspectRatio > INSTAGRAM_MAX_ASPECT_RATIO) {
      throw new Error('Instagram 图片宽高比需在 4:5 至 1.91:1 之间');
    }
  }
  return {
    bytes,
    contentType: payload.contentType as 'image/jpeg' | 'image/png',
    width: dimensions.width,
    height: dimensions.height
  };
}

export function readImageDimensions(
  bytes: Uint8Array,
  contentType: string
): { width: number; height: number } | null {
  if (contentType === 'image/png') return readPngDimensions(bytes);
  if (contentType === 'image/jpeg') return readJpegDimensions(bytes);
  return null;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.byteLength) return null;
    const segmentLength = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    if (isStartOfFrame(marker) && segmentLength >= 7) {
      const height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0);
      const width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}
