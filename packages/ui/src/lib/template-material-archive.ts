import { AsyncInflate, unzip, zip, type AsyncZippable, type UnzipFileInfo } from 'fflate';

import {
  MAX_PHOTOBANK_IMAGE_BYTES,
  PHOTOBANK_UPLOAD_CONTENT_TYPES,
  photoFileExtension,
  validateGalleryTransferDocument,
  validatePhotoBytes,
  type GalleryTransferDocumentV1
} from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { templateError } from '@one-vegetable/core/template-library';
import {
  parseTemplateMaterialDocument,
  TEMPLATE_MATERIAL_MAX_ZIP_BYTES,
  TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES,
  TEMPLATE_MATERIAL_MAX_ASSETS,
  TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES,
  type TemplateMaterialAsset,
  type TemplateMaterialDocument
} from '@one-vegetable/core/template-materials';
import { galleryAssetSha256 } from './gallery-transfer-archive';

export interface TemplateMaterialPackage {
  document: TemplateMaterialDocument;
  assets: { path: string; bytes: Uint8Array }[];
}

const MANIFEST_PATH = 'templates.json';
const ASSET_PATH = /^assets\/[a-f0-9]{64}\.(?:jpg|jpeg|png|gif|bmp)$/u;
// fflate writes DOS timestamps in local time: use a fixed local calendar date.
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);
// Even a dishonest DEFLATE stream can expand only a bounded chunk before checking its size.
const INFLATE_CHUNK_BYTES = 8 * 1024;

interface ZipEntry extends UnzipFileInfo {
  dataOffset: number;
  localOffset: number;
  localEnd: number;
  crc: number;
}

export async function createTemplateMaterialArchive(input: TemplateMaterialPackage): Promise<Uint8Array> {
  const verified = await verifyPackage(input);
  return pack(MANIFEST_PATH, encodeDocument(verified.document), verified.assets);
}

export async function readTemplateMaterialArchive(bytes: Uint8Array): Promise<TemplateMaterialPackage> {
  if (!(bytes instanceof Uint8Array)) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
  if (bytes.byteLength > TEMPLATE_MATERIAL_MAX_ZIP_BYTES) {
    throw templateError('TEMPLATE_MATERIAL_ZIP_TOO_LARGE');
  }
  // Workers and digest operations yield; never keep reading a caller-owned mutable buffer.
  const snapshot = Uint8Array.from(bytes);
  const entries = inspectZip(snapshot);
  await inspectWithFflate(snapshot, entries);
  const directory = entries.get('assets/');
  if (directory) await extractEntry(snapshot, directory);
  const manifest = entries.get(MANIFEST_PATH);
  if (!manifest) throw templateError('TEMPLATE_MATERIAL_INVALID_DOCUMENT');
  const document = parseDocument(await extractEntry(snapshot, manifest));
  const metadata = new Map(document.assets.map((asset) => [asset.path, asset]));
  for (const entry of entries.values()) {
    if (entry.name === MANIFEST_PATH || entry.name === 'assets/') continue;
    if (!metadata.has(entry.name)) throw templateError('TEMPLATE_MATERIAL_UNREFERENCED_ASSET');
  }
  const assets: TemplateMaterialPackage['assets'] = [];
  for (const asset of document.assets.toSorted(comparePath)) {
    const entry = entries.get(asset.path);
    if (!entry) throw templateError('TEMPLATE_MATERIAL_ASSET_MISSING');
    if (entry.originalSize !== asset.byteLength) throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
    const assetBytes = await extractEntry(snapshot, entry);
    await verifyAsset(asset, assetBytes);
    assets.push({ path: asset.path, bytes: assetBytes });
  }
  return { document, assets };
}

