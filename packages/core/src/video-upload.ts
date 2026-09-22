import type { components } from './generated/api';
import type { GalleryTransferContext } from './gallery-transfer-task';
import {
  validateVideoUploadFile,
  validateVideoUploadRequest,
  validateVideoUploadResult,
  validateVideoUploadTask
} from './generated/validators-video-upload';
import { sha256 } from '@noble/hashes/sha2.js';

export type VideoUploadFile = components['schemas']['VideoUploadFile'];
export type VideoUploadTask = components['schemas']['VideoUploadTask'];
export type VideoUploadCommand = components['schemas']['VideoUploadCommand'];
export type VideoUploadRequest = components['schemas']['VideoUploadRequest'];
export type VideoUploadResult = components['schemas']['VideoUploadResult'];
export { validateVideoUploadRequest, validateVideoUploadResult, validateVideoUploadTask };
export const VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_UPLOAD_PART_BYTES = 5 * 1024 * 1024;
export const VIDEO_UPLOAD_VERIFY_WINDOW_MS = 5 * 60_000;

export interface VideoUploadControl {
  videoUpload(
    command: VideoUploadCommand,
    context: GalleryTransferContext,
    requestId?: string
  ): Promise<VideoUploadResult>;
}

export class VideoUploadError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function videoUploadFail(code: string): never {
  throw new VideoUploadError(code);
}

/** ISO BMFF MP4 brands only. MOV/AVIF files sharing ftyp are not accepted as MP4. */
export function assertMp4Header(bytes: Uint8Array): void {
  const ascii = (from: number, to: number) => new TextDecoder().decode(bytes.subarray(from, to));
  const boxSize =
    bytes.byteLength >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) : 0;
  if (
    bytes.byteLength < 12 ||
    ascii(4, 8) !== 'ftyp' ||
    boxSize < 16 ||
    boxSize > bytes.byteLength ||
    ![
      'isom',
      'iso2',
      'iso3',
      'iso4',
      'iso5',
      'iso6',
      'mp41',
      'mp42',
      'avc1',
      'M4V ',
      'MSNV',
      'dash'
    ].includes(ascii(8, 12))
  )
    videoUploadFail('VIDEO_FILE_INVALID');
}

/** File bytes stay in the page; only one bounded part ever crosses a trusted request. */
export async function fingerprintVideoFile(file: Blob & { name: string }): Promise<VideoUploadFile> {
  if (
    file.type !== 'video/mp4' ||
    file.size > VIDEO_UPLOAD_MAX_BYTES ||
    file.size < 16 ||
    /[\\/\0]/u.test(file.name)
  )
    videoUploadFail('VIDEO_FILE_INVALID');
  assertMp4Header(new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer()));
  const hash = sha256.create();
  for (let start = 0; start < file.size; start += VIDEO_UPLOAD_PART_BYTES)
    hash.update(new Uint8Array(await file.slice(start, start + VIDEO_UPLOAD_PART_BYTES).arrayBuffer()));
  const result = { fileName: file.name, byteLength: file.size, sha256: hex(hash.digest()) };
  if (!validateVideoUploadFile(result)) videoUploadFail('VIDEO_FILE_INVALID');
  return result;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function hashVideoBytes(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}

/** Manual resume must reselect and verify the whole file first; this helper does not start scheduling. */
export async function verifyReselectedVideo(
  file: Blob & { name: string },
  task: VideoUploadTask
): Promise<VideoUploadFile> {
  const fingerprint = await fingerprintVideoFile(file);
  if (fingerprint.byteLength !== task.file?.byteLength || fingerprint.sha256 !== task.file.sha256)
    videoUploadFail('VIDEO_FILE_CHANGED');
  return fingerprint;
}
