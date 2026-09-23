import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createEntityAuditFields } from '@one-vegetable/core';
import {
  galleryGatewayId,
  galleryStorageId,
  opaqueGalleryId
} from '@one-vegetable/core/gallery-transfer-context';
import { S3ObjectStorageClient } from '@one-vegetable/core/s3-storage';
import {
  fingerprintVideoFile,
  hashVideoBytes,
  hex,
  VIDEO_UPLOAD_MAX_BYTES,
  VIDEO_UPLOAD_PART_BYTES,
  type VideoUploadCommand,
  type VideoUploadFile,
  type VideoUploadTask
} from '@one-vegetable/core/video-upload';
import { VideoUploadService, type VideoUploadPlatform } from '@one-vegetable/core/video-upload-service';
import { decodeBase64, encodeBase64 } from '../../../packages/core/src/encoded-file';
import type { NetworkTransport } from '../../../packages/core/src/network';
import fixture from '../../../mock/data/video/upload.json';
import multipart from '../../../mock/data/video/multipart-review.json';
import s3Errors from '../../../mock/data/video/s3-errors.json';
import { StaticOperationFeatureFlags } from '../src/abac';
import { sha256Base64Url } from '../src/auth/password';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { openD1Database } from '../src/db/d1-database';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../src/storage/s3-configuration';
import { SqlVideoUploadRepository } from '../src/video-uploads/repository';
import { registerVideoUploadRoutes } from '../src/video-uploads/routes';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing runtime fixture value');
  return value;
}

type Reply = (request: Request) => Response | Promise<Response>;

/** No native transport, retries, fallback fixtures or retained large request bodies. */
class FakeTransport implements NetworkTransport {
  readonly calls: { method: string; url: URL; headers: Headers }[] = [];
  readonly replies: Reply[] = [];

  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
    // Construct a real workerd Request to expose body/stream/RequestInit incompatibilities.
    const request = new Request(input, init);
    const url = new URL(request.url);
    expect(url.origin).toBe(fixture.configuration.endpoint);
    expect(request.headers.has('cookie')).toBe(false);
    this.calls.push({ method: request.method, url, headers: request.headers });
    return required(this.replies.shift())(request);
  }
}

function streamed(bytes: Uint8Array, status = 206): Response {
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 64 * 1024, bytes.byteLength);
        controller.enqueue(Uint8Array.from(bytes.subarray(offset, end)));
        offset = end;
      }
    }),
    { status }
  );
}

function target(task: VideoUploadTask) {
  return { taskId: task.id, revision: task.revision };
}