export async function templateMaterialGalleryArchive(input: TemplateMaterialPackage): Promise<Uint8Array> {
  const verified = await verifyPackage(input);
  const document: GalleryTransferDocumentV1 = {
    schemaVersion: 1,
    kind: 'one-vegetable-gallery-transfer',
    createdTimeUtc: verified.document.exportedAtUtc,
    assets: verified.document.assets.toSorted(comparePath).map((asset) => ({
      ...asset,
      // A local material identifier, never an Alibaba photo-query identifier.
      sourcePhotoId: `template-material-${asset.sha256.slice(0, 32)}`,
      groupPath: 'template-assets',
      width: null,
      height: null,
      modifiedTimeUtc: null
    }))
  };
  try {
    validateGalleryTransferDocument(document);
  } catch {
    throw templateError('TEMPLATE_MATERIAL_INVALID_DOCUMENT');
  }
  // The shared gallery writer uses wall-clock mtime. Keep the gallery wire shape,
  // but pack here so reselecting the original template ZIP retains its fingerprint.
  return pack('gallery.json', encodeJson(document), verified.assets);
}

async function verifyPackage(input: TemplateMaterialPackage): Promise<TemplateMaterialPackage> {
  if (typeof input !== 'object' || (input as unknown) === null)
    throw templateError('TEMPLATE_MATERIAL_INVALID_DOCUMENT');
  const document = parseDocument(encodeDocument(input.document));
  if (!Array.isArray(input.assets)) throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
  if (input.assets.length > TEMPLATE_MATERIAL_MAX_ASSETS)
    throw templateError('TEMPLATE_MATERIAL_ASSET_LIMIT');
  const metadata = new Map(document.assets.map((asset) => [asset.path, asset]));
  const names = new Set<string>();
  const assets: TemplateMaterialPackage['assets'] = [];
  let totalBytes = encodeDocument(document).byteLength;
  for (const asset of input.assets) {
    if (typeof asset !== 'object' || (asset as unknown) === null)
      throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
    assertPath(asset.path);
    if (names.has(asset.path.toLowerCase())) throw templateError('TEMPLATE_MATERIAL_DUPLICATE_PATH');
    names.add(asset.path.toLowerCase());
    const meta = metadata.get(asset.path);
    if (!meta) throw templateError('TEMPLATE_MATERIAL_UNREFERENCED_ASSET');
    if (
      !(asset.bytes instanceof Uint8Array) ||
      asset.bytes.byteLength !== meta.byteLength ||
      asset.bytes.byteLength > MAX_PHOTOBANK_IMAGE_BYTES
    ) {
      throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
    }
    totalBytes += asset.bytes.byteLength;
    if (totalBytes > TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES) {
      throw templateError('TEMPLATE_MATERIAL_UNCOMPRESSED_LIMIT');
    }
    assets.push({ path: asset.path, bytes: Uint8Array.from(asset.bytes) });
  }
  if (names.size !== metadata.size) throw templateError('TEMPLATE_MATERIAL_ASSET_MISSING');
  // Snapshot every entry before the first asynchronous hash, not one image at a time.
  for (const asset of assets) {
    const meta = metadata.get(asset.path);
    if (!meta) throw templateError('TEMPLATE_MATERIAL_UNREFERENCED_ASSET');
    await verifyAsset(meta, asset.bytes);
  }
  return { document, assets: assets.toSorted(comparePath) };
}

async function verifyAsset(metadata: TemplateMaterialAsset, bytes: Uint8Array): Promise<void> {
  let contentType: string;
  try {
    contentType = validatePhotoBytes(bytes);
  } catch {
    throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
  }
  const extension = metadata.path.split('.').at(-1);
  const fileExtension = metadata.fileName.split('.').at(-1)?.toLowerCase();
  const expectedExtension = photoFileExtension(contentType);
  if (
    !PHOTOBANK_UPLOAD_CONTENT_TYPES.has(contentType) ||
    contentType !== metadata.contentType ||
    bytes.byteLength !== metadata.byteLength ||
    (extension !== expectedExtension && !(contentType === 'image/jpeg' && extension === 'jpeg')) ||
    (fileExtension !== expectedExtension && !(contentType === 'image/jpeg' && fileExtension === 'jpeg'))
  ) {
    throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
  }
  let digest: string;
  try {
    digest = await galleryAssetSha256(bytes);
  } catch {
    throw templateError('TEMPLATE_MATERIAL_DIGEST_MISMATCH');
  }
  if (digest !== metadata.sha256) throw templateError('TEMPLATE_MATERIAL_DIGEST_MISMATCH');
}

