import { unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';

export interface ArchiveWorkerFile {
  path: string;
  bytes: Uint8Array;
  level: 0 | 6;
}

export interface ArchiveWorkerLimits {
  maxEntries: number;
  maxJsonBytes: number;
  maxPhotoBytes: number;
  maxUncompressedBytes: number;
}

export type ArchiveWorkerRequest =
  | { id: string; operation: 'unzip'; bytes: Uint8Array; limits: ArchiveWorkerLimits }
  | { id: string; operation: 'zip'; files: ArchiveWorkerFile[] };

export type ArchiveWorkerErrorCode =
  | 'entry-limit'
  | 'uncompressed-limit'
  | 'duplicate-path'
  | 'unsupported-directory'
  | 'manifest-limit'
  | 'unsupported-path'
  | 'photo-limit'
  | 'unsafe-path'
  | 'traversal-path'
  | 'non-canonical-path'
  | 'worker-failed';

export type ArchiveWorkerResponse =
  | { id: string; ok: true; operation: 'unzip'; files: ArchiveWorkerFile[] }
  | { id: string; ok: true; operation: 'zip'; bytes: Uint8Array }
  | { id: string; ok: false; errorCode: ArchiveWorkerErrorCode; path?: string };

class ArchiveWorkerFailure extends Error {
  constructor(
    readonly errorCode: ArchiveWorkerErrorCode,
    readonly path?: string
  ) {
    super(errorCode);
  }
}

interface ArchiveWorkerScope {
  onmessage: ((event: MessageEvent<ArchiveWorkerRequest>) => void) | null;
  postMessage(message: ArchiveWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as ArchiveWorkerScope;

scope.onmessage = (event) => {
  try {
    if (event.data.operation === 'unzip') {
      const files = unzipSafely(event.data.bytes, event.data.limits);
      scope.postMessage(
        { id: event.data.id, ok: true, operation: 'unzip', files },
        files.map((file) => file.bytes.buffer as ArrayBuffer)
      );
      return;
    }
    const bytes = zipFiles(event.data.files);
    scope.postMessage({ id: event.data.id, ok: true, operation: 'zip', bytes }, [
      bytes.buffer as ArrayBuffer
    ]);
  } catch (error: unknown) {
    const failure = error instanceof ArchiveWorkerFailure ? error : new ArchiveWorkerFailure('worker-failed');
    scope.postMessage({
      id: event.data.id,
      ok: false,
      errorCode: failure.errorCode,
      ...(failure.path === undefined ? {} : { path: failure.path })
    });
  }
};

function unzipSafely(bytes: Uint8Array, limits: ArchiveWorkerLimits): ArchiveWorkerFile[] {
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (entry) => {
      validateEntry(entry, names, limits);
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new ArchiveWorkerFailure('entry-limit');
      }
      totalUncompressedBytes += entry.originalSize;
      if (totalUncompressedBytes > limits.maxUncompressedBytes) {
        throw new ArchiveWorkerFailure('uncompressed-limit');
      }
      return !entry.name.endsWith('/');
    }
  });
  return Object.entries(files).map(([path, fileBytes]) => ({ path, bytes: fileBytes, level: 0 }));
}

function validateEntry(entry: UnzipFileInfo, names: Set<string>, limits: ArchiveWorkerLimits): void {
  const name = normalizeEntryName(entry.name);
  const folded = name.toLocaleLowerCase('en-US');
  if (names.has(folded)) throw new ArchiveWorkerFailure('duplicate-path', name);
  names.add(folded);
  if (name.endsWith('/')) {
    if (name !== 'assets/') throw new ArchiveWorkerFailure('unsupported-directory', name);
    return;
  }
  if (name === 'products.json') {
    if (entry.originalSize > limits.maxJsonBytes) {
      throw new ArchiveWorkerFailure('manifest-limit');
    }
    return;
  }
  if (!normalizeAssetPath(name)) {
    throw new ArchiveWorkerFailure('unsupported-path', name);
  }
  if (entry.originalSize > limits.maxPhotoBytes) {
    throw new ArchiveWorkerFailure('photo-limit', name);
  }
}

function normalizeAssetPath(value: string): string | null {
  if (!value.startsWith('assets/') || value.length <= 'assets/'.length) return null;
  if (value.includes('\\') || value.includes('\0') || value.includes('?') || value.includes('#')) return null;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  try {
    if (decodeURIComponent(value) !== value) return null;
  } catch {
    return null;
  }
  return value;
}

function zipFiles(files: readonly ArchiveWorkerFile[]): Uint8Array {
  const input: Zippable = {};
  const mtime = new Date('1980-01-01T00:00:00.000Z');
  for (const file of files) input[file.path] = [file.bytes, { level: file.level, mtime }];
  return zipSync(input, { level: 6 });
}

function normalizeEntryName(name: string): string {
  if (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[A-Za-z]:/u.test(name)
  ) {
    throw new ArchiveWorkerFailure('unsafe-path', name);
  }
  const segments = name.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new ArchiveWorkerFailure('traversal-path', name);
  }
  const normalized = name.endsWith('/') ? `${segments.join('/')}/` : segments.join('/');
  if (normalized !== name) throw new ArchiveWorkerFailure('non-canonical-path', name);
  return normalized;
}
