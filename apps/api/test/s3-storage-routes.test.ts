import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestId } from '@one-vegetable/core';
import { requireGalleryContext } from '@one-vegetable/core/gallery-transfer-context';

import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  S3StorageConfigurationCipher,
  S3StorageConfigurationService,
  SqlS3StorageConfigurationRepository
} from '../src/storage/s3-configuration';

import type { NetworkTransport } from '@one-vegetable/core';
import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

describe('S3 storage admin routes', () => {
  it('browses S3 with its own context and no Alibaba gateway credentials', async () => {
    const { app, authService, service, send } = await fixture('disabled');
    const session = await bootstrap(authService);
    await service.save({
      configuration: configuration(),
      actorId: session.user.id,
      expectedRevision: null,
      remark: null
    });
    const summary = await service.summary();
    expect(summary.configurationId).toMatch(/^[a-f0-9]{64}$/u);
    const call = (storageContext: string | undefined) =>
      app.request('/api/v1/admin/storage/s3/objects/list', {
        method: 'POST',
        headers: authHeaders(session.sessionToken),
        body: JSON.stringify({
          requestId: createRequestId(),
          prefix: '',
          delimiter: '/',
          maximum: 100,
          storageContext
        })
      });
    const invalid = await call('invalid');
    expect(invalid.status).toBe(400);
    const stale = await call('f'.repeat(64));
    expect(stale.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
    const result = await call(summary.configurationId ?? undefined);
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      ok: true,
      data: { items: [{ key: 'a.jpg', size: 12 }], prefixes: [], nextContinuationToken: null }
    });
    expect(send).toHaveBeenCalledOnce();
    const captured = send.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(captured[0] instanceof Request ? captured[0].url : captured[0].toString()).toContain(
      'delimiter=%2F'
    );
  });
  it('creates empty folders without overwriting and requires CSRF before any PUT', async () => {
    const { app, authService, service, send } = await fixture('disabled');
    const session = await bootstrap(authService);
    const summary = await service.save({
      configuration: configuration(),
      actorId: session.user.id,
      expectedRevision: null,
      remark: null
    });
    const input = {
      requestId: createRequestId(),
      key: 'new-folder/',
      contentBase64: '',
      contentType: 'application/x-directory',
      directory: true,
      createOnly: true,
      storageContext: summary.configurationId
    };
    const denied = await app.request('/api/v1/admin/storage/s3/objects/put', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify(input)
    });
    expect(denied.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    send.mockImplementation(() => Promise.resolve(new Response('', { headers: { etag: '"folder"' } })));
    const created = await app.request('/api/v1/admin/storage/s3/objects/put', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify(input)
    });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      ok: true,
      data: { key: 'new-folder/', etag: 'folder' }
    });
    const captured = send.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(captured[0] instanceof Request ? captured[0].url : captured[0].toString()).toContain(
      '/gallery/new-folder/'
    );
    expect(new Headers(captured[1].headers).get('if-none-match')).toBe('*');
    send.mockClear();
    send.mockImplementation(() =>
      Promise.resolve(new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 }))
    );
    const exists = await app.request('/api/v1/admin/storage/s3/objects/put', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify(input)
    });
    expect(exists.status).toBe(409);
    await expect(exists.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'S3_OBJECT_EXISTS', retryable: false }
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('blocks storage configuration changes before a file request leaves the server', async () => {
    const { app, authService, service, send } = await fixture('disabled');
    const session = await bootstrap(authService);
    const original = await service.save({
      configuration: configuration(),
      actorId: session.user.id,
      expectedRevision: null,
      remark: null
    });
    await service.save({
      configuration: { ...configuration(), rootPrefix: 'new-root' },
      actorId: session.user.id,
      expectedRevision: original.revision,
      remark: null
    });
    const result = await app.request('/api/v1/admin/storage/s3/objects/get', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        key: 'a.jpg',
        storageContext: original.configurationId
      })
    });
    expect(result.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it('returns opaque context and rejects stale configuration before network', async () => {
    const { app, authService, service, send } = await fixture();
    const session = await bootstrap(authService);
    await service.save({
      configuration: configuration(),
      actorId: session.user.id,
      expectedRevision: null,
      remark: null
    });
    const requestId = createRequestId();
    const response = await app.request('/api/v1/gallery-transfers/context/get', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({ requestId })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-ID')).toBe(requestId);
    const result: unknown = await response.json();
    expect(result).toMatchObject({ requestId, ok: true });
    if (typeof result !== 'object' || !result || !('data' in result)) throw new Error('context missing');
    expect(requireGalleryContext(result.data).identity).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('secret-value');
    const denied = await app.request('/api/v1/admin/storage/s3/objects/get', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        key: 'test.jpg',
        galleryContext: { identity: 'wrong', gateway: 'wrong', storage: 'wrong' }
      })
    });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ ok: false, error: { code: 'GALLERY_CONTEXT_CHANGED' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('requires CSRF for secrets and returns only redacted configuration', async () => {
    const { app, authService, repository } = await fixture();
    const session = await bootstrap(authService);
    const request = {
      requestId: createRequestId(),
      configuration: configuration(),
      revision: null,
      remark: null
    };
    const denied = await app.request('/api/v1/admin/storage/s3/update', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify(request)
    });
    expect(denied.status).toBe(403);

    const saved = await app.request('/api/v1/admin/storage/s3/update', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify(request)
    });
    const body = await saved.text();
    expect(saved.status).toBe(200);
    expect(body).not.toContain('secret-value');
    expect(body).not.toContain('test-access-key');
    expect(JSON.parse(body)).toMatchObject({
      ok: true,
      data: { configured: true, accessKeyIdSuffix: '-key', revision: 1 }
    });
    expect((await repository.find())?.encryptedConfiguration).not.toContain('secret-value');
  });

  it('tests the signed connection and lists objects without exposing credentials', async () => {
    const { app, authService, service, send } = await fixture();
    const session = await bootstrap(authService);
    await service.save({
      configuration: configuration(),
      actorId: session.user.id,
      expectedRevision: null,
      remark: null
    });
    const response = await app.request('/api/v1/admin/storage/s3/test', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({ requestId: createRequestId() })
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { connected: true, visibleObjectCount: 1 }
    });
    expect(
      new Headers((send.mock.calls[0] as [RequestInfo | URL, RequestInit])[1].headers).has('authorization')
    ).toBe(true);
  });
});