function setup(enabled = true) {
  const owner = crypto.randomUUID();
  let now = 1_790_000_000_000;
  let context = { ...fixture.context };
  const transport = new FakeTransport();
  const storage = new S3ObjectStorageClient(fixture.configuration, transport);
  const find = vi.fn<VideoUploadPlatform['find']>().mockResolvedValue([]);
  const upload = vi.fn<VideoUploadPlatform['upload']>().mockResolvedValue({
    accepted: true,
    traceId: fixture.uploadAccepted.alibaba_icbu_video_upload_response.request_id
  });
  // Re-open both the repository and service for every command: recovery must come from D1.
  const repository = () => new SqlVideoUploadRepository(openD1Database(env.DB).executor);
  const service = () =>
    new VideoUploadService(
      repository(),
      () => Promise.resolve({ context, storage, platform: { find, upload }, enabled }),
      () => now
    );
  const call = async (command: VideoUploadCommand, requestContext = context, actor: string = owner) =>
    required(
      (await service().execute(actor, { requestId: crypto.randomUUID(), context: requestContext, command }))
        .tasks[0]
    );
  const bytes = decodeBase64(fixture.mp4Base64);
  const file = { fileName: 'runtime.mp4', byteLength: bytes.byteLength, sha256: hashVideoBytes(bytes) };
  const create = (metadata: VideoUploadFile = file) =>
    call({ action: 'create', title: 'Workerd fixture', source: { kind: 'file', file: metadata } });
  const read = async (task: VideoUploadTask) => required(await repository().get(task.id, owner));
  const raw = async (task: VideoUploadTask) =>
    required(
      await env.DB.prepare('SELECT record_json FROM video_upload_tasks WHERE id = ? AND owner_id = ?')
        .bind(task.id, owner)
        .first<string>('record_json')
    );
  const part = (
    task: VideoUploadTask,
    contentBase64 = fixture.mp4Base64
  ): Extract<VideoUploadCommand, { action: 'part' }> => ({
    action: 'part',
    ...target(task),
    partNumber: 1,
    fileSha256: required(task.file).sha256,
    contentBase64
  });
  const initiate = async (task: VideoUploadTask) => {
    transport.replies.push(() => new Response(fixture.multipartCreated));
    return call({ action: 'initiate', ...target(task) });
  };
  const listXml = (task: VideoUploadTask, parts = '') =>
    multipart.empty
      .replace(multipart.key, required(task.objectKey))
      .replace('</ListPartsResult>', `${parts}</ListPartsResult>`);
  return {
    owner,
    transport,
    storage,
    find,
    upload,
    repository,
    service,
    call,
    bytes,
    file,
    create,
    read,
    raw,
    part,
    initiate,
    listXml,
    setContext: (next: typeof context) => {
      context = next;
    },
    advance: () => {
      now += 90_001;
    }
  };
}

