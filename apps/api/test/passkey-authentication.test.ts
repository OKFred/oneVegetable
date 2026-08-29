import { afterEach, describe, expect, it } from 'vitest';

import { createEntityAuditFields, createRequestId } from '@one-vegetable/core';
import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlPasskeyRepository } from '../src/auth/passkey-repository';
import { PasskeyService } from '../src/auth/passkey-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

function fixture() {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const repository = new SqlPasskeyRepository(database.executor);
  const authService = new AuthService({
    repository: authRepository,
    bootstrapToken: 'bootstrap-token-with-at-least-32-bytes',
    authenticationMode: 'passkey'
  });
  const passkeyService = new PasskeyService(
    repository,
    authRepository,
    authService,
    'bootstrap-token-with-at-least-32-bytes'
  );
  const app = createApiApp({
    runtime: 'cloudflare',
    database: 'd1',
    environment: 'self-hosted',
    gatewayMode: 'mock',
    authenticationMode: 'passkey',
    authService,
    adminService: new AdminService(authRepository),
    passkeyService
  });
  return { app, authRepository, authService, passkeyService, repository };
}

describe('Passkey persistence and public ceremonies', () => {
  it('persists a challenge and consumes it exactly once', async () => {
    const { repository } = fixture();
    const now = 1_000;
    await repository.createChallenge(
      {
        id: 'challenge-1',
        challenge: 'random-challenge',
        kind: 'login',
        userId: null,
        username: null,
        rpId: 'example.com',
        origin: 'https://example.com',
        context: {},
        expiresTimeUtc: now + 60_000
      },
      now
    );

    await expect(repository.takeChallenge('challenge-1', 'login', now + 1)).resolves.toMatchObject({
      challenge: 'random-challenge',
      rpId: 'example.com'
    });
    await expect(repository.takeChallenge('challenge-1', 'login', now + 2)).resolves.toBeNull();
  });

  it('hashes recovery material externally and enforces one-time consumption', async () => {
    const { authRepository, repository } = fixture();
    const user = await authRepository.createUser({
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash: 'passkey-only',
      passwordSalt: 'not-used',
      passwordLoginEnabled: false,
      role: 'admin',
      status: 'active',
      audit: createEntityAuditFields('system:bootstrap', 1)
    });
    await repository.replaceRecoveryCodes(user.id, ['hash-a', 'hash-b'], 2);
    await expect(repository.hasRecoveryCode(user.id, 'hash-a')).resolves.toBe(true);
    await expect(repository.consumeRecoveryCode(user.id, 'hash-a', 3)).resolves.toBe(true);
    await expect(repository.consumeRecoveryCode(user.id, 'hash-a', 4)).resolves.toBe(false);
    await expect(repository.hasRecoveryCode(user.id, 'hash-a')).resolves.toBe(false);
  });

  it('returns Passkey mode and creates RP-bound registration options', async () => {
    const { app } = fixture();
    const status = await app.request('/api/v1/auth/bootstrap/status/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: createRequestId() })
    });
    await expect(status.json()).resolves.toMatchObject({
      ok: true,
      data: { authenticationMode: 'passkey', bootstrapAvailable: true }
    });

    const options = await app.request('/api/v1/auth/passkey/bootstrap/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://localhost' },
      body: JSON.stringify({
        requestId: createRequestId(),
        bootstrapToken: 'bootstrap-token-with-at-least-32-bytes',
        username: 'admin'
      })
    });
    expect(options.status).toBe(200);
    const payload: unknown = await options.json();
    if (!isRecord(payload) || !isRecord(payload.data)) throw new Error('Passkey options 响应无效');
    expect(payload.ok).toBe(true);
    expect(typeof payload.data.challengeId).toBe('string');
    expect(payload.data.options).toMatchObject({
      rp: { id: 'localhost', name: 'oneVegetable' },
      user: { name: 'admin' }
    });
  });

  it('rejects all password login before invoking PBKDF2 in Passkey mode', async () => {
    const { authRepository, authService } = fixture();
    await authRepository.createUser({
      id: crypto.randomUUID(),
      username: 'admin',
      passwordHash: 'deliberately-invalid',
      passwordSalt: 'deliberately-invalid',
      passwordLoginEnabled: false,
      role: 'admin',
      status: 'active',
      audit: createEntityAuditFields('system:bootstrap', 1)
    });

    await expect(
      authService.login({ requestId: createRequestId(), username: 'admin', password: 'irrelevant-value' })
    ).rejects.toMatchObject({ code: 'PASSWORD_LOGIN_DISABLED', status: 403 });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