async function fixture(gatewayMode: 'mock' | 'disabled' = 'mock') {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const authService = new AuthService({
    repository: authRepository,
    bootstrapToken: 'bootstrap-secret-that-is-long'
  });
  const repository = new SqlS3StorageConfigurationRepository(database.executor);
  const send = vi
    .fn()
    .mockResolvedValue(
      new Response(
        '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>gallery/a.jpg</Key><Size>12</Size></Contents></ListBucketResult>',
        { status: 200 }
      )
    );
  const transport: NetworkTransport = { send };
  const service = new S3StorageConfigurationService(
    repository,
    await S3StorageConfigurationCipher.create(encodedKey()),
    Date.now,
    transport
  );
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode,
    authService,
    adminService: new AdminService(authRepository),
    s3Storage: service
  });
  return { app, authService, repository, service, send };
}

function bootstrap(authService: AuthService) {
  return authService.bootstrap({
    requestId: createRequestId(),
    bootstrapToken: 'bootstrap-secret-that-is-long',
    username: 'admin',
    password: 'correct-password-value'
  });
}

function authHeaders(sessionToken: string, csrfToken?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    Cookie: `ov_session=${sessionToken}`,
    Origin: 'http://localhost',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };
}

function configuration() {
  return {
    endpoint: 'https://account.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'gallery-backup',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'secret-value',
    sessionToken: null,
    pathStyle: true,
    rootPrefix: 'gallery'
  } as const;
}

function encodedKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