function expectPrivateReceipt(text: string): void {
  for (const forbidden of [
    fixture.sourceUrl,
    fixture.configuration.endpoint,
    fixture.configuration.accessKeyId,
    fixture.configuration.secretAccessKey,
    'X-Amz-',
    'Authorization',
    'contentBase64',
    fixture.mp4Base64
  ])
    expect(text).not.toContain(forbidden);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(() => {
  // Fail closed if a regression bypasses the injected transport.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('LIVE_NETWORK_FORBIDDEN')));
});

afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

describe('workerd-local video service with D1 and real S3 signing', () => {
  it('routes read-only reconciliation through injected storage and preserves safe S3 errors with writes closed', async () => {
    const h = setup();
    const executor = openD1Database(env.DB).executor;
    const authRepository = new SqlAuthRepository(executor);
    const now = Date.now();
    // Seed an existing password-disabled session; login/bootstrap are outside this transport test.
    await authRepository.createUser({
      id: h.owner,
      username: `runtime-${h.owner}`,
      passwordHash: '',
      passwordSalt: '',
      passwordLoginEnabled: false,
      role: 'admin',
      status: 'active',
      audit: createEntityAuditFields('runtime-fixture', now)
    });
    const sessionToken = crypto.randomUUID();
    const csrfToken = crypto.randomUUID();
    await authRepository.createSession({
      id: crypto.randomUUID(),
      tokenHash: await sha256Base64Url(sessionToken),
      csrfTokenHash: await sha256Base64Url(csrfToken),
      userId: h.owner,
      absoluteExpiresTimeUtc: now + 60_000,
      idleExpiresTimeUtc: now + 60_000,
      createTimeUtc: now,
      updateTimeUtc: now
    });
    const storage = new S3StorageConfigurationService(
      new SqlS3StorageConfigurationRepository(executor),
      await S3StorageConfigurationCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, '')),
      Date.now,
      h.transport
    );
    await storage.save({
      configuration: fixture.configuration,
      actorId: h.owner,
      expectedRevision: null,
      remark: null
    });
    const credentials = {
      appKey: fixture.configuration.accessKeyId,
      appSecret: fixture.configuration.secretAccessKey,
      accessToken: multipart.uploadId,
      endpoint: fixture.configuration.endpoint,
      signMethod: 'hmac-sha256' as const
    };
    const context = {
      identity: await opaqueGalleryId(h.owner),
      gateway: await galleryGatewayId(credentials),
      storage: await galleryStorageId(fixture.configuration)
    };
    h.setContext(context);
    let task = await h.initiate(await h.create());
    const app = new Hono();
    registerVideoUploadRoutes(app, {
      repository: h.repository(),
      credentials: {
        requireCredentials: () => Promise.resolve(credentials),
        status: () => Promise.reject(new Error('unexpected credentials status request'))
      },
      auth: new AuthService({ repository: authRepository }),
      storage,
      flags: new StaticOperationFeatureFlags(new Set(['method:alibaba.icbu.video.upload'])),
      runtime: 'cloudflare',
      environment: 'self-hosted'
    });
    const call = (command: VideoUploadCommand) =>
      app.request('https://api.example.test/video-uploads/call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://api.example.test',
          Cookie: `ov_session=${sessionToken}`,
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ requestId: crypto.randomUUID(), context, command })
      });
    h.transport.replies.push(() => new Response(h.listXml(task)));
    const reconciled = await call({ action: 'reconcile', ...target(task) });
    expect(reconciled.status).toBe(200);
    expect(await reconciled.json()).toMatchObject({
      ok: true,
      data: { uploadEnabled: false, tasks: [{ id: task.id, status: 'staging' }] }
    });
    task = (await h.read(task)).task;
    const disabled = await call(h.part(task));
    expect(disabled.status).toBe(403);
    expect(await disabled.json()).toMatchObject({ error: { code: 'VIDEO_UPLOAD_DISABLED' } });
    h.transport.replies.push(() => new Response(s3Errors.denied, { status: 403 }));
    const denied = await call({ action: 'reconcile', ...target(task) });
    expect(denied.status).toBe(400);
    const deniedBody = await denied.text();
    expect(JSON.parse(deniedBody)).toMatchObject({
      requestId: denied.headers.get('X-Request-ID'),
      ok: false,
      error: {
        code: 'S3_REQUEST_FAILED',
        message: 'S3_REQUEST_FAILED',
        subCode: 'HTTP_403:AccessDenied',
        retryable: false
      }
    });
    expectPrivateReceipt(deniedBody);
    expect(deniedBody).not.toContain('secret-fixture');
    expectPrivateReceipt(await h.raw(task));
    expect(h.transport.calls.map((call) => call.method)).toEqual(['POST', 'GET', 'GET']);
    expect(h.transport.replies).toHaveLength(0);

    // The factory re-reads configuration; a rotation between context capture and that read fails closed.
    task = (await h.read(task)).task;
    const before = await h.raw(task);
    const requireConfiguration = storage.requireConfiguration.bind(storage);
    vi.spyOn(storage, 'requireConfiguration').mockImplementationOnce(async () => {
      const captured = await requireConfiguration();
      await storage.save({
        configuration: { ...fixture.configuration, rootPrefix: 'rotated-runtime-fixture' },
        actorId: h.owner,
        expectedRevision: 1,
        remark: null
      });
      return captured;
    });
    const changed = await call({ action: 'reconcile', ...target(task) });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: 'GALLERY_CONTEXT_CHANGED' } });
    expect(await h.raw(task)).toBe(before);
    expect(h.transport.calls).toHaveLength(3);
  });

  it('uploads a bounded 5 MiB part and tail, verifies streamed ranges, and keeps credentials out of D1', async () => {
    const h = setup();
    const first = new Uint8Array(VIDEO_UPLOAD_PART_BYTES);
    first.set(h.bytes);
    const file = await fingerprintVideoFile(
      new File([first, Uint8Array.from(h.bytes)], 'runtime.mp4', {
        type: 'video/mp4'
      })
    );
    let task = await h.initiate(await h.create(file));
    const contentBase64 = encodeBase64(first);
    const startedCpuWork = performance.now();
    const firstHash = hashVideoBytes(decodeBase64(contentBase64));
    const synchronousCpuWorkWallMs = performance.now() - startedCpuWork;
    expect(firstHash).toBe(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', first))));
    h.transport.replies.push(async (request) => {
      expect((await h.read(task)).task.parts[0]?.status).toBe('in-flight');
      expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /u);
      expect(request.headers.get('x-amz-checksum-sha256')).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
      const body = new Uint8Array(await request.arrayBuffer());
      expect(body.byteLength).toBe(VIDEO_UPLOAD_PART_BYTES);
      expect(hashVideoBytes(body)).toBe(firstHash);
      return new Response(null, { headers: { ETag: '"runtime-part-1"' } });
    });
    const startedPart = performance.now();
    task = await h.call(h.part(task, contentBase64));
    const partCommandWallMs = performance.now() - startedPart;
    // Local elapsed time of synchronous CPU work is a diagnostic proxy, NOT CPU accounting.
    // https://developers.cloudflare.com/workers/runtime-apis/performance/
    console.info(
      'video-upload-workerd-local-diagnostic',
      JSON.stringify({
        partBytes: first.byteLength,
        synchronousCpuWorkWallMs,
        partCommandWallMs,
        cpuTimeMs: null,
        cloudQuotaEvidence: false
      })
    );
    expect(task.parts[0]).toMatchObject({ status: 'confirmed', sha256: firstHash });
    h.transport.replies.push(async (request) => {
      expect(new URL(request.url).searchParams.get('partNumber')).toBe('2');
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(h.bytes);
      return new Response(null, { headers: { ETag: '"runtime-part-2"' } });
    });
    task = await h.call({ ...h.part(task), partNumber: 2 });
    h.transport.replies.push(
      async (request) => {
        expect((await h.read(task)).completeAttempted).toBe(true);
        expect(await request.text()).toContain('<PartNumber>2</PartNumber>');
        return new Response(fixture.multipartCompleted);
      },
      () => new Response(null, { headers: { 'Content-Length': String(file.byteLength) } }),
      (request) => {
        expect(request.headers.get('range')).toBe(`bytes=0-${VIDEO_UPLOAD_PART_BYTES - 1}`);
        return streamed(first);
      },
      (request) => {
        expect(request.headers.get('range')).toBe(`bytes=${VIDEO_UPLOAD_PART_BYTES}-${file.byteLength - 1}`);
        return streamed(h.bytes);
      }
    );
    task = await h.call({ action: 'complete', ...target(task) });
    expect(task.status).toBe('staged');
    h.transport.replies.push((request) => {
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.get('range')).toBe('bytes=0-4095');
      expect(new URL(request.url).searchParams.has('X-Amz-Signature')).toBe(true);
      return streamed(h.bytes);
    });
    h.upload.mockImplementation(async (url) => {
      expect(new URL(url).origin).toBe(fixture.configuration.endpoint);
      expect((await h.read(task)).submitAttempted).toBe(true);
      return { accepted: true, traceId: 'fixture-trace' };
    });
    task = await h.call({ action: 'submit', ...target(task), confirmed: true });
    expect(task.status).toBe('accepted');
    expect(task.videoId).toBeNull();
    h.find.mockResolvedValue([{ id: '123', title: task.title }]);
    task = await h.call({ action: 'verify', ...target(task) });
    expect(task).toMatchObject({ status: 'confirmed', videoId: '123' });
    expectPrivateReceipt(await h.raw(task));
    expectPrivateReceipt(JSON.stringify(task));
    expect(JSON.stringify(task)).not.toContain(multipart.uploadId);
    expect(h.upload).toHaveBeenCalledOnce();
    expect(h.transport.calls.map((call) => call.method)).toEqual([
      'POST',
      'PUT',
      'PUT',
      'POST',
      'HEAD',
      'GET',
      'GET',
      'GET'
    ]);
    expect(h.transport.replies).toHaveLength(0);
  }, 30_000);

  it('accepts 50 MiB metadata as ten bounded parts and rejects one byte more without S3 writes', async () => {
    const h = setup();
    const task = await h.create({ ...h.file, byteLength: VIDEO_UPLOAD_MAX_BYTES });
    expect(task.parts).toHaveLength(10);
    expect(task.parts.every((part) => part.byteLength === VIDEO_UPLOAD_PART_BYTES)).toBe(true);
    expect((await h.raw(task)).length).toBeLessThan(10_000);
    await expect(h.create({ ...h.file, byteLength: VIDEO_UPLOAD_MAX_BYTES + 1 })).rejects.toThrow(
      'REQUEST_CONTRACT_INVALID'
    );
    h.transport.replies.push(
      () =>
        new Response(null, {
          headers: { 'Content-Length': String(VIDEO_UPLOAD_MAX_BYTES) }
        })
    );
    await expect(
      h.storage.headVideoObject(required(task.objectKey), crypto.randomUUID())
    ).resolves.toMatchObject({
      size: VIDEO_UPLOAD_MAX_BYTES
    });
    h.transport.replies.push(
      () =>
        new Response(null, {
          headers: { 'Content-Length': String(VIDEO_UPLOAD_MAX_BYTES + 1) }
        })
    );
    await expect(h.storage.headVideoObject(required(task.objectKey), crypto.randomUUID())).rejects.toThrow(
      'VIDEO_FILE_INVALID'
    );
    expect(h.transport.calls.map((call) => call.method)).toEqual(['HEAD', 'HEAD']);
  });

  it('rejects oversized decoded parts and normal gallery bodies without expanding the transport budget', async () => {
    const h = setup();
    const task = await h.initiate(await h.create({ ...h.file, byteLength: VIDEO_UPLOAD_MAX_BYTES }));
    const tooLarge = new Uint8Array(VIDEO_UPLOAD_PART_BYTES + 1);
    tooLarge.set(h.bytes);
    await expect(h.call(h.part(task, encodeBase64(tooLarge)))).rejects.toThrow('VIDEO_PART_INVALID');
    await expect(
      h.storage.uploadPart(required(task.objectKey), multipart.uploadId, 1, tooLarge, crypto.randomUUID())
    ).rejects.toThrow('VIDEO_PART_INVALID');
    await expect(
      h.storage.putObject({ key: 'photo.jpg', bytes: tooLarge, contentType: 'image/jpeg' })
    ).rejects.toThrow(/5 MiB/u);
    const current = await h.read(task);
    expect(current.task.parts[0]?.status).toBe('pending');
    expect(h.transport.calls.map((call) => call.method)).toEqual(['POST']);
    h.transport.replies.push(
      () =>
        new Response(null, {
          headers: { 'Content-Length': String(VIDEO_UPLOAD_MAX_BYTES) }
        })
    );
    await expect(h.storage.getObject('video.mp4')).rejects.toMatchObject({
      gatewayError: { code: 'NETWORK_RESPONSE_TOO_LARGE' }
    });
  });

  it.each(['identity', 'gateway', 'storage'] as const)(
    'binds both request and persisted task to %s',
    async (field) => {
      const h = setup();
      const task = await h.create();
      const before = await h.raw(task);
      const changed = { ...fixture.context, [field]: 'changed-context' };
      await expect(h.call({ action: 'initiate', ...target(task) }, changed)).rejects.toThrow(
        'GALLERY_CONTEXT_CHANGED'
      );
      h.setContext(changed);
      await expect(h.call({ action: 'initiate', ...target(task) })).rejects.toThrow(
        'GALLERY_CONTEXT_CHANGED'
      );
      expect(await h.raw(task)).toBe(before);
      expect(h.transport.calls).toHaveLength(0);
    }
  );

  it('preserves owner/revision isolation and the closed runtime gate before external writes', async () => {
    const h = setup(false);
    const task = await h.create();
    const before = await h.raw(task);
    await expect(
      h.call({ action: 'initiate', ...target(task) }, fixture.context, 'other-owner')
    ).rejects.toThrow('VIDEO_TASK_NOT_FOUND');
    await expect(
      h.call({ action: 'initiate', ...target(task), revision: task.revision + 1 })
    ).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    await expect(h.call({ action: 'initiate', ...target(task) })).rejects.toThrow('VIDEO_UPLOAD_DISABLED');
    expect(await h.raw(task)).toBe(before);
    expect(h.transport.calls).toHaveLength(0);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('keeps an uncertain part durable across service recreation and reconciles without resending', async () => {
    const h = setup();
    let task = await h.initiate(await h.create());
    h.transport.replies.push(async () => {
      expect((await h.read(task)).task.parts[0]?.status).toBe('in-flight');
      throw new DOMException('fixture timeout', 'TimeoutError');
    });
    await expect(h.call(h.part(task))).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_TIMEOUT' } });
    let record = await h.read(task);
    task = record.task;
    expect(task).toMatchObject({ status: 'needs-review', parts: [{ status: 'unknown' }] });
    expect(record.busy?.action).toBe('part');
    await expect(h.call({ action: 'reconcile', ...target(task) })).rejects.toThrow('VIDEO_TASK_BUSY');
    h.advance();
    await expect(h.call(h.part(task))).rejects.toThrow('VIDEO_RECONCILIATION_REQUIRED');
    h.transport.replies.push(() => new Response(multipart.html));
    await expect(h.call({ action: 'reconcile', ...target(task) })).rejects.toThrow(
      'S3_MULTIPART_RESPONSE_INVALID'
    );
    task = (await h.read(task)).task;
    expect(task.parts[0]?.status).toBe('unknown');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(h.bytes)));
    const remotePart = multipart.part.replace(
      '</Part>',
      `<ChecksumSHA256>${encodeBase64(digest)}</ChecksumSHA256></Part>`
    );
    h.transport.replies.push(() => new Response(h.listXml(task, remotePart)));
    task = await h.call({ action: 'reconcile', ...target(task) });
    record = await h.read(task);
    expect(task.parts[0]).toMatchObject({ status: 'confirmed', etag: 'fixture-etag' });
    expect(record.busy).toBeNull();
    expect(h.transport.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expectPrivateReceipt(await h.raw(task));
  });

  it('does not repeat uncertain completion; recovery only verifies HEAD and bounded ranges', async () => {
    const h = setup();
    let task = await h.initiate(await h.create());
    h.transport.replies.push(() => new Response(null, { headers: { ETag: '"fixture-etag"' } }));
    task = await h.call(h.part(task));
    h.transport.replies.push(async () => {
      expect((await h.read(task)).completeAttempted).toBe(true);
      throw new DOMException('lost completion response', 'TimeoutError');
    });
    await expect(h.call({ action: 'complete', ...target(task) })).rejects.toThrow();
    task = (await h.read(task)).task;
    await expect(h.call({ action: 'complete', ...target(task) })).rejects.toThrow(
      'VIDEO_RECONCILIATION_REQUIRED'
    );
    task = (await h.read(task)).task;
    h.transport.replies.push(
      () => new Response(null, { headers: { 'Content-Length': String(h.bytes.byteLength) } }),
      () => streamed(h.bytes)
    );
    task = await h.call({ action: 'reconcile', ...target(task) });
    expect(task.status).toBe('staged');
    expect(h.transport.calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'POST', 'HEAD', 'GET']);
  });

  it('persists uncertain platform intent before upload and permits readback but not resubmission', async () => {
    const h = setup();
    let task = await h.call({
      action: 'create',
      title: 'URL fixture',
      source: { kind: 'url', url: fixture.sourceUrl }
    });
    h.upload.mockImplementation(async () => {
      expect((await h.read(task)).submitAttempted).toBe(true);
      throw new Error(`${fixture.sourceUrl}?X-Amz-Signature=${fixture.configuration.secretAccessKey}`);
    });
    await expect(
      h.call({ action: 'submit', ...target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow();
    task = (await h.read(task)).task;
    expect(task.status).toBe('needs-review');
    expectPrivateReceipt(await h.raw(task));
    await expect(
      h.call({ action: 'submit', ...target(task), confirmed: true, sourceUrl: fixture.sourceUrl })
    ).rejects.toThrow('VIDEO_ALREADY_SUBMITTED');
    task = (await h.read(task)).task;
    h.find.mockResolvedValue([{ id: '456', title: task.title }]);
    task = await h.call({ action: 'verify', ...target(task) });
    expect(task).toMatchObject({ status: 'confirmed', videoId: '456' });
    expect(h.upload).toHaveBeenCalledOnce();
    expect(h.transport.calls).toHaveLength(0);
  });

  it('keeps cancellation unknown until explicit NoSuchUpload without re-aborting during recovery', async () => {
    const h = setup();
    let task = await h.initiate(await h.create());
    h.transport.replies.push(
      async () => {
        expect((await h.read(task)).cancelAttempted).toBe(true);
        return new Response(null, { status: 204 });
      },
      () => new Response(h.listXml(task))
    );
    task = await h.call({ action: 'cancel', ...target(task) });
    expect(task).toMatchObject({ status: 'needs-review', reasonCode: 'VIDEO_CANCELLATION_PENDING' });
    h.transport.replies.push(() => new Response(multipart.noSuchBucket, { status: 404 }));
    await expect(h.call({ action: 'reconcile', ...target(task) })).rejects.toThrow();
    task = (await h.read(task)).task;
    expect(task.status).toBe('needs-review');
    h.transport.replies.push(() => new Response(multipart.noSuchUpload, { status: 404 }));
    task = await h.call({ action: 'reconcile', ...target(task) });
    expect(task.status).toBe('cancelled');
    expect(h.transport.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('rejects non-public URL sources before persistence or platform activity', async () => {
    const h = setup();
    for (const url of [
      'http://media.example.test/sample.mp4',
      'https://fixture:secret@media.example.test/sample.mp4',
      'https://localhost/sample.mp4',
      'https://127.0.0.1/sample.mp4',
      'https://10.0.0.1/sample.mp4',
      'https://169.254.169.254/sample.mp4',
      'https://[::1]/sample.mp4',
      `${fixture.sourceUrl}#fragment`
    ]) {
      await expect(
        h.call({ action: 'create', title: 'Invalid URL', source: { kind: 'url', url } }),
        url
      ).rejects.toThrow(
        url.startsWith('http:') ? 'REQUEST_CONTRACT_INVALID' : 'VIDEO_PUBLIC_SOURCE_REQUIRED'
      );
    }
    expect(await h.repository().list(h.owner)).toEqual([]);
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.transport.calls).toHaveLength(0);
  });

  it('rejects redirected anonymous source probes and oversized streamed responses without retry', async () => {
    const h = setup();
    const url = await h.storage.presignVideoGet(multipart.key);
    await expect(
      h.storage.checkPresignedVideoGet(
        url.replace(fixture.configuration.endpoint, 'https://other.example.test'),
        crypto.randomUUID()
      )
    ).rejects.toThrow('VIDEO_PUBLIC_SOURCE_REQUIRED');
    expect(h.transport.calls).toHaveLength(0);
    h.transport.replies.push(
      () => new Response(null, { status: 302, headers: { Location: fixture.sourceUrl } })
    );
    await expect(h.storage.checkPresignedVideoGet(url, crypto.randomUUID())).rejects.toMatchObject({
      gatewayError: { code: 'NETWORK_REDIRECT_DENIED' }
    });
    expect(h.transport.calls[0]?.headers.has('authorization')).toBe(false);
    h.transport.replies.push(() => streamed(new Uint8Array(VIDEO_UPLOAD_PART_BYTES + 1)));
    await expect(
      h.storage.getVideoRange(multipart.key, 0, VIDEO_UPLOAD_PART_BYTES - 1, crypto.randomUUID())
    ).rejects.toMatchObject({ gatewayError: { code: 'NETWORK_RESPONSE_TOO_LARGE' } });
    expect(h.transport.calls).toHaveLength(2);
  });
});
