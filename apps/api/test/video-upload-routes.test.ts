import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALIBABA_GATEWAY } from '@one-vegetable/core';
import {
  galleryGatewayId,
  galleryStorageId,
  opaqueGalleryId
} from '@one-vegetable/core/gallery-transfer-context';
import {
  hashVideoBytes,
  validateVideoUploadResult,
  type VideoUploadCommand,
  type VideoUploadResult
} from '@one-vegetable/core/video-upload';
import { decodeBase64 } from '@one-vegetable/core/runtime';
import fixture from '../../../mock/data/video/upload.json';
import credentialsFixture from '../../../mock/data/node-gateway-credentials.json';
import { registerVideoUploadRoutes } from '../src/video-uploads/routes';
import { SqlVideoUploadRepository } from '../src/video-uploads/repository';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { AdminService } from '../src/auth/admin-service';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../src/storage/s3-configuration';
import { EmergencyPauseFeatureFlags, StaticOperationFeatureFlags } from '../src/abac';

let database: NodeDatabaseHandle | undefined;
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('fixture value missing');
  return value;
}
afterEach(() => {
  database?.connection.close();
  database = undefined;
  vi.restoreAllMocks();
});
async function setup(environment = 'local-node', runtime: 'node' | 'cloudflare' = 'node') {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const auth = new AuthService({ repository: authRepository, bootstrapToken: 'fixture-bootstrap-token' });
  const admin = new AdminService(authRepository);
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'fixture-bootstrap-token',
    username: 'video-admin',
    password: credentialsFixture.workbench.password
  });
  const credentials = {
    appKey: credentialsFixture.manual.appKey,
    appSecret: credentialsFixture.manual.appSecret,
    accessToken: credentialsFixture.manual.accessToken,
    endpoint: ALIBABA_GATEWAY,
    signMethod: 'hmac-sha256' as const
  };
  const requireCredentials = vi.fn().mockResolvedValue(credentials);
  const storage = new S3StorageConfigurationService(
    new SqlS3StorageConfigurationRepository(database.executor),
    await S3StorageConfigurationCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, ''))
  );
  await storage.save({
    configuration: fixture.configuration,
    actorId: session.user.id,
    expectedRevision: null,
    remark: null
  });
  const context = {
    identity: await opaqueGalleryId(session.user.id),
    gateway: await galleryGatewayId(credentials),
    storage: await galleryStorageId(fixture.configuration)
  };
  const flags = new EmergencyPauseFeatureFlags(
    new StaticOperationFeatureFlags(new Set(['method:alibaba.icbu.video.upload']))
  );
  const repository = new SqlVideoUploadRepository(database.executor);
  const app = new Hono();
  registerVideoUploadRoutes(app, {
    repository,
    credentials: {
      requireCredentials,
      status: () =>
        Promise.resolve({
          source: 'environment',
          configured: true,
          hasAppKey: true,
          hasAppSecret: true,
          hasAccessToken: true,
          endpointOrigin: new URL(ALIBABA_GATEWAY).origin,
          signMethod: 'hmac-sha256'
        })
    },
    auth,
    storage,
    flags,
    runtime,
    environment
  });
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost',
    Cookie: `ov_session=${session.sessionToken}`,
    'X-CSRF-Token': session.session.csrfToken
  };
  const call = (
    command: VideoUploadCommand,
    override: Record<string, unknown> = {},
    customHeaders = headers
  ) =>
    app.request('/video-uploads/call', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify({ requestId: crypto.randomUUID(), context, command, ...override })
    });
  return {
    app,
    auth,
    admin,
    session,
    headers,
    context,
    flags,
    storage,
    repository,
    call,
    requireCredentials
  };
}
async function data(response: Response): Promise<VideoUploadResult> {
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('data' in body) || !validateVideoUploadResult(body.data))
    throw new Error('invalid response');
  return body.data as VideoUploadResult;
}
const create: VideoUploadCommand = {
  action: 'create',
  title: 'Fixture video',
  source: { kind: 'url', url: fixture.sourceUrl }
};

