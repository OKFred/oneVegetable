import { zip, unzip, type AsyncZippable, type UnzipFileInfo, type Unzipped } from 'fflate';

import {
  collectProductSchemaAssetReferences,
  MAX_PHOTOBANK_IMAGE_BYTES,
  MAX_PRODUCT_TRANSFER_ARCHIVE_ENTRIES,
  MAX_PRODUCT_TRANSFER_JSON_BYTES,
  MAX_PRODUCT_TRANSFER_UNCOMPRESSED_BYTES,
  MAX_PRODUCT_TRANSFER_ZIP_BYTES,
  normalizeProductTransferAssetPath,
  parseProductSchemaXml,
  parseProductTransferPackageJson,
  PHOTOBANK_UPLOAD_CONTENT_TYPES,
  photoFileExtension,
  PRODUCT_TRANSFER_ARCHIVE_SCHEMA_VERSION,
  serializeProductTransferArchiveDocument,
  validatePhotoBytes,
  type ProductTransferDocumentV2
} from '@one-vegetable/core';

import type { ProductTransferDocumentV1 } from '@one-vegetable/core';
import type {
  ArchiveWorkerErrorCode,
  ArchiveWorkerFile,
  ArchiveWorkerRequest,
  ArchiveWorkerResponse
} from './product-transfer-archive.worker';
import { translateUi } from '../i18n';

const MANIFEST_PATH = 'products.json';

