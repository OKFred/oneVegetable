import { BaseAdapter, type DirEntry, type FsData, type ListParams } from 'vuefinder';
import { validS3FileKey, type S3StorageControl, type S3ObjectContent } from '@one-vegetable/core/s3-storage';

export const S3_FILE_LIMIT = 5 * 1024 * 1024;
export const S3_PAGE_SIZE = 100;
export type FileStorage = Pick<
  S3StorageControl,
  's3StorageConfiguration' | 'listS3Objects' | 'getS3Object' | 'putS3Object'
>;
export interface FilePage {
  prefix: string;
  number: number;
  next: boolean;
  previous: boolean;
  count: number;
  loading: boolean;
}
export interface FileCreatePlan {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  directory: boolean;
}
export type SafePreview =
  { kind: 'image' | 'video'; bytes: Uint8Array; mime: string } | { kind: 'text'; text: string };

function fail(code: string): never {
  throw new Error(code);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
export function fileStorage(value: Partial<FileStorage> | null | undefined): FileStorage | null {
  const configuration = value?.s3StorageConfiguration;
  const list = value?.listS3Objects;
  const get = value?.getS3Object;
  const put = value?.putS3Object;
  if (
    typeof configuration !== 'function' ||
    typeof list !== 'function' ||
    typeof get !== 'function' ||
    typeof put !== 'function'
  )
    return null;
  return {
    s3StorageConfiguration: () => configuration.call(value),
    listS3Objects: (input, options) => list.call(value, input, options),
    getS3Object: (key, options) => get.call(value, key, options),
    putS3Object: (input, options) => put.call(value, input, options)
  };
}
export function storageConfigurationId(value: unknown): string | null {
  if (!record(value) || typeof value.configured !== 'boolean') fail('S3_FILE_RESPONSE_INVALID');
  if (!value.configured) return null;
  if (typeof value.configurationId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.configurationId))
    fail('S3_FILE_CONTEXT_MISSING');
  return value.configurationId;
}
export const validFileKey = validS3FileKey;
export function filePrefix(path = ''): string {
  const key = path.startsWith('s3://') ? path.slice(5) : path;
  if (!key) return '';
  const prefix = key.endsWith('/') ? key : key + '/';
  if (!validFileKey(prefix, true)) fail('S3_FILE_PATH_INVALID');
  return prefix;
}
export function prepareFileCreate(
  prefix: string,
  name: string,
  bytes: Uint8Array,
  contentType: string,
  directory = false
): FileCreatePlan {
  if (prefix && !validFileKey(prefix, true)) fail('S3_FILE_PATH_INVALID');
  if (!name || name.includes('/') || !validFileKey(name)) fail('S3_FILE_PATH_INVALID');
  if (bytes.byteLength > S3_FILE_LIMIT) fail('S3_FILE_TOO_LARGE');
  if (directory && bytes.byteLength !== 0) fail('S3_FILE_PATH_INVALID');
  const key = prefix + name + (directory ? '/' : '');
  if (!validFileKey(key, directory)) fail('S3_FILE_PATH_INVALID');
  return {
    key,
    bytes: Uint8Array.from(bytes),
    contentType: directory ? 'application/x-directory' : contentType || 'application/octet-stream',
    directory
  };
}
function entry(key: string, directory: boolean, size: number | null, modified: number | null): DirEntry {
  const plain = directory ? key.slice(0, -1) : key;
  const split = plain.lastIndexOf('/');
  const name = plain.slice(split + 1);
  return {
    dir: 's3://' + plain.slice(0, split + 1),
    basename: name,
    extension: directory || !name.includes('.') ? '' : name.slice(name.lastIndexOf('.') + 1),
    path: 's3://' + key,
    storage: 's3',
    type: directory ? 'dir' : 'file',
    file_size: size,
    last_modified: modified === null ? null : Math.floor(modified / 1000),
    mime_type: null,
    visibility: 'private',
    read_only: true
  };
}
function parsePage(value: unknown, prefix: string): { files: DirEntry[]; next: string | null } {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    !nullableString(value.nextContinuationToken) ||
    (value.nextContinuationToken !== null &&
      (!value.nextContinuationToken || value.nextContinuationToken.length > 8192)) ||
    (value.prefixes !== undefined && !Array.isArray(value.prefixes))
  )
    fail('S3_FILE_RESPONSE_INVALID');
  const prefixes: unknown[] = Array.isArray(value.prefixes) ? value.prefixes : [];
  if (value.items.length + prefixes.length > S3_PAGE_SIZE) fail('S3_FILE_RESPONSE_INVALID');
  const folders = new Map<string, DirEntry>();
  const files: DirEntry[] = [];
  const seen = new Set<string>();
  const immediate = (key: string, directory: boolean) => {
    const rest = key.slice(prefix.length, directory ? -1 : undefined);
    return key.startsWith(prefix) && !!rest && !rest.includes('/');
  };
  for (const key of prefixes) {
    if (typeof key !== 'string' || !validFileKey(key, true) || !immediate(key, true) || folders.has(key))
      fail('S3_FILE_RESPONSE_INVALID');
    folders.set(key, entry(key, true, null, null));
  }
  for (const item of value.items) {
    if (
      !record(item) ||
      typeof item.key !== 'string' ||
      !validFileKey(item.key, item.key.endsWith('/')) ||
      typeof item.size !== 'number' ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      !nullableString(item.etag) ||
      !(
        item.lastModifiedTimeUtc === null ||
        (typeof item.lastModifiedTimeUtc === 'number' &&
          Number.isFinite(item.lastModifiedTimeUtc) &&
          item.lastModifiedTimeUtc >= 0)
      ) ||
      seen.has(item.key)
    )
      fail('S3_FILE_RESPONSE_INVALID');
    seen.add(item.key);
    if (item.key === prefix && item.size === 0) continue;
    const directory = item.key.endsWith('/');
    if (!immediate(item.key, directory) || (directory && item.size !== 0)) fail('S3_FILE_RESPONSE_INVALID');
    const row = entry(item.key, directory, directory ? null : item.size, item.lastModifiedTimeUtc);
    if (directory) folders.set(item.key, row);
    else files.push(row);
  }
  return { files: [...folders.values(), ...files], next: value.nextContinuationToken };
}
function parseContent(value: unknown, key: string): S3ObjectContent {
  if (
    !record(value) ||
    value.key !== key ||
    !ArrayBuffer.isView(value.bytes) ||
    Object.prototype.toString.call(value.bytes) !== '[object Uint8Array]' ||
    value.bytes.byteLength > S3_FILE_LIMIT ||
    !nullableString(value.contentType) ||
    !nullableString(value.etag)
  )
    fail('S3_FILE_RESPONSE_INVALID');
  return {
    key,
    bytes: Uint8Array.from(
      new Uint8Array(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength)
    ),
    contentType: value.contentType,
    etag: value.etag
  };
}
export function safeFilePreview(bytes: Uint8Array): SafePreview | null {
  if (bytes.byteLength > S3_FILE_LIMIT) fail('S3_FILE_TOO_LARGE');
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  let mime = '';
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) mime = 'image/png';
  else if (starts(255, 216, 255)) mime = 'image/jpeg';
  else if (starts(71, 73, 70, 56, 55, 97) || starts(71, 73, 70, 56, 57, 97)) mime = 'image/gif';
  else if (starts(82, 73, 70, 70) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP')
    mime = 'image/webp';
  if (mime) return { kind: 'image', bytes, mime };
  const brand = new TextDecoder().decode(bytes.slice(8, 12));
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp' &&
    ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand)
  )
    return { kind: 'video', bytes, mime: 'video/mp4' };
  // shortcut: text preview is capped at 256 KiB; add a paged text viewer if needed.
  if (bytes.length > 256 * 1024) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Array.from(text).some((char) => {
      const code = char.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
      ? null
      : { kind: 'text', text };
  } catch {
    return null;
  }
}

