import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId } from '@one-vegetable/core';

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
