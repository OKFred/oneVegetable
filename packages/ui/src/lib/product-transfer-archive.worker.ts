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

export type ArchiveWorkerResponse =
  | { id: string; ok: true; operation: 'unzip'; files: ArchiveWorkerFile[] }
  | { id: string; ok: true; operation: 'zip'; bytes: Uint8Array }
  | { id: string; ok: false; message: string };

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
    scope.postMessage({
      id: event.data.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
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
        throw new Error('商品 ZIP 文件数量超过 500 个上限');
      }
      totalUncompressedBytes += entry.originalSize;
      if (totalUncompressedBytes > limits.maxUncompressedBytes) {
        throw new Error('商品 ZIP 解压后超过 100 MiB 上限');
      }
      return !entry.name.endsWith('/');
    }
  });
  return Object.entries(files).map(([path, fileBytes]) => ({ path, bytes: fileBytes, level: 0 }));
}

function validateEntry(entry: UnzipFileInfo, names: Set<string>, limits: ArchiveWorkerLimits): void {
  const name = normalizeEntryName(entry.name);
  const folded = name.toLocaleLowerCase('en-US');
  if (names.has(folded)) throw new Error(`商品 ZIP 包含重复路径：${name}`);
  names.add(folded);
  if (name.endsWith('/')) {
    if (name !== 'assets/') throw new Error(`商品 ZIP 包含不支持的目录：${name}`);
    return;
  }
  if (name === 'products.json') {
    if (entry.originalSize > limits.maxJsonBytes) {
      throw new Error('products.json 超过 10 MiB 上限');
    }
    return;
  }
  if (!normalizeAssetPath(name)) {
    throw new Error(`商品 ZIP 包含不支持的路径：${name}`);
  }
  if (entry.originalSize > limits.maxPhotoBytes) {
    throw new Error(`图片 ${name} 超过 5 MiB 上限`);
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
    throw new Error(`商品 ZIP 包含不安全路径：${name || '空路径'}`);
  }
  const segments = name.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`商品 ZIP 包含路径穿越：${name}`);
  }
  const normalized = name.endsWith('/') ? `${segments.join('/')}/` : segments.join('/');
  if (normalized !== name) throw new Error(`商品 ZIP 包含非规范路径：${name}`);
  return normalized;
}