export class S3FileDriver extends BaseAdapter {
  #stopped = false;
  #sequence = 0;
  #prefix = '';
  #tokens: (string | undefined)[] = [undefined];
  #index = 0;
  #next: string | null = null;
  #cache: { prefix: string; token: string | undefined; files: DirEntry[] } | null = null;
  filter = '';
  constructor(
    private readonly storage: FileStorage,
    readonly context: string,
    private readonly isCurrent: () => boolean,
    private readonly changed?: (page: FilePage) => void,
    private readonly failed?: (error: unknown) => void
  ) {
    super();
    if (!/^[a-f0-9]{64}$/u.test(context)) fail('S3_FILE_CONTEXT_MISSING');
  }
  stop(): void {
    this.#stopped = true;
    this.#sequence++;
    this.#cache = null;
  }
  #active(signal?: AbortSignal): void {
    if (this.#stopped || !this.isCurrent() || signal?.aborted) fail('S3_FILE_CONTEXT_CHANGED');
  }
  async #check(signal?: AbortSignal): Promise<void> {
    this.#active(signal);
    const id = storageConfigurationId(await this.storage.s3StorageConfiguration());
    this.#active(signal);
    if (id !== this.context) fail('S3_FILE_CONTEXT_CHANGED');
  }
  #notify(loading: boolean): void {
    this.changed?.({
      prefix: this.#prefix,
      number: this.#index + 1,
      next: !!this.#next,
      previous: this.#index > 0,
      count: this.#cache?.files.length ?? 0,
      loading
    });
  }
  turnPage(direction: 'next' | 'previous'): void {
    this.#active();
    if (direction === 'next' && this.#next) {
      this.#tokens = this.#tokens.slice(0, this.#index + 1);
      this.#tokens.push(this.#next);
      this.#index++;
    } else if (direction === 'previous' && this.#index > 0) this.#index--;
  }
  refresh(): void {
    this.#cache = null;
  }
  async list(params: ListParams = {}): Promise<FsData> {
    this.#active(params.signal);
    const prefix = filePrefix(params.path);
    if (prefix !== this.#prefix) {
      this.#prefix = prefix;
      this.#tokens = [undefined];
      this.#index = 0;
      this.#next = null;
      this.#cache = null;
      this.filter = '';
    }
    const token = this.#tokens[this.#index];
    const sequence = ++this.#sequence;
    const current = () => {
      this.#active(params.signal);
      if (sequence !== this.#sequence) fail('S3_FILE_CONTEXT_CHANGED');
    };
    this.#notify(true);
    try {
      if (!this.#cache || this.#cache.prefix !== prefix || this.#cache.token !== token) {
        await this.#check(params.signal);
        current();
        const raw: unknown = await this.storage.listS3Objects(
          { prefix, maximum: S3_PAGE_SIZE, delimiter: '/', ...(token ? { continuationToken: token } : {}) },
          { storageContext: this.context }
        );
        current();
        await this.#check(params.signal);
        current();
        const page = parsePage(raw, prefix);
        if (page.next && this.#tokens.slice(0, this.#index + 1).includes(page.next))
          fail('S3_FILE_RESPONSE_INVALID');
        this.#next = page.next;
        this.#cache = { prefix, token, files: page.files };
      }
      current();
      return {
        storages: ['s3'],
        dirname: 's3://' + prefix,
        read_only: true,
        files: this.#cache.files.filter((row) =>
          row.basename.toLowerCase().includes(this.filter.toLowerCase())
        )
      };
    } catch (error) {
      if (sequence === this.#sequence) {
        this.#cache = null;
        this.#next = null;
      }
      if (this.failed) {
        if (sequence === this.#sequence && !this.#stopped && this.isCurrent() && !params.signal?.aborted)
          this.failed(error);
        // Resolve an explicitly reported empty error state so VueFinder cannot retry the request.
        return { storages: ['s3'], dirname: 's3://' + prefix, read_only: true, files: [] };
      }
      throw error;
    } finally {
      if (sequence === this.#sequence && !this.#stopped && this.isCurrent()) this.#notify(false);
    }
  }
  async read(row: DirEntry): Promise<S3ObjectContent> {
    if (row.type !== 'file' || row.file_size === null || row.file_size > S3_FILE_LIMIT)
      fail('S3_FILE_TOO_LARGE');
    const key = row.path.startsWith('s3://') ? row.path.slice(5) : '';
    if (!validFileKey(key)) fail('S3_FILE_PATH_INVALID');
    await this.#check();
    const value: unknown = await this.storage.getS3Object(key, { storageContext: this.context });
    this.#active();
    await this.#check();
    return parseContent(value, key);
  }
  async create(plan: FileCreatePlan): Promise<void> {
    if (
      !validFileKey(plan.key, plan.directory) ||
      plan.bytes.length > S3_FILE_LIMIT ||
      (plan.directory && plan.bytes.length !== 0)
    )
      fail('S3_FILE_PATH_INVALID');
    const bytes = Uint8Array.from(plan.bytes);
    await this.#check();
    // No abort signal for PUT: stop subsequent work, never cancel/retry an in-flight write.
    let result: unknown;
    try {
      result = await this.storage.putS3Object(
        { ...plan, bytes, createOnly: true },
        { storageContext: this.context }
      );
    } catch (error) {
      this.#active();
      if (
        record(error) &&
        record(error.gatewayError) &&
        (error.gatewayError.code === 'S3_OBJECT_EXISTS' || error.gatewayError.subCode === 'HTTP_412')
      )
        fail('S3_FILE_COLLISION');
      fail('S3_FILE_WRITE_UNKNOWN');
    }
    this.#active();
    if (!record(result) || result.key !== plan.key || !nullableString(result.etag))
      fail('S3_FILE_WRITE_UNKNOWN');
    try {
      await this.#check();
      const value: unknown = await this.storage.getS3Object(plan.key, { storageContext: this.context });
      this.#active();
      await this.#check();
      const readback = parseContent(value, plan.key);
      if (
        readback.bytes.length !== bytes.length ||
        !readback.bytes.every((byte, index) => byte === bytes[index])
      )
        fail('S3_FILE_WRITE_UNKNOWN');
    } catch {
      this.#active();
      fail('S3_FILE_WRITE_UNKNOWN');
    }
    this.#cache = null;
  }
  delete(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  rename(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  copy(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  move(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  archive(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  unarchive(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  createFile(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  createFolder(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  getPreviewUrl(): never {
    return fail('S3_FILE_DISABLED');
  }
  getDownloadUrl(): never {
    return fail('S3_FILE_DISABLED');
  }
  getContent(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  search(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
  save(): Promise<never> {
    return Promise.reject(new Error('S3_FILE_DISABLED'));
  }
}