describe('video upload trusted routes', () => {
  it('requires an active administrator, origin and CSRF before reading credentials', async () => {
    const env = await setup();
    expect((await env.call(create, {}, { ...env.headers, Cookie: '' })).status).toBe(401);
    expect((await env.call(create, {}, { ...env.headers, 'X-CSRF-Token': '' })).status).toBe(403);
    expect(
      (await env.call(create, {}, { ...env.headers, Origin: 'https://other.example.test' })).status
    ).toBe(403);
    await env.admin.createUser({
      requestId: crypto.randomUUID(),
      actor: env.session.session.principal,
      username: 'video-reader',
      password: credentialsFixture.workbench.password,
      role: 'user'
    });
    const user = await env.auth.login({
      requestId: crypto.randomUUID(),
      username: 'video-reader',
      password: credentialsFixture.workbench.password
    });
    const response = await env.call(
      create,
      {},
      { ...env.headers, Cookie: `ov_session=${user.sessionToken}`, 'X-CSRF-Token': user.session.csrfToken }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'ADMIN_REQUIRED' } });
    expect(env.requireCredentials).not.toHaveBeenCalled();
  });
  it('rejects fake-null and changed storage contexts and retains no URL or secret in durable records', async () => {
    const env = await setup();
    const response = await env.call(create, { context: { ...env.context, storage: null } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'GALLERY_CONTEXT_CHANGED' } });
    const task = required((await data(await env.call(create))).tasks[0]);
    const stored = required(await env.repository.get(task.id, env.session.user.id));
    expect(JSON.stringify(stored)).not.toContain(fixture.sourceUrl);
    expect(JSON.stringify(stored)).not.toContain(credentialsFixture.manual.appSecret);
    expect(await env.repository.get(task.id, 'another-actor')).toBeNull();
    await expect(env.repository.save(stored, 99)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    await env.storage.save({
      configuration: { ...fixture.configuration, rootPrefix: 'changed' },
      actorId: env.session.user.id,
      expectedRevision: 1,
      remark: null
    });
    expect((await env.call({ action: 'get', taskId: task.id })).status).toBe(409);
  });
  it.each(['staging', 'production'])(
    'never opens %s writes even with the local acceptance flag',
    async (environment) => {
      const env = await setup(environment, 'cloudflare');
      const result = await data(await env.call(create));
      expect(result.uploadEnabled).toBe(false);
      const task = required(result.tasks[0]);
      expect(
        (
          await env.call({
            action: 'submit',
            taskId: task.id,
            revision: task.revision,
            confirmed: true,
            sourceUrl: fixture.sourceUrl
          })
        ).status
      ).toBe(403);
    }
  );
  it('stops Alibaba and S3 writes before network while emergency pause is active', async () => {
    const env = await setup();
    const bytes = decodeBase64(fixture.mp4Base64);
    const task = required(
      (
        await data(
          await env.call({
            action: 'create',
            title: 'Fixture',
            source: {
              kind: 'file',
              file: { fileName: 'fixture.mp4', byteLength: bytes.length, sha256: hashVideoBytes(bytes) }
            }
          })
        )
      ).tasks[0]
    );
    env.flags.setPaused(true);
    const response = await env.call({ action: 'initiate', taskId: task.id, revision: task.revision });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'VIDEO_UPLOAD_DISABLED' } });
    expect((await env.repository.get(task.id, env.session.user.id))?.uploadId).toBeNull();
  });
  it('returns safe requestId envelopes for invalid UUIDs, JSON, contracts and oversized input', async () => {
    const env = await setup();
    for (const requestId of [null, 'injected\nheader', '']) {
      const response = await env.call({ action: 'list' }, { requestId });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        requestId: response.headers.get('X-Request-ID'),
        error: { code: 'INVALID_REQUEST_ID' }
      });
    }
    const malformed = await env.app.request('/video-uploads/call', {
      method: 'POST',
      headers: env.headers,
      body: '{'
    });
    expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });
    const oversized = await env.app.request('/video-uploads/call', {
      method: 'POST',
      headers: { ...env.headers, 'Content-Length': String(8 * 1024 * 1024) },
      body: '{}'
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      requestId: oversized.headers.get('X-Request-ID'),
      ok: false,
      error: { code: 'REQUEST_TOO_LARGE' }
    });
    expect(env.requireCredentials).not.toHaveBeenCalled();
  });
});