function encodeJson(value: unknown): Uint8Array {
  try {
    return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  } catch {
    throw templateError('TEMPLATE_MATERIAL_INVALID_DOCUMENT');
  }
}

function encodeDocument(document: TemplateMaterialDocument): Uint8Array {
  const bytes = encodeJson(document);
  if (bytes.byteLength > TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES) {
    throw templateError('TEMPLATE_MATERIAL_MANIFEST_TOO_LARGE');
  }
  return bytes;
}

function parseDocument(bytes: Uint8Array): TemplateMaterialDocument {
  try {
    return parseTemplateMaterialDocument(bytes);
  } catch (error: unknown) {
    throw materialError(error, 'TEMPLATE_MATERIAL_INVALID_DOCUMENT');
  }
}

function comparePath(left: { path: string }, right: { path: string }): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function assertPath(path: string): void {
  if (typeof path !== 'string' || (path !== MANIFEST_PATH && path !== 'assets/' && !ASSET_PATH.test(path))) {
    throw templateError('TEMPLATE_MATERIAL_UNSAFE_PATH');
  }
}

function checkEntry(entry: UnzipFileInfo, names: Set<string>, state: { total: number }): void {
  if (names.size >= TEMPLATE_MATERIAL_MAX_ASSETS + 2) throw templateError('TEMPLATE_MATERIAL_ASSET_LIMIT');
  const folded = entry.name.toLowerCase();
  if (names.has(folded)) throw templateError('TEMPLATE_MATERIAL_DUPLICATE_PATH');
  names.add(folded);
  assertPath(entry.name);
  if (
    !Number.isSafeInteger(entry.originalSize) ||
    entry.originalSize < 0 ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    (entry.compression !== 0 && entry.compression !== 8) ||
    (entry.compression === 0 && entry.size !== entry.originalSize)
  ) {
    throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
  }
  state.total += entry.originalSize;
  if (state.total > TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES) {
    throw templateError('TEMPLATE_MATERIAL_UNCOMPRESSED_LIMIT');
  }
  if (entry.name === 'assets/') {
    if (entry.originalSize !== 0) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
  } else if (entry.name === MANIFEST_PATH) {
    if (entry.originalSize > TEMPLATE_MATERIAL_MAX_MANIFEST_BYTES) {
      throw templateError('TEMPLATE_MATERIAL_MANIFEST_TOO_LARGE');
    }
  } else {
    const assetCount = names.size - Number(names.has(MANIFEST_PATH)) - Number(names.has('assets/'));
    if (assetCount > TEMPLATE_MATERIAL_MAX_ASSETS) throw templateError('TEMPLATE_MATERIAL_ASSET_LIMIT');
    if (entry.originalSize === 0 || entry.originalSize > MAX_PHOTOBANK_IMAGE_BYTES) {
      throw templateError('TEMPLATE_MATERIAL_ASSET_INVALID');
    }
  }
}

