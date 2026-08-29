import { afterEach, describe, expect, it } from 'vitest';

import { EmergencyPauseFeatureFlags, StaticOperationFeatureFlags, authorizeOperation } from '../src/abac';
import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { createSqliteMetadataRepository, EntityVersionConflictError } from '../src/db/repository';
import { RealMutationControlService } from '../src/safety/real-mutation-control';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

function fixture() {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const flags = new EmergencyPauseFeatureFlags(
    new StaticOperationFeatureFlags(new Set(['operation:updateProduct']))
  );
  const service = new RealMutationControlService(createSqliteMetadataRepository(database.db), flags);
  return { flags, service };
}

describe('real mutation emergency control', () => {
  it('overrides every configured mutation flag and restores only the original whitelist', async () => {
    const { flags, service } = fixture();
    const principal = {
      actorId: 'admin-1',
      username: 'admin',
      role: 'admin' as const,
      source: 'bff' as const
    };
    expect(authorizeOperation(principal, 'updateProduct', {}, flags).allowed).toBe(true);

    const paused = await service.set({
      paused: true,
      expectedRevision: null,
      actorId: principal.actorId,
      remark: 'incident'
    });
    expect(paused).toMatchObject({ paused: true, revision: 1, remark: 'incident' });
    expect(authorizeOperation(principal, 'updateProduct', {}, flags)).toEqual({
      allowed: false,
      reasonCode: 'REAL_MUTATIONS_PAUSED'
    });

    const resumed = await service.set({
      paused: false,
      expectedRevision: paused.revision,
      actorId: principal.actorId,
      remark: 'reviewed'
    });
    expect(resumed.revision).toBe(2);
    expect(authorizeOperation(principal, 'updateProduct', {}, flags).allowed).toBe(true);
    expect(authorizeOperation(principal, 'createProductGroup', {}, flags).reasonCode).toBe(
      'MUTATION_FLAG_DISABLED'
    );
  });

  it('rejects stale revisions', async () => {
    const { service } = fixture();
    await service.set({ paused: true, expectedRevision: null, actorId: 'admin-1', remark: null });
    await expect(
      service.set({ paused: false, expectedRevision: null, actorId: 'admin-1', remark: null })
    ).rejects.toBeInstanceOf(EntityVersionConflictError);
  });

  it('requires an admin CSRF mutation and records the pause through the HTTP contract', async () => {
    database = openNodeDatabase(':memory:');
    applyNodeMigrations(database);
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({ repository: authRepository, bootstrapToken: 'bootstrap-secret' });
    const flags = new EmergencyPauseFeatureFlags(
      new StaticOperationFeatureFlags(new Set(['operation:updateProduct']))
    );
    const service = new RealMutationControlService(createSqliteMetadataRepository(database.db), flags);
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'mock',
      authService,
      adminService: new AdminService(authRepository),
      featureFlags: flags,
      realMutationControl: service
    });
    const authenticated = await authService.bootstrap({
      requestId: crypto.randomUUID(),
      bootstrapToken: 'bootstrap-secret',
      username: 'admin',
      password: 'correct-password-value'
    });
    const requestId = crypto.randomUUID();
    const response = await app.request('/api/v1/admin/real-mutations/pause/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: `ov_session=${authenticated.sessionToken}`,
        Origin: 'http://localhost',
        'X-CSRF-Token': authenticated.session.csrfToken
      },
      body: JSON.stringify({ requestId, paused: true, revision: null, remark: 'incident' })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId,
      ok: true,
      data: { paused: true, revision: 1 }
    });
    expect(flags.isPaused()).toBe(true);
  });
});
