import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/video/upload.json';
import multipartFixture from '../../../mock/data/video/multipart-review.json';
import { decodeBase64, encodeBase64 } from '../src/encoded-file';
import {
  fingerprintVideoFile,
  hashVideoBytes,
  assertMp4Header,
  VIDEO_UPLOAD_PART_BYTES,
  verifyReselectedVideo,
  type VideoUploadTask,
  type VideoUploadCommand
} from '../src/video-upload';
import {
  VideoUploadService,
  type VideoUploadRecord,
  type VideoUploadRepository,
  type VideoUploadStorage
} from '../src/video-upload-service';
import { S3ObjectStorageClient } from '../src/s3-storage';
import { isVideoUploadRuntimeEnabled } from '../src/video-upload-platform';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('fixture value missing');
  return value;
}

class Repository implements VideoUploadRepository {
  records = new Map<string, VideoUploadRecord>();
  failWrites = false;
  get(id: string, owner: string) {
    const item = this.records.get(id);
    return Promise.resolve(item?.ownerId === owner ? structuredClone(item) : null);
  }
  list(owner: string) {
    return Promise.resolve(
      structuredClone([...this.records.values()].filter((item) => item.ownerId === owner))
    );
  }
  save(record: VideoUploadRecord, revision: number | null) {
    if (this.failWrites) return Promise.reject(new Error('disk full'));
    if ((this.records.get(record.task.id)?.task.revision ?? null) !== revision)
      return Promise.reject(new Error('ENTITY_VERSION_CONFLICT'));
    this.records.set(record.task.id, structuredClone(record));
    return Promise.resolve();
  }
}
function setup(enabled = true) {
  let now = 1_790_000_000_000;
  const repository = new Repository();
  const upload = vi.fn().mockResolvedValue({ accepted: true, traceId: 'fixture-trace' });
  const find = vi.fn<() => Promise<{ id: string; title: string }[]>>().mockResolvedValue([]);
  const bytes = decodeBase64(fixture.mp4Base64);
  const storage: VideoUploadStorage = {
    createMultipart: vi.fn().mockResolvedValue('upload-id'),
    uploadPart: vi
      .fn()
      .mockResolvedValue({ partNumber: 1, size: bytes.length, etag: 'part-etag', checksumSha256: null }),
    listParts: vi.fn().mockResolvedValue([]),
    completeMultipart: vi.fn().mockResolvedValue(undefined),
    abortMultipart: vi.fn().mockResolvedValue(undefined),
    headVideoObject: vi.fn().mockResolvedValue({ size: bytes.length, etag: 'final' }),
    getVideoRange: vi.fn().mockResolvedValue(bytes),
    checkPresignedVideoGet: vi.fn().mockResolvedValue(undefined),
    presignVideoGet: vi.fn().mockResolvedValue('https://s3.example.test/file?X-Amz-Signature=private-value')
  };
  const service = new VideoUploadService(
    repository,
    () =>
      Promise.resolve({
        context: fixture.context,
        storage,
        platform: { find, upload },
        enabled
      }),
    () => now
  );
  const call = async (command: VideoUploadCommand) =>
    required(
      (await service.execute('admin', { requestId: crypto.randomUUID(), context: fixture.context, command }))
        .tasks[0]
    );
  const create = (source: 'file' | 'url' = 'file') =>
    call({
      action: 'create',
      title: 'Fixture video',
      source:
        source === 'file'
          ? {
              kind: 'file',
              file: { fileName: 'sample.mp4', byteLength: bytes.length, sha256: hashVideoBytes(bytes) }
            }
          : { kind: 'url', url: fixture.sourceUrl }
    });
  const target = (task: VideoUploadTask) => ({ taskId: task.id, revision: task.revision });
  return {
    repository,
    upload,
    find,
    storage,
    service,
    call,
    create,
    target,
    bytes,
    advance: (milliseconds: number) => {
      now += milliseconds;
    }
  };
}