/** ZIP32 only: the size limits never require ZIP64, encryption, split disks or aliases. */
function inspectZip(bytes: Uint8Array): Map<string, ZipEntry> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) {
      throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    }
    let end = bytes.byteLength - 22;
    const floor = Math.max(0, end - 65535);
    while (
      end >= floor &&
      (view.getUint32(end, true) !== 0x06054b50 ||
        end + 22 + view.getUint16(end + 20, true) !== bytes.byteLength)
    )
      end -= 1;
    if (end < floor || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
      throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    }
    const count = view.getUint16(end + 10, true);
    if (count !== view.getUint16(end + 8, true)) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    if (count > TEMPLATE_MATERIAL_MAX_ASSETS + 2) throw templateError('TEMPLATE_MATERIAL_ASSET_LIMIT');
    const centralOffset = view.getUint32(end + 16, true);
    if (centralOffset + view.getUint32(end + 12, true) !== end)
      throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    const names = new Set<string>();
    const state = { total: 0 };
    const entries = new Map<string, ZipEntry>();
    let cursor = centralOffset;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
        throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      const flags = view.getUint16(cursor + 8, true);
      if (
        (flags & ~0x080e) !== 0 ||
        view.getUint16(cursor + 34, true) !== 0 ||
        ((view.getUint32(cursor + 38, true) >>> 16) & 0xf000) === 0xa000
      ) {
        throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      }
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const next = cursor + 46 + nameLength + extraLength + view.getUint16(cursor + 32, true);
      if (next > end) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      if (!nameBytes.every((value) => value >= 0x20 && value <= 0x7e))
        throw templateError('TEMPLATE_MATERIAL_UNSAFE_PATH');
      const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
      const localOffset = view.getUint32(cursor + 42, true);
      const entry: ZipEntry = {
        name,
        size: view.getUint32(cursor + 20, true),
        originalSize: view.getUint32(cursor + 24, true),
        compression: view.getUint16(cursor + 10, true),
        crc: view.getUint32(cursor + 16, true),
        localOffset,
        dataOffset: 0,
        localEnd: 0
      };
      checkEntry(entry, names, state);
      checkExtra(view, cursor + 46 + nameLength, extraLength);
      if (
        localOffset + 30 > centralOffset ||
        view.getUint32(localOffset, true) !== 0x04034b50 ||
        view.getUint16(localOffset + 6, true) !== flags ||
        view.getUint16(localOffset + 8, true) !== entry.compression ||
        view.getUint16(localOffset + 26, true) !== nameLength
      ) {
        throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      }
      const localExtraLength = view.getUint16(localOffset + 28, true);
      entry.dataOffset = localOffset + 30 + nameLength + localExtraLength;
      entry.localEnd = entry.dataOffset + entry.size;
      if (
        entry.localEnd > centralOffset ||
        !nameBytes.every((value, offset) => bytes[localOffset + 30 + offset] === value)
      ) {
        throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      }
      checkExtra(view, localOffset + 30 + nameLength, localExtraLength);
      if (flags & 8) {
        const localFields = [
          view.getUint32(localOffset + 14, true),
          view.getUint32(localOffset + 18, true),
          view.getUint32(localOffset + 22, true)
        ];
        if (
          localFields.some(
            (value, i) => value !== 0 && value !== [entry.crc, entry.size, entry.originalSize][i]
          )
        )
          throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
        const descriptor = entry.localEnd + (view.getUint32(entry.localEnd, true) === 0x08074b50 ? 4 : 0);
        if (
          descriptor + 12 > centralOffset ||
          view.getUint32(descriptor, true) !== entry.crc ||
          view.getUint32(descriptor + 4, true) !== entry.size ||
          view.getUint32(descriptor + 8, true) !== entry.originalSize
        ) {
          throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
        }
        entry.localEnd = descriptor + 12;
      } else if (
        view.getUint32(localOffset + 14, true) !== entry.crc ||
        view.getUint32(localOffset + 18, true) !== entry.size ||
        view.getUint32(localOffset + 22, true) !== entry.originalSize
      ) {
        throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      }
      entries.set(name, entry);
      cursor = next;
    }
    if (cursor !== end) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    let localCursor = 0;
    for (const entry of [...entries.values()].toSorted(
      (left, right) => left.localOffset - right.localOffset
    )) {
      if (entry.localOffset !== localCursor) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
      localCursor = entry.localEnd;
    }
    if (localCursor !== centralOffset) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    return entries;
  } catch (error: unknown) {
    throw materialError(error, 'TEMPLATE_MATERIAL_INVALID_ZIP');
  }
}

function checkExtra(view: DataView, start: number, length: number): void {
  const end = start + length;
  while (start < end) {
    if (start + 4 > end) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    const kind = view.getUint16(start, true);
    // ZIP64 and Unicode path overrides introduce a second interpretation of an entry.
    if (kind === 1 || kind === 0x7075) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
    start += 4 + view.getUint16(start + 2, true);
    if (start > end) throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
  }
}