export interface ProductTransferArchiveAsset {
  path: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ProductTransferArchiveReadResult {
  document: ProductTransferDocumentV2;
  assets: ProductTransferArchiveAsset[];
  referencedAssetPaths: string[];
  unusedAssetPaths: string[];
  totalUncompressedBytes: number;
}

export interface ProductTransferArchiveWriteInput {
  document: ProductTransferDocumentV2;
  assets: readonly ProductTransferArchiveAsset[];
}

export type ProductTransferFileFormat = 'json' | 'zip';

export type ProductTransferImportSelection =
  | { kind: 'json'; document: ProductTransferDocumentV1 }
  | {
      kind: 'zip';
      archive: ProductTransferArchiveReadResult;
      targetGroupId: string;
      targetGroupName: string;
    };

export interface ProductTransferProgress {
  phase: 'reading' | 'downloading' | 'packing' | 'uploading' | 'queuing';
  message: string;
  current: number;
  total: number;
}

export async function readProductTransferArchive(
  bytes: Uint8Array
): Promise<ProductTransferArchiveReadResult> {
  if (bytes.byteLength > MAX_PRODUCT_TRANSFER_ZIP_BYTES) {
    throw new Error(translateUi('products.transfer.errors.zipTooLarge'));
  }
  if (!isProductTransferZipBytes(bytes)) throw new Error(translateUi('products.transfer.errors.invalidZip'));

  let entryCount = 0;
  let totalUncompressedBytes = 0;
  const filterState: { error: Error | null } = { error: null };
  const normalizedNames = new Set<string>();
  const files = await unzipArchive(bytes, (entry) => {
    if (filterState.error) return false;
    try {
      entryCount += 1;
      if (entryCount > MAX_PRODUCT_TRANSFER_ARCHIVE_ENTRIES) {
        throw new Error(translateUi('products.transfer.errors.entryLimit'));
      }
      totalUncompressedBytes += entry.originalSize;
      if (totalUncompressedBytes > MAX_PRODUCT_TRANSFER_UNCOMPRESSED_BYTES) {
        throw new Error(translateUi('products.transfer.errors.uncompressedLimit'));
      }

      const name = normalizeArchiveEntryName(entry.name);
      const caseInsensitiveName = name.toLocaleLowerCase('en-US');
      if (normalizedNames.has(caseInsensitiveName)) {
        throw new Error(translateUi('products.transfer.errors.duplicatePath', { path: name }));
      }
      normalizedNames.add(caseInsensitiveName);

      if (name.endsWith('/')) {
        if (name !== 'assets/') {
          throw new Error(translateUi('products.transfer.errors.unsupportedDirectory', { path: name }));
        }
        return false;
      }
      if (name === MANIFEST_PATH) {
        if (entry.originalSize > MAX_PRODUCT_TRANSFER_JSON_BYTES) {
          throw new Error(translateUi('products.transfer.errors.manifestLimit'));
        }
        return true;
      }
      const assetPath = normalizeProductTransferAssetPath(name);
      if (!assetPath) {
        throw new Error(translateUi('products.transfer.errors.unsupportedPath', { path: name }));
      }
      if (entry.originalSize > MAX_PHOTOBANK_IMAGE_BYTES) {
        throw new Error(translateUi('products.transfer.errors.photoLimit', { path: name }));
      }
      return true;
    } catch (error: unknown) {
      filterState.error = toError(error);
      return false;
    }
  });
  if (filterState.error) throw filterState.error;

  const manifestBytes = files[MANIFEST_PATH];
  if (!manifestBytes) throw new Error(translateUi('products.transfer.errors.manifestMissing'));
  const manifest = decodeUtf8(manifestBytes, MANIFEST_PATH);
  const parsed = parseProductTransferPackageJson(manifest);
  if (parsed.schemaVersion !== PRODUCT_TRANSFER_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(translateUi('products.transfer.errors.schemaVersion'));
  }

  const assets = Object.entries(files)
    .filter(([path]) => path !== MANIFEST_PATH)
    .map(([path, assetBytes]) => normalizeArchiveAsset(path, assetBytes));
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const referencedAssetPaths = collectDocumentAssetPaths(parsed);
  for (const path of referencedAssetPaths) {
    if (!assetsByPath.has(path)) {
      throw new Error(translateUi('products.transfer.errors.referencedAssetMissing', { path }));
    }
  }
  const referenced = new Set(referencedAssetPaths);
  const unusedAssetPaths = assets
    .map((asset) => asset.path)
    .filter((path) => !referenced.has(path))
    .toSorted();

  return {
    document: parsed,
    assets,
    referencedAssetPaths,
    unusedAssetPaths,
    totalUncompressedBytes
  };
}

export async function createProductTransferArchive(
  input: ProductTransferArchiveWriteInput
): Promise<Uint8Array> {
  const manifest = new TextEncoder().encode(serializeProductTransferArchiveDocument(input.document));
  const files: AsyncZippable = {
    [MANIFEST_PATH]: [manifest, { level: 6 }]
  };
  const workerFiles: ArchiveWorkerFile[] = [{ path: MANIFEST_PATH, bytes: manifest, level: 6 }];
  const names = new Set<string>([MANIFEST_PATH]);
  let totalUncompressedBytes = manifest.byteLength;

  for (const asset of input.assets) {
    const path = normalizeProductTransferAssetPath(asset.path);
    if (!path || path !== asset.path) {
      throw new Error(translateUi('products.transfer.errors.invalidAssetPath', { path: asset.path }));
    }
    const caseInsensitiveName = path.toLocaleLowerCase('en-US');
    if (names.has(caseInsensitiveName)) {
      throw new Error(translateUi('products.transfer.errors.duplicateAssetPath', { path }));
    }
    names.add(caseInsensitiveName);
    const detectedContentType = validatePhotoBytes(asset.bytes);
    assertPhotoBankUploadContentType(detectedContentType);
    if (detectedContentType !== asset.contentType.toLocaleLowerCase()) {
      throw new Error(translateUi('products.transfer.errors.contentTypeMismatch', { path }));
    }
    assertImageExtension(path, detectedContentType);
    totalUncompressedBytes += asset.bytes.byteLength;
    if (totalUncompressedBytes > MAX_PRODUCT_TRANSFER_UNCOMPRESSED_BYTES) {
      throw new Error(translateUi('products.transfer.errors.uncompressedLimit'));
    }
    files[path] = [asset.bytes, { level: 0 }];
    workerFiles.push({ path, bytes: asset.bytes, level: 0 });
  }

  if (Object.keys(files).length > MAX_PRODUCT_TRANSFER_ARCHIVE_ENTRIES) {
    throw new Error(translateUi('products.transfer.errors.entryLimit'));
  }
  const availableAssets = new Set(input.assets.map((asset) => asset.path));
  for (const path of collectDocumentAssetPaths(input.document)) {
    if (!availableAssets.has(path)) {
      throw new Error(translateUi('products.transfer.errors.referencedAssetMissing', { path }));
    }
  }
  const archive = await zipArchive(files, workerFiles);
  if (archive.byteLength > MAX_PRODUCT_TRANSFER_ZIP_BYTES) {
    throw new Error(translateUi('products.transfer.errors.zipTooLarge'));
  }
  return archive;
}

export function productTransferArchiveAssetPath(
  fileName: string,
  contentType: string,
  sha256: string
): string {
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error(translateUi('products.transfer.errors.invalidSha256'));
  }
  const stem = fileName
    .replace(/\.[^.]*$/u, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  const safeStem = stem || 'image';
  return `assets/${safeStem}-${sha256.slice(0, 12)}.${photoFileExtension(contentType)}`;
}

function collectDocumentAssetPaths(document: ProductTransferDocumentV2): string[] {
  const paths = new Set<string>();
  for (const product of document.products) {
    const references = collectProductSchemaAssetReferences(parseProductSchemaXml(product.schemaXml));
    for (const reference of references) {
      if (!reference.source.startsWith('assets/')) continue;
      const path = normalizeProductTransferAssetPath(reference.source);
      if (!path) {
        throw new Error(
          translateUi('products.transfer.errors.unsafeProductAsset', {
            productId: product.source.productId
          })
        );
      }
      paths.add(path);
    }
  }
  return [...paths].toSorted();
}

function normalizeArchiveAsset(path: string, bytes: Uint8Array): ProductTransferArchiveAsset {
  const normalizedPath = normalizeProductTransferAssetPath(path);
  if (!normalizedPath || normalizedPath !== path) {
    throw new Error(translateUi('products.transfer.errors.invalidAssetPath', { path }));
  }
  const contentType = validatePhotoBytes(bytes);
  assertPhotoBankUploadContentType(contentType);
  assertImageExtension(path, contentType);
  return {
    path,
    fileName: path.slice(path.lastIndexOf('/') + 1),
    contentType,
    bytes
  };
}

function assertPhotoBankUploadContentType(contentType: string): void {
  if (!PHOTOBANK_UPLOAD_CONTENT_TYPES.has(contentType)) {
    throw new Error(translateUi('products.transfer.errors.unsupportedPhotoType', { contentType }));
  }
}

function assertImageExtension(path: string, contentType: string): void {
  const extension = path.split('.').pop()?.toLocaleLowerCase() ?? '';
  const accepted =
    contentType === 'image/jpeg' ? new Set(['jpg', 'jpeg']) : new Set([photoFileExtension(contentType)]);
  if (!accepted.has(extension)) {
    throw new Error(translateUi('products.transfer.errors.extensionMismatch', { path }));
  }
}

function normalizeArchiveEntryName(name: string): string {
  if (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[A-Za-z]:/u.test(name)
  ) {
    throw new Error(
      translateUi('products.transfer.errors.unsafePath', {
        path: name || translateUi('products.transfer.errors.emptyPath')
      })
    );
  }
  const segments = name.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(translateUi('products.transfer.errors.traversalPath', { path: name }));
  }
  const normalized = name.endsWith('/') ? `${segments.join('/')}/` : segments.join('/');
  if (normalized !== name) {
    throw new Error(translateUi('products.transfer.errors.nonCanonicalPath', { path: name }));
  }
  return normalized;
}