describe('video upload durable service', () => {
  it('never persists a stale snapshot after losing CAS, including its failure-handler path', async () => {
    const env = setup();
    const task = await env.create('url');
    let winner: VideoUploadRecord | undefined;
    env.find.mockImplementation(() => {
      const current = structuredClone(required(env.repository.records.get(task.id)));
      current.task.revision += 1;
      current.busy = { action: 'cancel', until: current.task.updateTimeUtc + 90_000 };
      winner = current;
      env.repository.records.set(task.id, current);
      return Promise.resolve([]);
    });
    const save = vi.spyOn(env.repository, 'save');
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    expect(env.repository.records.get(task.id)).toEqual(winner);
    expect(save).toHaveBeenCalledTimes(2); // Acquire + rejected write; no catch overwrite.
    expect(env.upload).not.toHaveBeenCalled();
    expect(winner?.submitAttempted).toBe(false);
  });
  it('does not advance revision on a failed save or lose the last durable write receipt', async () => {
    const env = setup();
    const task = await env.create('url');
    const original = env.repository.save.bind(env.repository);
    let failed = false;
    vi.spyOn(env.repository, 'save').mockImplementation((record, revision) => {
      if (record.submitAttempted && !failed) {
        failed = true;
        return Promise.reject(new Error('disk failure'));
      }
      return original(record, revision);
    });
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('disk failure');
    const current = required(env.repository.records.get(task.id));
    expect(current.task.revision).toBe(3); // create, acquire, safe failure receipt.
    expect(current.task.status).toBe('needs-review');
    expect(env.upload).not.toHaveBeenCalled();
  });
  it('does not overwrite a new lease if CAS is lost while saving a successful remote receipt', async () => {
    const env = setup();
    const task = await env.create('url');
    let winner: VideoUploadRecord | undefined;
    env.upload.mockImplementation(() => {
      const current = structuredClone(required(env.repository.records.get(task.id)));
      current.task.revision += 1;
      current.busy = { action: 'verify', until: current.task.updateTimeUtc + 90_000 };
      winner = current;
      env.repository.records.set(task.id, current);
      return Promise.resolve({ accepted: true, traceId: 'fixture-trace' });
    });
    const save = vi.spyOn(env.repository, 'save');
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    expect(env.repository.records.get(task.id)).toEqual(winner);
    expect(save).toHaveBeenCalledTimes(3);
    expect(env.upload).toHaveBeenCalledOnce();
    expect(winner?.submitAttempted).toBe(true);
  });
  it('keeps cancellation unknown until explicit NoSuchUpload and recovery never re-aborts', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    task = await env.call({ action: 'cancel', ...env.target(task) });
    expect(task).toMatchObject({ status: 'needs-review', reasonCode: 'VIDEO_CANCELLATION_PENDING' });
    expect(env.storage.abortMultipart).toHaveBeenCalledOnce();
    task = await env.call({ action: 'reconcile', ...env.target(task) });
    expect(task.status).toBe('needs-review'); // empty != removed
    await expect(
      env.call({
        action: 'part',
        ...env.target(task),
        partNumber: 1,
        fileSha256: hashVideoBytes(env.bytes),
        contentBase64: fixture.mp4Base64
      })
    ).rejects.toThrow('VIDEO_CANCELLATION_PENDING');
    task = required(env.repository.records.get(task.id)).task;
    vi.mocked(env.storage.listParts).mockResolvedValue(null);
    task = await env.call({ action: 'reconcile', ...env.target(task) });
    expect(task).toMatchObject({ status: 'cancelled', reasonCode: null });
    expect(env.storage.abortMultipart).toHaveBeenCalledOnce();
    expect(env.storage.uploadPart).not.toHaveBeenCalled();
  });
  it('retains a timed-out abort intent and handles only read-only reconciliation on resume', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    vi.mocked(env.storage.abortMultipart).mockRejectedValue(new Error('timeout'));
    await expect(env.call({ action: 'cancel', ...env.target(task) })).rejects.toThrow('timeout');
    const current = required(env.repository.records.get(task.id));
    expect(current.cancelAttempted).toBe(true);
    expect(current.task.reasonCode).toBe('VIDEO_CANCELLATION_PENDING');
    vi.mocked(env.storage.listParts).mockResolvedValue(null);
    task = await env.call({ action: 'reconcile', ...env.target(current.task) });
    expect(task.status).toBe('cancelled');
    expect(env.storage.abortMultipart).toHaveBeenCalledOnce();
  });
  it('does not call a lost multipart initiation cancelled without an identifiable upload', async () => {
    const env = setup();
    let task = await env.create();
    vi.mocked(env.storage.createMultipart).mockRejectedValue(new Error('timeout'));
    await expect(env.call({ action: 'initiate', ...env.target(task) })).rejects.toThrow('timeout');
    task = required(env.repository.records.get(task.id)).task;
    await expect(env.call({ action: 'cancel', ...env.target(task) })).rejects.toThrow(
      'VIDEO_CANCELLATION_PENDING'
    );
    expect(env.repository.records.get(task.id)?.task.status).toBe('needs-review');
    expect(env.storage.abortMultipart).not.toHaveBeenCalled();
  });
  it('does not make an unknown part retryable when its ListParts response is invalid', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    vi.mocked(env.storage.uploadPart).mockRejectedValue(new Error('timeout'));
    await expect(
      env.call({
        action: 'part',
        ...env.target(task),
        partNumber: 1,
        fileSha256: hashVideoBytes(env.bytes),
        contentBase64: fixture.mp4Base64
      })
    ).rejects.toThrow();
    env.advance(90_001);
    const client = new S3ObjectStorageClient(fixture.configuration, {
      send: () => Promise.resolve(new Response(multipartFixture.html))
    });
    vi.mocked(env.storage.listParts).mockImplementation((...args) => client.listParts(...args));
    task = required(env.repository.records.get(task.id)).task;
    await expect(env.call({ action: 'reconcile', ...env.target(task) })).rejects.toThrow(
      'S3_MULTIPART_RESPONSE_INVALID'
    );
    const current = required(env.repository.records.get(task.id)).task;
    expect(current.parts[0]?.status).toBe('unknown');
    expect(current.status).toBe('needs-review');
    expect(env.storage.uploadPart).toHaveBeenCalledOnce();
  });
  it('persists intent before each write; verifies MP4 object and distinguishes accepted from confirmed', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    vi.mocked(env.storage.uploadPart).mockImplementation(() => {
      expect(env.repository.records.get(task.id)?.task.parts[0]?.status).toBe('in-flight');
      return Promise.resolve({
        partNumber: 1,
        size: env.bytes.length,
        etag: 'part-etag',
        checksumSha256: null
      });
    });
    task = await env.call({
      action: 'part',
      ...env.target(task),
      partNumber: 1,
      fileSha256: hashVideoBytes(env.bytes),
      contentBase64: encodeBase64(env.bytes)
    });
    task = await env.call({ action: 'complete', ...env.target(task) });
    expect(task.status).toBe('staged');
    task = await env.call({ action: 'submit', ...env.target(task), confirmed: true });
    expect(task.status).toBe('accepted');
    expect(task.videoId).toBeNull();
    expect(JSON.stringify([...env.repository.records.values()])).not.toContain('X-Amz');
    expect(JSON.stringify(task)).not.toContain('upload-id');
    env.find.mockResolvedValue([{ id: '123', title: task.title }]);
    task = await env.call({ action: 'verify', ...env.target(task) });
    expect(task).toMatchObject({ status: 'confirmed', videoId: '123' });
    expect(env.upload).toHaveBeenCalledTimes(1);
  });
  it('blocks writes if persistence failed and cannot retry an uncertain platform submission', async () => {
    const env = setup();
    let task = await env.create('url');
    env.repository.failWrites = true;
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('disk full');
    expect(env.upload).not.toHaveBeenCalled();
    env.repository.failWrites = false;
    // The repository still has the original revision.
    env.upload.mockRejectedValue(new Error('timeout with sensitive signed URL'));
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow();
    task = required(await env.repository.get(task.id, 'admin')).task;
    expect(task.status).toBe('needs-review');
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('VIDEO_ALREADY_SUBMITTED');
    expect(env.upload).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...env.repository.records.values()])).not.toContain('sensitive');
  });
  it('reconciles uncertain parts without overwriting them and only aborts the task own unfinished upload', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    vi.mocked(env.storage.uploadPart).mockRejectedValue(new Error('timeout'));
    await expect(
      env.call({
        action: 'part',
        ...env.target(task),
        partNumber: 1,
        fileSha256: hashVideoBytes(env.bytes),
        contentBase64: fixture.mp4Base64
      })
    ).rejects.toThrow();
    task = required(await env.repository.get(task.id, 'admin')).task;
    expect(task.parts[0]?.status).toBe('unknown');
    await expect(
      env.call({
        action: 'part',
        ...env.target(task),
        partNumber: 1,
        fileSha256: hashVideoBytes(env.bytes),
        contentBase64: fixture.mp4Base64
      })
    ).rejects.toThrow('VIDEO_TASK_BUSY');
    env.advance(90_001);
    task = required(await env.repository.get(task.id, 'admin')).task;
    task = await env.call({ action: 'reconcile', ...env.target(task) });
    expect(task.parts[0]?.status).toBe('pending');
    vi.mocked(env.storage.listParts).mockResolvedValue(null);
    task = await env.call({ action: 'cancel', ...env.target(task) });
    expect(task.status).toBe('cancelled');
    expect(env.storage.abortMultipart).toHaveBeenCalledExactlyOnceWith(
      task.objectKey,
      'upload-id',
      expect.any(String)
    );
  });
  it('rejects changed context, changed file, missing confirmation and a closed platform gate', async () => {
    const env = setup(false);
    const task = await env.create('url');
    await expect(
      env.call({ action: 'submit', ...env.target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('VIDEO_UPLOAD_DISABLED');
    await expect(
      env.service.execute('admin', {
        requestId: crypto.randomUUID(),
        context: { ...fixture.context, gateway: 'different' },
        command: { action: 'list' }
      })
    ).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    await expect(
      env.service.execute('admin', {
        requestId: crypto.randomUUID(),
        context: fixture.context,
        command: { action: 'submit', ...env.target(task) }
      })
    ).rejects.toThrow('REQUEST_CONTRACT_INVALID');
    expect(env.upload).not.toHaveBeenCalled();
    const file = await env.create();
    await expect(env.call({ action: 'initiate', ...env.target(file) })).rejects.toThrow(
      'VIDEO_UPLOAD_DISABLED'
    );
    expect(env.storage.createMultipart).not.toHaveBeenCalled();
  });
  it('never re-completes after metadata 403; read-only reconciliation still requires the full SHA', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    task = await env.call({
      action: 'part',
      ...env.target(task),
      partNumber: 1,
      fileSha256: hashVideoBytes(env.bytes),
      contentBase64: fixture.mp4Base64
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(new Uint8Array([0]), {
            status: 206,
            headers: { 'Content-Range': `bytes 0-0/${env.bytes.byteLength}` }
          })
        )
      );
    const client = new S3ObjectStorageClient(fixture.configuration, { send });
    vi.mocked(env.storage.headVideoObject).mockImplementation((...args) => client.headVideoObject(...args));
    await expect(env.call({ action: 'complete', ...env.target(task) })).rejects.toMatchObject({
      gatewayError: { subCode: 'HTTP_403:UnknownProviderError' }
    });
    let record = required(env.repository.records.get(task.id));
    expect(record.completeAttempted).toBe(true);
    expect(record.task.status).toBe('needs-review');
    expect(env.storage.getVideoRange).not.toHaveBeenCalled();
    await expect(env.call({ action: 'complete', ...env.target(record.task) })).rejects.toThrow(
      'VIDEO_RECONCILIATION_REQUIRED'
    );
    record = required(env.repository.records.get(task.id));
    vi.mocked(env.storage.getVideoRange).mockResolvedValueOnce(new Uint8Array(env.bytes.length));
    await expect(env.call({ action: 'reconcile', ...env.target(record.task) })).rejects.toThrow(
      'VIDEO_FILE_CHANGED'
    );
    record = required(env.repository.records.get(task.id));
    task = await env.call({ action: 'reconcile', ...env.target(record.task) });
    expect(task.status).toBe('staged');
    expect(env.storage.getVideoRange).toHaveBeenCalledTimes(2);
    expect(env.storage.completeMultipart).toHaveBeenCalledTimes(1);
    expect(env.storage.abortMultipart).not.toHaveBeenCalled();
    expect(env.upload).not.toHaveBeenCalled();
    expect(send.mock.calls.every((call) => (call[1] as RequestInit).method === 'GET')).toBe(true);
  });
  it('retains completed private S3 objects when cancelling before platform submission', async () => {
    const env = setup();
    let task = await env.create();
    task = await env.call({ action: 'initiate', ...env.target(task) });
    task = await env.call({
      action: 'part',
      ...env.target(task),
      partNumber: 1,
      fileSha256: hashVideoBytes(env.bytes),
      contentBase64: fixture.mp4Base64
    });
    task = await env.call({ action: 'complete', ...env.target(task) });
    task = await env.call({ action: 'cancel', ...env.target(task) });
    expect(task.status).toBe('cancelled');
    expect(env.storage.abortMultipart).not.toHaveBeenCalled();
    expect(env.upload).not.toHaveBeenCalled();
  });
  it.each([
    { runtime: 'node', environment: 'local-node' },
    { runtime: 'extension', environment: 'extension' }
  ] as const)(
    'enables verified $runtime defaults without an acceptance override but respects pause',
    (input) => {
      expect(isVideoUploadRuntimeEnabled(input)).toBe(true);
      for (const localAcceptance of [false, true]) {
        expect(isVideoUploadRuntimeEnabled({ ...input, localAcceptance })).toBe(true);
        expect(isVideoUploadRuntimeEnabled({ ...input, localAcceptance, paused: true })).toBe(false);
      }
      expect(isVideoUploadRuntimeEnabled({ ...input, paused: true })).toBe(false);
    }
  );
  it('keeps staging/production, cloud self-hosted and mismatched runtimes closed despite local overrides', () => {
    for (const runtime of ['node', 'cloudflare', 'extension'] as const)
      for (const environment of ['staging', 'production', 'self-hosted', 'unknown']) {
        expect(isVideoUploadRuntimeEnabled({ runtime, environment })).toBe(false);
        for (const localAcceptance of [false, true])
          expect(isVideoUploadRuntimeEnabled({ runtime, environment, localAcceptance })).toBe(false);
      }
    for (const input of [
      { runtime: 'node', environment: 'extension' },
      { runtime: 'extension', environment: 'local-node' },
      { runtime: 'cloudflare', environment: 'local-node' },
      { runtime: 'cloudflare', environment: 'extension' }
    ] as const)
      expect(isVideoUploadRuntimeEnabled({ ...input, localAcceptance: true })).toBe(false);
  });
  it('keeps an accepted upload pending for at most five minutes without resubmission', async () => {
    const env = setup();
    let task = await env.create('url');
    task = await env.call({
      action: 'submit',
      ...env.target(task),
      confirmed: true,
      sourceUrl: fixture.sourceUrl
    });
    task = await env.call({ action: 'verify', ...env.target(task) });
    expect(task.status).toBe('accepted');
    env.advance(300_001);
    task = await env.call({ action: 'verify', ...env.target(task) });
    expect(task.status).toBe('needs-review');
    expect(env.upload).toHaveBeenCalledOnce();
  });
});

