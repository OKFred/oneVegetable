import { unzip, zip, type AsyncZippable, type UnzipFileInfo, type Unzipped } from 'fflate';

import {
  GALLERY_TRANSFER_ASSET_DIRECTORY,
  GALLERY_TRANSFER_MAX_ARCHIVE_BYTES,
  GALLERY_TRANSFER_MAX_ENTRIES,
  GALLERY_TRANSFER_MAX_UNCOMPRESSED_BYTES,
  MAX_PHOTOBANK_IMAGE_BYTES,
  PHOTOBANK_UPLOAD_CONTENT_TYPES,
  photoFileExtension,
  validateGalleryTransferDocument,
  validatePhotoBytes,
  type GalleryTransferDocumentV1
} from '@one-vegetable/core';
import { translateUi } from '../i18n';

const MANIFEST_PATH = 'gallery.json';

export interface GalleryTransferArchiveAsset {
  path: string;
  bytes: Uint8Array;
}

export interface GalleryTransferArchive {
  document: GalleryTransferDocumentV1;
  assets: GalleryTransferArchiveAsset[];
  totalUncompressedBytes: number;
}

export async function createGalleryTransferArchive(input: GalleryTransferArchive): Promise<Uint8Array> {
  const document = validateGalleryTransferDocument(input.document);
  const manifest = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
  const files: AsyncZippable = { [MANIFEST_PATH]: [manifest, { level: 6 }] };
  const names = new Set<string>([MANIFEST_PATH]);
  let totalBytes = manifest.byteLength;
  const manifestAssets = new Map(document.assets.map((asset) => [asset.path, asset]));
  if (manifestAssets.size !== input.assets.length) throw transferError('countMismatch');

  for (const asset of input.assets) {
    const normalizedPath = normalizeArchivePath(asset.path);
    if (!normalizedPath.startsWith(GALLERY_TRANSFER_ASSET_DIRECTORY)) {
      throw transferError('assetDirectory');
    }
    const folded = normalizedPath.toLocaleLowerCase('en-US');
    if (names.has(folded)) throw transferError('duplicatePath', { path: normalizedPath });
    names.add(folded);
    const metadata = manifestAssets.get(normalizedPath);
    if (!metadata) throw transferError('unreferencedAsset', { path: normalizedPath });
    const contentType = validatePhotoBytes(asset.bytes);
    if (!PHOTOBANK_UPLOAD_CONTENT_TYPES.has(contentType) || contentType !== metadata.contentType) {
      throw transferError('contentMismatch', { path: normalizedPath });
    }
    if (asset.bytes.byteLength !== metadata.byteLength) {
      throw transferError('sizeMismatch', { path: normalizedPath });
    }
    if ((await sha256Hex(asset.bytes)) !== metadata.sha256) {
      throw transferError('digestMismatch', { path: normalizedPath });
    }
    assertExtension(normalizedPath, contentType);
    totalBytes += asset.bytes.byteLength;
    if (totalBytes > GALLERY_TRANSFER_MAX_UNCOMPRESSED_BYTES) {
      throw transferError('uncompressedLimit');
    }
    files[normalizedPath] = [asset.bytes, { level: 0 }];
  }
  if (Object.keys(files).length > GALLERY_TRANSFER_MAX_ENTRIES) throw transferError('entryLimit');
  const archive = await zipArchive(files);
  if (archive.byteLength > GALLERY_TRANSFER_MAX_ARCHIVE_BYTES) throw transferError('archiveLimit');
  return archive;
}

export async function readGalleryTransferArchive(bytes: Uint8Array): Promise<GalleryTransferArchive> {
  if (bytes.byteLength > GALLERY_TRANSFER_MAX_ARCHIVE_BYTES) throw transferError('archiveLimit');
  if (!isZip(bytes)) throw transferError('invalidZip');
  let entries = 0;
  let totalUncompressedBytes = 0;
  const names = new Set<string>();
  const files = await unzipArchive(bytes, (entry) => {
    entries += 1;
    if (entries > GALLERY_TRANSFER_MAX_ENTRIES) throw transferError('entryLimit');
    totalUncompressedBytes += entry.originalSize;
    if (totalUncompressedBytes > GALLERY_TRANSFER_MAX_UNCOMPRESSED_BYTES) {
      throw transferError('uncompressedLimit');
    }
    const path = normalizeArchivePath(entry.name);
    const folded = path.toLocaleLowerCase('en-US');
    if (names.has(folded)) throw transferError('duplicatePath', { path });
    names.add(folded);
    if (path.endsWith('/')) {
      if (path !== GALLERY_TRANSFER_ASSET_DIRECTORY) throw transferError('unsupportedDirectory', { path });
      return false;
    }
    if (path === MANIFEST_PATH) return true;
    if (!path.startsWith(GALLERY_TRANSFER_ASSET_DIRECTORY)) throw transferError('unsupportedPath', { path });
    if (entry.originalSize > MAX_PHOTOBANK_IMAGE_BYTES) throw transferError('photoLimit', { path });
    return true;
  });
  const manifestBytes = files[MANIFEST_PATH];
  if (!manifestBytes) throw transferError('manifestMissing');
  const document = parseManifest(manifestBytes);
  const assetsByPath = new Map(document.assets.map((asset) => [asset.path, asset]));
  const assets: GalleryTransferArchiveAsset[] = [];
  for (const [path, assetBytes] of Object.entries(files)) {
    if (path === MANIFEST_PATH) continue;
    const metadata = assetsByPath.get(path);
    if (!metadata) throw transferError('unreferencedAsset', { path });
    const contentType = validatePhotoBytes(assetBytes);
    if (contentType !== metadata.contentType || assetBytes.byteLength !== metadata.byteLength) {
      throw transferError('metadataMismatch', { path });
    }
    if ((await sha256Hex(assetBytes)) !== metadata.sha256) {
      throw transferError('digestMismatch', { path });
    }
    assertExtension(path, contentType);
    assets.push({ path, bytes: assetBytes });
  }
  if (assets.length !== document.assets.length) throw transferError('assetMissing');
  return {
    document,
    assets: assets.toSorted((left, right) => left.path.localeCompare(right.path)),
    totalUncompressedBytes
  };
}

export function galleryTransferAssetPath(fileName: string, contentType: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw transferError('invalidSha256');
  const stem = fileName
    .replace(/\.[^.]*$/u, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${GALLERY_TRANSFER_ASSET_DIRECTORY}${stem || 'image'}-${sha256.slice(0, 12)}.${photoFileExtension(contentType)}`;
}

export async function galleryAssetSha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

function parseManifest(bytes: Uint8Array): GalleryTransferDocumentV1 {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw transferError('invalidManifest');
  }
  return validateGalleryTransferDocument(value);
}

function normalizeArchivePath(value: string): string {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw transferError('unsafePath');
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw transferError('traversalPath');
  const normalized = value.endsWith('/') ? `${parts.join('/')}/` : parts.join('/');
  if (normalized !== value) throw transferError('nonCanonicalPath', { path: value });
  return normalized;
}

function assertExtension(path: string, contentType: string): void {
  const extension = path.split('.').at(-1)?.toLocaleLowerCase() ?? '';
  const expected = photoFileExtension(contentType);
  if (extension !== expected && !(contentType === 'image/jpeg' && extension === 'jpeg')) {
    throw transferError('extensionMismatch', { path });
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function zipArchive(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}

function unzipArchive(bytes: Uint8Array, filter: (entry: UnzipFileInfo) => boolean): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter }, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function transferError(key: string, values?: Record<string, unknown>): Error {
  return new Error(translateUi(`photos.transfer.errors.${key}`, values));
}