export function isProductTransferZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(translateUi('products.transfer.errors.invalidText', { path }));
  }
}

function unzipArchive(bytes: Uint8Array, filter: (entry: UnzipFileInfo) => boolean): Promise<Unzipped> {
  if (typeof Worker !== 'undefined') {
    return runArchiveWorker({
      id: globalThis.crypto.randomUUID(),
      operation: 'unzip',
      bytes,
      limits: {
        maxEntries: MAX_PRODUCT_TRANSFER_ARCHIVE_ENTRIES,
        maxJsonBytes: MAX_PRODUCT_TRANSFER_JSON_BYTES,
        maxPhotoBytes: MAX_PHOTOBANK_IMAGE_BYTES,
        maxUncompressedBytes: MAX_PRODUCT_TRANSFER_UNCOMPRESSED_BYTES
      }
    }).then((response) => {
      if (!response.ok) throw new Error(archiveWorkerErrorMessage(response.errorCode, response.path));
      if (response.operation !== 'unzip') {
        throw new Error(translateUi('products.transfer.errors.unzipResponse'));
      }
      const files: Unzipped = {};
      for (const file of response.files) {
        if (
          filter({
            name: file.path,
            size: file.bytes.byteLength,
            originalSize: file.bytes.byteLength,
            compression: 0
          })
        ) {
          files[file.path] = Uint8Array.from(file.bytes);
        }
      }
      return files;
    });
  }
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter }, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