function inspectWithFflate(bytes: Uint8Array, entries: Map<string, ZipEntry>): Promise<void> {
  return new Promise((resolve, reject) => {
    let filterError: Error | null = null;
    let seen = 0;
    const names = new Set<string>();
    const state = { total: 0 };
    try {
      unzip(
        bytes,
        {
          filter: (entry) => {
            // Never let a filter exception escape fflate's scheduled callbacks.
            if (filterError) return false;
            try {
              checkEntry(entry, names, state);
              const expected = entries.get(entry.name);
              if (
                expected?.size !== entry.size ||
                expected.originalSize !== entry.originalSize ||
                expected.compression !== entry.compression
              ) {
                throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
              }
              seen += 1;
            } catch (error: unknown) {
              filterError = materialError(error, 'TEMPLATE_MATERIAL_INVALID_ZIP');
            }
            // This pass counts *all* originalSize values before extracting anything.
            return false;
          }
        },
        (error) => {
          if (filterError) reject(filterError);
          else if (error || seen !== entries.size) reject(templateError('TEMPLATE_MATERIAL_INVALID_ZIP'));
          else resolve();
        }
      );
    } catch (error: unknown) {
      reject(materialError(error, 'TEMPLATE_MATERIAL_INVALID_ZIP'));
    }
  });
}

async function extractEntry(archive: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const compressed = archive.subarray(entry.dataOffset, entry.dataOffset + entry.size);
  const bytes =
    entry.compression === 0
      ? Uint8Array.from(compressed)
      : await inflateBounded(compressed, entry.originalSize);
  if (bytes.byteLength !== entry.originalSize || crc32(bytes) !== entry.crc)
    throw templateError('TEMPLATE_MATERIAL_INVALID_ZIP');
  return bytes;
}

function inflateBounded(compressed: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let inflater: AsyncInflate | undefined;
    let settled = false;
    let offset = 0;
    let written = 0;
    const output = new Uint8Array(expectedSize);
    const fail = () => {
      if (settled) return;
      settled = true;
      inflater?.terminate();
      reject(templateError('TEMPLATE_MATERIAL_INVALID_ZIP'));
    };
    const push = () => {
      try {
        const end = Math.min(offset + INFLATE_CHUNK_BYTES, compressed.byteLength);
        const chunk = Uint8Array.from(compressed.subarray(offset, end));
        offset = end;
        inflater?.push(chunk, end === compressed.byteLength);
      } catch {
        fail();
      }
    };
    try {
      inflater = new AsyncInflate((error, chunk, final) => {
        if (settled) return;
        if (error || written + chunk.byteLength > expectedSize) {
          fail();
          return;
        }
        output.set(chunk, written);
        written += chunk.byteLength;
        if (final) {
          if (written !== expectedSize) {
            fail();
            return;
          }
          settled = true;
          resolve(output);
        }
      });
      // Backpressure: at most one small compressed chunk is queued in the worker.
      inflater.ondrain = () => {
        if (!settled && offset < compressed.byteLength) push();
      };
      push();
    } catch {
      fail();
    }
  });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit += 1) index = index & 1 ? 0xedb88320 ^ (index >>> 1) : index >>> 1;
  return index >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pack(
  manifestPath: string,
  manifest: Uint8Array,
  assets: TemplateMaterialPackage['assets']
): Promise<Uint8Array> {
  const files: AsyncZippable = { [manifestPath]: [manifest, { level: 6, mtime: ZIP_MTIME }] };
  let total = manifest.byteLength;
  for (const asset of assets.toSorted(comparePath)) {
    files[asset.path] = [asset.bytes, { level: 0, mtime: ZIP_MTIME }];
    total += asset.bytes.byteLength;
  }
  if (total > TEMPLATE_MATERIAL_MAX_UNCOMPRESSED_BYTES)
    throw templateError('TEMPLATE_MATERIAL_UNCOMPRESSED_LIMIT');
  return new Promise((resolve, reject) => {
    try {
      zip(files, { level: 6, mtime: ZIP_MTIME }, (error, archive) => {
        if (error) reject(templateError('TEMPLATE_MATERIAL_INVALID_ZIP'));
        else if (archive.byteLength > TEMPLATE_MATERIAL_MAX_ZIP_BYTES)
          reject(templateError('TEMPLATE_MATERIAL_ZIP_TOO_LARGE'));
        else resolve(archive);
      });
    } catch {
      reject(templateError('TEMPLATE_MATERIAL_INVALID_ZIP'));
    }
  });
}

function materialError(error: unknown, fallback: string): Error {
  return error instanceof GatewayException && error.gatewayError.code.startsWith('TEMPLATE_MATERIAL_')
    ? error
    : templateError(fallback);
}