describe('video bounds and S3 multipart transport', () => {
  it('requires matching list root, upload/bucket/key and complete pagination evidence', async () => {
    const send = vi.fn().mockImplementation(() => Promise.resolve(new Response(multipartFixture.empty)));
    const client = new S3ObjectStorageClient(fixture.configuration, { send });
    const list = () => client.listParts(multipartFixture.key, multipartFixture.uploadId, crypto.randomUUID());
    await expect(list()).resolves.toEqual([]);
    const invalid = [
      multipartFixture.html,
      multipartFixture.incomplete,
      multipartFixture.duplicateRoot,
      multipartFixture.entity,
      multipartFixture.empty.replace('fixture-upload-id', 'wrong-upload'),
      multipartFixture.empty.replace('<Bucket>video-tests</Bucket>', '<Bucket>other</Bucket>'),
      multipartFixture.empty.replace('tests/onevegetable', 'other/onevegetable'),
      multipartFixture.empty.replace('<IsTruncated>false</IsTruncated>', ''),
      multipartFixture.empty.replace('<IsTruncated>false</IsTruncated>', '<IsTruncated>true</IsTruncated>'),
      multipartFixture.empty.replace(
        '<PartNumberMarker>0</PartNumberMarker>',
        '<PartNumberMarker>1</PartNumberMarker>'
      ),
      multipartFixture.empty.replace('<MaxParts>1000</MaxParts>', ''),
      multipartFixture.empty.replace(
        '</ListPartsResult>',
        '<UploadId>fixture-upload-id</UploadId></ListPartsResult>'
      ),
      multipartFixture.empty.replace(
        '</ListPartsResult>',
        `${multipartFixture.part}${multipartFixture.part}</ListPartsResult>`
      )
    ];
    for (const body of invalid) {
      send.mockImplementation(() => Promise.resolve(new Response(body)));
      await expect(list(), body).rejects.toThrow();
    }
    send.mockImplementation(() =>
      Promise.resolve(
        new Response(
          multipartFixture.empty.replace('</ListPartsResult>', `${multipartFixture.part}</ListPartsResult>`)
        )
      )
    );
    await expect(list()).resolves.toMatchObject([{ partNumber: 1, size: 24, etag: 'fixture-etag' }]);
  });
  it('only recognizes a validated 404 NoSuchUpload, never generic 404/HTML or a success-body error', async () => {
    const send = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(multipartFixture.noSuchUpload, { status: 404 }))
      );
    const client = new S3ObjectStorageClient(fixture.configuration, { send });
    const list = () => client.listParts(multipartFixture.key, multipartFixture.uploadId, crypto.randomUUID());
    await expect(list()).resolves.toBeNull();
    for (const [body, status] of [
      [multipartFixture.noSuchBucket, 404],
      [multipartFixture.html, 404],
      [multipartFixture.noSuchUpload, 200],
      [multipartFixture.noSuchUpload.replace('fixture-upload-id', 'other'), 404]
    ] as const) {
      send.mockImplementation(() => Promise.resolve(new Response(body, { status })));
      await expect(list()).rejects.toThrow();
    }
  });
  it('checks the signed source anonymously at its original origin without redirects or credentials', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(new Response(Uint8Array.from(decodeBase64(fixture.mp4Base64)), { status: 206 }));
    const client = new S3ObjectStorageClient(fixture.configuration, { send });
    const url = await client.presignVideoGet('video.mp4');
    await client.checkPresignedVideoGet(url, crypto.randomUUID());
    const init = send.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(new Headers(init.headers).get('Range')).toBe('bytes=0-4095');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('manual');
    await expect(
      client.checkPresignedVideoGet(
        url.replace(fixture.configuration.endpoint, 'https://changed.example.test'),
        crypto.randomUUID()
      )
    ).rejects.toThrow('VIDEO_PUBLIC_SOURCE_REQUIRED');
    expect(send).toHaveBeenCalledOnce();
  });
  it('checks MIME, MP4 brand, 50 MiB bound and reselected fingerprint', async () => {
    const bytes = Uint8Array.from(decodeBase64(fixture.mp4Base64));
    const file = new File([bytes], 'sample.mp4', { type: 'video/mp4' });
    expect((await fingerprintVideoFile(file)).byteLength).toBe(bytes.length);
    const bad = Uint8Array.from(bytes);
    bad[8] = 0x71;
    bad[9] = 0x74;
    expect(() => {
      assertMp4Header(bad);
    }).toThrow('VIDEO_FILE_INVALID');
    await expect(
      fingerprintVideoFile(new File([bytes], 'sample.mp4', { type: 'text/plain' }))
    ).rejects.toThrow('VIDEO_FILE_INVALID');
    await expect(
      fingerprintVideoFile(
        new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.mp4', { type: 'video/mp4' })
      )
    ).rejects.toThrow('VIDEO_FILE_INVALID');
    const env = setup();
    const task = await env.create();
    await expect(
      verifyReselectedVideo(new File([bytes, new Uint8Array([1])], 'sample.mp4', { type: 'video/mp4' }), task)
    ).rejects.toThrow('VIDEO_FILE_CHANGED');
  });
  it('signs bounded parts once, rejects embedded completion errors and keeps presigned endpoint', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(fixture.multipartCreated))
      .mockResolvedValueOnce(new Response('', { headers: { ETag: '"etag"' } }))
      .mockResolvedValueOnce(new Response(fixture.multipartEmbeddedError));
    const client = new S3ObjectStorageClient(fixture.configuration, { send });
    const id = crypto.randomUUID();
    const key = 'onevegetable/video-staging/task/source.mp4';
    expect(await client.createMultipart(key, id)).toBe('fixture-upload-id');
    const initiation = send.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(initiation?.body).toBeInstanceOf(Uint8Array);
    expect(initiation?.body).toHaveProperty('byteLength', 0);
    const part = await client.uploadPart(key, 'fixture-upload-id', 1, decodeBase64(fixture.mp4Base64), id);
    await expect(client.completeMultipart(key, 'fixture-upload-id', [part], id)).rejects.toMatchObject({
      gatewayError: { code: 'S3_REQUEST_FAILED', retryable: false }
    });
    await expect(
      client.uploadPart(key, 'fixture-upload-id', 1, new Uint8Array(VIDEO_UPLOAD_PART_BYTES + 1), id)
    ).rejects.toThrow('VIDEO_PART_INVALID');
    expect(send).toHaveBeenCalledTimes(3);
    const presigned = new URL(await client.presignVideoGet(key));
    expect(presigned.origin).toBe(fixture.configuration.endpoint);
    expect(presigned.pathname).toBe(`/video-tests/tests/${key}`);
    expect(presigned.searchParams.get('X-Amz-Expires')).toBe('1800');
  });
  it('video metadata inspects a large object without relaxing the normal 5 MiB photo budget', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0]), {
          status: 206,
          headers: { 'Content-Range': `bytes 0-0/${50 * 1024 * 1024}`, 'Content-Length': '1' }
        })
      )
      .mockResolvedValue(new Response(null, { headers: { 'Content-Length': String(50 * 1024 * 1024) } }));
    const client = new S3ObjectStorageClient(fixture.configuration, { send });
    await expect(client.headVideoObject('video.mp4', crypto.randomUUID())).resolves.toMatchObject({
      size: 50 * 1024 * 1024
    });
    await expect(client.getObject('video.mp4')).rejects.toThrow();
    await expect(
      client.putObject({
        key: 'photo.jpg',
        bytes: new Uint8Array(VIDEO_UPLOAD_PART_BYTES + 1),
        contentType: 'image/jpeg'
      })
    ).rejects.toThrow(/5 MiB/u);
  });
});
