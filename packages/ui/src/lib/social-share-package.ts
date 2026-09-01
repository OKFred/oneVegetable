import { strToU8, zip, type AsyncZippable } from 'fflate';

import {
  decodeBase64,
  photoFileExtension,
  SOCIAL_SHARE_MAX_TOTAL_BYTES,
  validatePhotoBytes,
  validateSocialShareSelection,
  type GatewayClient,
  type Photo
} from '@one-vegetable/core';

import { translateUi } from '../i18n';
import { readAppPreferences } from './preferences';

export interface PreparedSocialShareAsset {
  photoId: string;
  sourceUrl: string;
  fileName: string;
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface SocialSharePackageManifest {
  schemaVersion: 1;
  exportedAtUtc: string;
  caption: string;
  assets: {
    photoId: string;
    sourceUrl: string;
    fileName: string;
    path: string;
    contentType: string;
    byteLength: number;
  }[];
}

export type SocialShareDownloadProgress = (current: number, total: number) => void;

export interface SocialSharePreparationOptions {
  timeoutMilliseconds?: number;
}

export const SOCIAL_SHARE_ASSET_TIMEOUT_MILLISECONDS = 45_000;

export async function prepareSocialShareAssets(
  photos: readonly Photo[],
  gateway: Pick<GatewayClient, 'request'>,
  onProgress?: SocialShareDownloadProgress,
  options: SocialSharePreparationOptions = {}
): Promise<PreparedSocialShareAsset[]> {
  assertSelection(
    photos.length,
    photos.reduce((total, photo) => total + photo.fileSize, 0)
  );
  const names = new Set<string>();
  const assets: PreparedSocialShareAsset[] = [];

  for (const [index, photo] of photos.entries()) {
    const result = await withTimeout(
      gateway.request('downloadProductAsset', { url: photo.url }),
      options.timeoutMilliseconds ?? SOCIAL_SHARE_ASSET_TIMEOUT_MILLISECONDS,
      translateUi('photos.social.errors.originalTimeout', { name: photo.name })
    );
    const bytes = decodeBase64(result.contentBase64);
    const detectedContentType = validatePhotoBytes(bytes);
    if (result.byteLength !== bytes.byteLength) {
      throw new Error(translateUi('photos.social.errors.byteLengthMismatch', { name: photo.name }));
    }
    if (result.contentType.toLocaleLowerCase() !== detectedContentType) {
      throw new Error(translateUi('photos.social.errors.contentTypeMismatch', { name: photo.name }));
    }
    const fileName = uniqueFileName(result.fileName || photo.name, detectedContentType, names);
    assets.push({
      photoId: photo.id,
      sourceUrl: photo.url,
      fileName,
      path: `assets/${fileName}`,
      contentType: detectedContentType,
      bytes
    });
    assertSelection(
      assets.length,
      assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
    );
    onProgress?.(index + 1, photos.length);
  }

  return assets;
}

function withTimeout<T>(operation: Promise<T>, timeoutMilliseconds: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    return Promise.reject(new Error(translateUi('photos.social.errors.invalidTimeout')));
  }
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMilliseconds);
    void operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

export function createNativeShareFiles(assets: readonly PreparedSocialShareAsset[]): File[] {
  return assets.map(
    (asset) =>
      new File([copyArrayBuffer(asset.bytes)], asset.fileName, {
        type: asset.contentType,
        lastModified: 0
      })
  );
}

export async function createSocialShareArchive(
  assets: readonly PreparedSocialShareAsset[],
  caption: string,
  exportedAtUtc = new Date().toISOString()
): Promise<Uint8Array> {
  assertSelection(
    assets.length,
    assets.reduce((total, asset) => total + asset.bytes.byteLength, 0)
  );
  const manifest: SocialSharePackageManifest = {
    schemaVersion: 1,
    exportedAtUtc,
    caption: normalizeCaption(caption),
    assets: assets.map((asset) => ({
      photoId: asset.photoId,
      sourceUrl: asset.sourceUrl,
      fileName: asset.fileName,
      path: asset.path,
      contentType: asset.contentType,
      byteLength: asset.bytes.byteLength
    }))
  };
  const files: AsyncZippable = {
    'share.json': [strToU8(`${JSON.stringify(manifest, null, 2)}\n`), { level: 6 }],
    'caption.txt': [strToU8(manifest.caption), { level: 6 }]
  };
  for (const asset of assets) files[asset.path] = [asset.bytes, { level: 0 }];
  const archive = await zipFiles(files);
  if (archive.byteLength > SOCIAL_SHARE_MAX_TOTAL_BYTES) {
    throw new Error(translateUi('photos.social.errors.archiveTooLarge'));
  }
  return archive;
}

export function normalizeSocialShareCaption(value: string): string {
  return normalizeCaption(value);
}

function assertSelection(photoCount: number, totalBytes: number): void {
  const issue = validateSocialShareSelection(photoCount, totalBytes, readAppPreferences().uiLocale)[0];
  if (issue) throw new Error(issue);
}

function normalizeCaption(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (normalized.length > 4000) throw new Error(translateUi('photos.social.errors.captionTooLong'));
  return normalized;
}

function uniqueFileName(source: string, contentType: string, names: Set<string>): string {
  const extension = photoFileExtension(contentType);
  const stem = source
    .replace(/\.[^.]*$/u, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '')
    .slice(0, 80);
  const base = stem || 'image';
  let candidate = `${base}.${extension}`;
  let suffix = 2;
  while (names.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `${base}-${suffix}.${extension}`;
    suffix += 1;
  }
  names.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = Uint8Array.from(bytes);
  return copy.buffer;
}

function zipFiles(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}