function zipArchive(files: AsyncZippable, workerFiles: readonly ArchiveWorkerFile[]): Promise<Uint8Array> {
  if (typeof Worker !== 'undefined') {
    return runArchiveWorker({
      id: globalThis.crypto.randomUUID(),
      operation: 'zip',
      files: [...workerFiles]
    }).then((response) => {
      if (!response.ok) throw new Error(archiveWorkerErrorMessage(response.errorCode, response.path));
      if (response.operation !== 'zip') {
        throw new Error(translateUi('products.transfer.errors.zipResponse'));
      }
      return response.bytes;
    });
  }
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}

function runArchiveWorker(request: ArchiveWorkerRequest): Promise<ArchiveWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./product-transfer-archive.worker.ts', import.meta.url), {
      type: 'module',
      name: 'one-vegetable-product-transfer'
    });
    const timeout = globalThis.setTimeout(() => {
      worker.terminate();
      reject(new Error(translateUi('products.transfer.errors.workerTimeout')));
    }, 60_000);
    const finish = (action: () => void): void => {
      globalThis.clearTimeout(timeout);
      worker.terminate();
      action();
    };
    worker.onerror = () => {
      finish(() => {
        reject(new Error(translateUi('products.transfer.errors.workerFailed')));
      });
    };
    worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
      if (event.data.id !== request.id) return;
      finish(() => {
        resolve(event.data);
      });
    };
    try {
      if (request.operation === 'unzip') {
        const bytes = request.bytes.slice();
        worker.postMessage({ ...request, bytes }, [bytes.buffer]);
        return;
      }
      const transferableFiles = request.files.map((file) => ({ ...file, bytes: file.bytes.slice() }));
      worker.postMessage(
        { ...request, files: transferableFiles },
        transferableFiles.map((file) => file.bytes.buffer)
      );
    } catch (error: unknown) {
      finish(() => {
        reject(toError(error));
      });
    }
  });
}

function archiveWorkerErrorMessage(code: ArchiveWorkerErrorCode, path?: string): string {
  const key = {
    'entry-limit': 'entryLimit',
    'uncompressed-limit': 'uncompressedLimit',
    'duplicate-path': 'duplicatePath',
    'unsupported-directory': 'unsupportedDirectory',
    'manifest-limit': 'manifestLimit',
    'unsupported-path': 'unsupportedPath',
    'photo-limit': 'photoLimit',
    'unsafe-path': 'unsafePath',
    'traversal-path': 'traversalPath',
    'non-canonical-path': 'nonCanonicalPath',
    'worker-failed': 'workerFailed'
  } satisfies Record<ArchiveWorkerErrorCode, string>;
  return translateUi(`products.transfer.errors.${key[code]}`, {
    path: path && path.length > 0 ? path : translateUi('products.transfer.errors.emptyPath')
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
