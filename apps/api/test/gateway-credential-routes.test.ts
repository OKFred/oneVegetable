import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId } from '@one-vegetable/core';
import credentialFixture from '../../../mock/data/node-gateway-credentials.json';

import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

describe('gateway credential admin routes', () => {
  it('supports manual save, CSRF and conflict checks without persisting OAuth evidence', async () => {
    const { app, authService, credentialRepository } = await fixture();
    const session = await bootstrap(authService);
    const request = (revision: number | null, csrf = true) =>
      app.request('/api/v1/admin/gateway-credentials/save', {
        method: 'POST',
        headers: authHeaders(session.sessionToken, csrf ? session.session.csrfToken : undefined),
        body: JSON.stringify({
          requestId: createRequestId(),
          credentials: credentialFixture.manual,
          revision
        })
      });
    expect((await request(null, false)).status).toBe(403);
    const saved = await request(null);
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain(credentialFixture.manual.appSecret);
    expect(text).not.toContain(credentialFixture.manual.accessToken);
    expect(JSON.parse(text)).toMatchObject({
      data: { inputSource: 'manual', canRefresh: false, revision: 1 }
    });
    expect((await request(null)).status).toBe(409);
    expect((await credentialRepository.find())?.schemaVersion).toBe(2);
    const test = await app.request('/api/v1/admin/gateway-credentials/test', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({ requestId: createRequestId() })
    });
    expect(test.status).toBe(403); // test/mock gateway must never access Alibaba
  });

  it('clears legacy configuration using a persistent tombstone and rejects untrusted input', async () => {
    const { app, authService, credentialRepository } = await fixture();
    const session = await bootstrap(authService);
    const headers = authHeaders(session.sessionToken, session.session.csrfToken);
    const invalid = await app.request('/api/v1/admin/gateway-credentials/save', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: createRequestId(),
        credentials: { ...credentialFixture.manual, unexpectedSecret: 'do-not-echo' },
        revision: null
      })
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain('do-not-echo');
    const cleared = await app.request('/api/v1/admin/gateway-credentials/clear', {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: createRequestId(), revision: null })
    });
    expect(cleared.status).toBe(200);
    expect(await credentialRepository.managed()).toBe(true);
  });
  it('requires admin CSRF, imports encrypted credentials and never returns secrets', async () => {
    const { app, authService, credentialRepository } = await fixture();
    const session = await bootstrap(authService);
    const requestId = createRequestId();
    const withoutCsrf = await app.request('/api/v1/admin/gateway-credentials/import', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({ requestId, bundle: bundle(), revision: null, remark: null })
    });
    expect(withoutCsrf.status).toBe(403);

    const response = await app.request('/api/v1/admin/gateway-credentials/import', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({ requestId, bundle: bundle(), revision: null, remark: '生产凭据' })
    });
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).not.toContain('app-secret');
    expect(responseText).not.toContain('access-token');
    expect(JSON.parse(responseText)).toMatchObject({
      ok: true,
      data: { configured: true, revision: 1, remark: '生产凭据' }
    });
    const stored = await credentialRepository.find();
    expect(stored?.encryptedBundle).not.toContain('app-secret');

    const status = await app.request('/api/v1/admin/gateway-credentials/get', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({ requestId: createRequestId() })
    });
    await expect(status.json()).resolves.toMatchObject({
      ok: true,
      data: { configured: true, revision: 1 }
    });
  });

  it('uses revision checks when clearing the vault', async () => {
    const { app, authService, credentialService } = await fixture();
    const session = await bootstrap(authService);
    await credentialService.import({
      bundle: bundle(),
      actorId: session.user.id,
      expectedRevision: null,
      remark: null
    });
    const conflict = await app.request('/api/v1/admin/gateway-credentials/clear', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({ requestId: createRequestId(), revision: 2 })
    });
    expect(conflict.status).toBe(409);

    const cleared = await app.request('/api/v1/admin/gateway-credentials/clear', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({ requestId: createRequestId(), revision: 1 })
    });
    expect(cleared.status).toBe(200);
    await expect(credentialService.status()).resolves.toMatchObject({ configured: false });
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
  const credentialRepository = new SqlGatewayCredentialRepository(database.executor);
  const cipher = await GatewayCredentialCipher.create(encodedKey());
  const credentialService = new GatewayCredentialService(credentialRepository, cipher);
  const credentialProvider = new StoredAlibabaCredentialProvider(credentialRepository, cipher);
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'mock',
    authService,
    adminService: new AdminService(authRepository),
    gatewayCredentialService: credentialService,
    gatewayCredentialProvider: credentialProvider
  });
  return { app, authService, credentialRepository, credentialService };
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

function encodedKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function bundle() {
  return {
    schemaVersion: 1,
    capturedAtUtc: '2026-08-30T00:00:00.000Z',
    application: {
      appName: 'oneVegetable',
      appKey: 'app-key',
      appSecret: 'app-secret',
      callbackUrl: 'https://example.com/callback',
      status: 'Online',
      permissions: []
    },
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtUtc: '2026-08-30T01:00:00.000Z',
      refreshExpiresAtUtc: '2026-09-30T00:00:00.000Z'
    },
    callback: {
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true,
      callbackOrigin: 'https://example.com',
      callbackPath: '/callback'
    }
  };
}
