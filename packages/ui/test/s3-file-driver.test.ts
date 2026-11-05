// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { GatewayException } from '../../core/src/errors';
import { validS3FileKey } from '../../core/src/s3-storage';
import type { S3StorageConfigurationSummary, S3ObjectPage } from '../../core/src/s3-storage';
import {
  S3FileDriver,
  S3_FILE_LIMIT,
  fileStorage,
  storageConfigurationId,
  prepareFileCreate,
  safeFilePreview,
  validFileKey,
  type FileStorage
} from '../src/lib/s3-file-driver';

const context = 'a'.repeat(64);
function summary(id = context): S3StorageConfigurationSummary {
  return {
    configured: true,
    configurationId: id,
    endpoint: null,
    region: null,
    bucket: null,
    accessKeyIdSuffix: null,
    hasSessionToken: false,
    pathStyle: null,
    rootPrefix: null,
    revision: 1,
    updateTimeUtc: null,
    updaterId: null,
    remark: null
  };
}
function storage() {
  return {
    s3StorageConfiguration: vi.fn<FileStorage['s3StorageConfiguration']>().mockResolvedValue(summary()),
    listS3Objects: vi
      .fn<FileStorage['listS3Objects']>()
      .mockResolvedValue({ items: [], prefixes: [], nextContinuationToken: null }),
    getS3Object: vi.fn<FileStorage['getS3Object']>(),
    putS3Object: vi
      .fn<FileStorage['putS3Object']>()
      .mockImplementation((input) => Promise.resolve({ key: input.key, etag: null }))
  };
}
function object(key = 'hello.txt', size = 3) {
  return { key, size, etag: null, lastModifiedTimeUtc: 1723630000000 };
}
function firstFile(page: Awaited<ReturnType<S3FileDriver['list']>>) {
  const file = page.files.find((row) => row.type === 'file');
  if (!file) throw new Error('Expected file fixture');
  return file;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('S3 file driver', () => {
  it('reuses the core key guard exactly, without rewriting keys', () => {
    expect(validFileKey).toBe(validS3FileKey);
    for (const name of [' a', 'a ', 'a//b', '../a', './a', 'a/../b', 'a/ b', 'a\\b', 'a\n']) {
      expect(validFileKey(name)).toBe(false);
      expect(() => prepareFileCreate('', name, new Uint8Array(), '')).toThrow('S3_FILE_PATH_INVALID');
    }
    expect(prepareFileCreate('目录/', 'a?#.txt', new Uint8Array([1]), '').key).toBe('目录/a?#.txt');
    expect(() => prepareFileCreate('', 'x'.repeat(1025), new Uint8Array(), '')).toThrow();
    expect(() => prepareFileCreate('', 'folder', new Uint8Array([1]), '', true)).toThrow();
  });
  it('requires a lowercase 64-hex context and narrows optional controls', () => {
    expect(fileStorage(undefined)).toBeNull();
    expect(fileStorage({ s3StorageConfiguration: storage().s3StorageConfiguration })).toBeNull();
    expect(fileStorage(storage())).not.toBeNull();
    for (const id of ['', 'opaque', 'A'.repeat(64), 'a'.repeat(63)]) {
      expect(() => storageConfigurationId(summary(id))).toThrow('S3_FILE_CONTEXT_MISSING');
      expect(() => new S3FileDriver(storage(), id, () => true)).toThrow('S3_FILE_CONTEXT_MISSING');
    }
    expect(storageConfigurationId({ configured: false })).toBeNull();
  });
  it('lists one delimiter page, deduplicates markers, filters in memory and pages explicitly', async () => {
    const s3 = storage();
    s3.listS3Objects
      .mockResolvedValueOnce({
        items: [object('hello.txt'), object('folder/', 0)],
        prefixes: ['folder/'],
        nextContinuationToken: 'opaque+/='
      })
      .mockResolvedValueOnce({ items: [object('second.txt')], prefixes: [], nextContinuationToken: null })
      .mockResolvedValueOnce({ items: [object('hello.txt')], nextContinuationToken: 'opaque+/=' });
    const driver = new S3FileDriver(s3, context, () => true);
    const first = await driver.list();
    expect(first.files.map((row) => [row.path, row.type])).toEqual([
      ['s3://folder/', 'dir'],
      ['s3://hello.txt', 'file']
    ]);
    expect(s3.listS3Objects).toHaveBeenCalledExactlyOnceWith(
      { prefix: '', maximum: 100, delimiter: '/' },
      { storageContext: context }
    );
    driver.filter = 'HELLO';
    expect((await driver.list()).files.map((row) => row.basename)).toEqual(['hello.txt']);
    expect(s3.listS3Objects).toHaveBeenCalledOnce();
    driver.filter = '';
    driver.turnPage('next');
    expect(firstFile(await driver.list()).basename).toBe('second.txt');
    expect(s3.listS3Objects).toHaveBeenLastCalledWith(
      { prefix: '', maximum: 100, delimiter: '/', continuationToken: 'opaque+/=' },
      { storageContext: context }
    );
    driver.turnPage('previous');
    expect(firstFile(await driver.list()).basename).toBe('hello.txt');
    expect(s3.listS3Objects).toHaveBeenCalledTimes(3);
    expect(s3.getS3Object).not.toHaveBeenCalled();
  });
  it('navigates prefixes lazily and rejects malformed, nested, duplicate and out-of-root results', async () => {
    const bad: unknown[] = [
      null,
      { items: [], nextContinuationToken: 3 },
      { items: [], nextContinuationToken: '' },
      { items: [], prefixes: ['other/'], nextContinuationToken: null },
      { items: [object('folder/deep/x')], nextContinuationToken: null },
      { items: [object('folder/x', -1)], nextContinuationToken: null },
      { items: [object('folder/x'), object('folder/x')], nextContinuationToken: null },
      { items: [object('folder/x', Number.NaN)], nextContinuationToken: null },
      { items: [], prefixes: ['folder/bad'], nextContinuationToken: null },
      {
        items: Array.from({ length: 101 }, (_, i) => object('folder/' + String(i))),
        nextContinuationToken: null
      }
    ];
    for (const value of bad) {
      const s3 = storage();
      s3.listS3Objects.mockResolvedValue(value as S3ObjectPage);
      await expect(new S3FileDriver(s3, context, () => true).list({ path: 's3://folder/' })).rejects.toThrow(
        'S3_FILE_RESPONSE_INVALID'
      );
    }
    const s3 = storage();
    await new S3FileDriver(s3, context, () => true).list({ path: 's3://folder' });
    expect(s3.listS3Objects).toHaveBeenCalledWith(
      { prefix: 'folder/', maximum: 100, delimiter: '/' },
      { storageContext: context }
    );
  });
  it('discards aborted and late lists, and checks actual context before dispatch', async () => {
    const s3 = storage();
    const pending = deferred<S3ObjectPage>();
    s3.listS3Objects.mockReturnValueOnce(pending.promise);
    const driver = new S3FileDriver(s3, context, () => true);
    const result = driver.list();
    await vi.waitFor(() => {
      expect(s3.listS3Objects).toHaveBeenCalledOnce();
    });
    driver.stop();
    pending.resolve({ items: [object()], nextContinuationToken: null });
    await expect(result).rejects.toThrow('S3_FILE_CONTEXT_CHANGED');
    const controller = new AbortController();
    controller.abort();
    const fresh = new S3FileDriver(s3, context, () => true);
    await expect(fresh.list({ signal: controller.signal })).rejects.toThrow('S3_FILE_CONTEXT_CHANGED');
    s3.s3StorageConfiguration.mockResolvedValue(summary('b'.repeat(64)));
    await expect(fresh.list()).rejects.toThrow('S3_FILE_CONTEXT_CHANGED');
    expect(s3.listS3Objects).toHaveBeenCalledOnce();
  });
  it('reports a failed list as an explicit empty error state without VueFinder retries', async () => {
    const s3 = storage(),
      failed = vi.fn();
    s3.listS3Objects.mockRejectedValue(new Error('timeout'));
    const driver = new S3FileDriver(s3, context, () => true, undefined, failed);
    expect((await driver.list()).files).toEqual([]);
    expect(failed).toHaveBeenCalledOnce();
    expect(s3.listS3Objects).toHaveBeenCalledOnce();
  });
  it('creates only after an explicit plan is submitted and verifies exact bytes, including folder markers', async () => {
    const s3 = storage(),
      bytes = new Uint8Array([1, 2, 3]);
    const plan = prepareFileCreate('folder/', 'a.txt', bytes, 'text/plain');
    bytes[0] = 9;
    expect(s3.putS3Object).not.toHaveBeenCalled();
    s3.getS3Object.mockResolvedValue({
      key: plan.key,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'text/plain',
      etag: null
    });
    const driver = new S3FileDriver(s3, context, () => true);
    await driver.create(plan);
    expect(s3.putS3Object).toHaveBeenCalledExactlyOnceWith(
      { ...plan, createOnly: true },
      { storageContext: context }
    );
    expect(s3.getS3Object).toHaveBeenCalledExactlyOnceWith('folder/a.txt', {
      storageContext: context
    });
    const folder = prepareFileCreate('', 'empty', new Uint8Array(), '', true);
    s3.getS3Object.mockResolvedValue({
      key: 'empty/',
      bytes: new Uint8Array(),
      contentType: null,
      etag: null
    });
    await driver.create(folder);
    expect(s3.putS3Object).toHaveBeenLastCalledWith(
      { ...folder, createOnly: true },
      { storageContext: context }
    );
  });
  it('recognizes actual GatewayException collisions and never retries timeouts or failed readback', async () => {
    const plan = prepareFileCreate('', 'a.txt', new Uint8Array([1]), '');
    for (const gatewayError of [
      { code: 'S3_OBJECT_EXISTS', message: 'collision', retryable: false },
      { code: 'S3_PROVIDER_ERROR', subCode: 'HTTP_412', message: 'collision', retryable: false }
    ]) {
      const s3 = storage();
      s3.putS3Object.mockRejectedValue(new GatewayException(gatewayError));
      await expect(new S3FileDriver(s3, context, () => true).create(plan)).rejects.toThrow(
        'S3_FILE_COLLISION'
      );
      expect(s3.putS3Object).toHaveBeenCalledOnce();
      expect(s3.getS3Object).not.toHaveBeenCalled();
    }
    const s3 = storage(),
      driver = new S3FileDriver(s3, context, () => true);
    s3.putS3Object.mockRejectedValueOnce(new Error('timeout'));
    await expect(driver.create(plan)).rejects.toThrow('S3_FILE_WRITE_UNKNOWN');
    expect(s3.putS3Object).toHaveBeenCalledOnce();
    expect(s3.getS3Object).not.toHaveBeenCalled();
    s3.getS3Object.mockRejectedValueOnce(new Error('GET failed'));
    await expect(driver.create(plan)).rejects.toThrow('S3_FILE_WRITE_UNKNOWN');
    expect(s3.putS3Object).toHaveBeenCalledTimes(2);
    s3.getS3Object.mockResolvedValue({
      key: plan.key,
      bytes: new Uint8Array([2]),
      contentType: null,
      etag: null
    });
    await expect(driver.create(plan)).rejects.toThrow('S3_FILE_WRITE_UNKNOWN');
    expect(s3.putS3Object).toHaveBeenCalledTimes(3);
  });
  it('does not cancel an in-flight PUT, but stops scheduling readback when context changes', async () => {
    const s3 = storage(),
      pending = deferred<{ key: string; etag: string | null }>();
    s3.putS3Object.mockReturnValue(pending.promise);
    const driver = new S3FileDriver(s3, context, () => true);
    const result = driver.create(prepareFileCreate('', 'a.txt', new Uint8Array([1]), ''));
    await vi.waitFor(() => {
      expect(s3.putS3Object).toHaveBeenCalledOnce();
    });
    driver.stop();
    pending.resolve({ key: 'a.txt', etag: null });
    await expect(result).rejects.toThrow('S3_FILE_CONTEXT_CHANGED');
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(s3.putS3Object).toHaveBeenCalledOnce();
  });
  it('bounds all reads and validates content, without downloading thumbnails', async () => {
    const s3 = storage();
    s3.listS3Objects.mockResolvedValue({
      items: [object('large', S3_FILE_LIMIT + 1), object('small')],
      nextContinuationToken: null
    });
    const driver = new S3FileDriver(s3, context, () => true);
    const page = await driver.list(),
      large = page.files.find((row) => row.basename === 'large');
    if (!large) throw new Error('Missing large file');
    await expect(driver.read(large)).rejects.toThrow('S3_FILE_TOO_LARGE');
    expect(s3.getS3Object).not.toHaveBeenCalled();
    const small = page.files.find((row) => row.basename === 'small');
    if (!small) throw new Error('Missing small file');
    s3.getS3Object.mockResolvedValue({
      key: 'wrong',
      bytes: new Uint8Array([1]),
      contentType: null,
      etag: null
    });
    await expect(driver.read(small)).rejects.toThrow('S3_FILE_RESPONSE_INVALID');
    expect(s3.getS3Object).toHaveBeenCalledExactlyOnceWith('small', {
      storageContext: context
    });
    expect(() => prepareFileCreate('', 'x', new Uint8Array(S3_FILE_LIMIT + 1), '')).toThrow(
      'S3_FILE_TOO_LARGE'
    );
  });
  it('sniffs bounded media and treats HTML/SVG as escaped text, never executable URLs', () => {
    expect(safeFilePreview(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))?.kind).toBe('image');
    expect(safeFilePreview(new Uint8Array([255, 216, 255]))?.kind).toBe('image');
    const text = '<svg onload="alert(1)"><script>bad()</script></svg>';
    expect(safeFilePreview(new TextEncoder().encode(text))).toEqual({ kind: 'text', text });
    expect(safeFilePreview(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(safeFilePreview(new Uint8Array(256 * 1024 + 1).fill(65))).toBeNull();
    expect(() => safeFilePreview(new Uint8Array(S3_FILE_LIMIT + 1))).toThrow('S3_FILE_TOO_LARGE');
  });
  it('keeps ordinary file reads, writes and byte readback within decimal 5 MB', async () => {
    expect(S3_FILE_LIMIT).toBe(5_000_000);
    const s3 = storage();
    const bytes = new Uint8Array(S3_FILE_LIMIT);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const plan = prepareFileCreate('', 'large.png', bytes, 'image/png');
    const content = { key: plan.key, bytes, contentType: 'image/png', etag: null };
    s3.getS3Object.mockResolvedValue(content);
    s3.listS3Objects.mockResolvedValue({
      items: [object(plan.key, bytes.length)],
      nextContinuationToken: null
    });
    const driver = new S3FileDriver(s3, context, () => true);
    await driver.create(plan);
    expect(s3.putS3Object).toHaveBeenCalledTimes(1);
    const upload = s3.putS3Object.mock.calls[0];
    if (!upload) throw new Error('Missing file-manager upload');
    expect(upload[0].key).toBe(plan.key);
    expect(upload[0].bytes.byteLength).toBe(S3_FILE_LIMIT);
    expect(upload[0].createOnly).toBe(true);
    expect(upload[1]).toEqual({ storageContext: context });
    const selected = firstFile(await driver.list());
    expect((await driver.read(selected)).bytes).toHaveLength(S3_FILE_LIMIT);
    expect(s3.getS3Object).toHaveBeenCalledTimes(2);
    for (const [, options] of s3.getS3Object.mock.calls) expect(options).toEqual({ storageContext: context });
    expect(safeFilePreview(bytes)?.kind).toBe('image');
    const oversized = new Uint8Array(S3_FILE_LIMIT + 1);
    expect(() => prepareFileCreate('', 'too-large', oversized, '')).toThrow('S3_FILE_TOO_LARGE');
    s3.getS3Object.mockResolvedValue({ ...content, bytes: oversized });
    await expect(driver.read(selected)).rejects.toThrow('S3_FILE_RESPONSE_INVALID');
    expect(s3.putS3Object).toHaveBeenCalledTimes(1);
  });
  it('disables every out-of-scope driver operation, including public URLs', async () => {
    const s3 = storage(),
      driver = new S3FileDriver(s3, context, () => true);
    for (const method of [
      'delete',
      'rename',
      'copy',
      'move',
      'archive',
      'unarchive',
      'createFile',
      'createFolder',
      'getContent',
      'search',
      'save'
    ] as const)
      await expect(driver[method]()).rejects.toThrow('S3_FILE_DISABLED');
    expect(() => driver.getDownloadUrl()).toThrow('S3_FILE_DISABLED');
    expect(() => driver.getPreviewUrl()).toThrow('S3_FILE_DISABLED');
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });
});
