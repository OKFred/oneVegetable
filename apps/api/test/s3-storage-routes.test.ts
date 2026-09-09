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

async function fixture() {
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
    gatewayMode: 'mock',
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
