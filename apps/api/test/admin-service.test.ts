import { afterEach, describe, expect, it } from 'vitest';

import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';

import type { AuthPrincipal } from '../src/auth/types';
import type { NodeDatabaseHandle } from '../src/db/node-database';

let handle: NodeDatabaseHandle | undefined;

afterEach(() => {
  handle?.connection.close();
  handle = undefined;
});

async function fixture() {
  handle = openNodeDatabase(':memory:');
  applyNodeMigrations(handle);
  let now = 1_723_456_789_012;
  const repository = new SqlAuthRepository(handle.executor);
  const auth = new AuthService({ repository, bootstrapToken: 'bootstrap-secret', clock: () => now });
  const bootstrap = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'bootstrap-secret',
    username: 'admin',
    password: 'correct-password-value'
  });
  const principal: AuthPrincipal = bootstrap.session.principal;
  return { repository, service: new AdminService(repository, () => now), principal, tick: () => (now += 1) };
}

describe('AdminService', () => {
  it('creates users with audit fields and prevents disabling the final active admin', async () => {
    const { service, principal } = await fixture();
    const user = await service.createUser({
      requestId: crypto.randomUUID(),
      actor: principal,
      username: 'reader.one',
      password: 'reader-password-value',
      role: 'user',
      remark: ' support team '
    });
    expect(user).toMatchObject({
      username: 'reader.one',
      role: 'user',
      status: 'active',
      creatorId: principal.actorId,
      revision: 1,
      remark: 'support team'
    });

    const admin = (await service.listUsers()).items.find((candidate) => candidate.role === 'admin');
    expect(admin).toBeDefined();
    await expect(
      service.updateUser({
        requestId: crypto.randomUUID(),
        actor: principal,
        userId: admin?.id ?? '',
        role: 'user',
        status: 'active',
        expectedRevision: admin?.revision ?? 0,
        remark: null
      })
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_ADMIN' });
  });

  it('enforces optimistic revisions, revokes sessions on disable and filters audit by requestId', async () => {
    const { repository, service, principal, tick } = await fixture();
    const requestId = crypto.randomUUID();
    const created = await service.createUser({
      requestId,
      actor: principal,
      username: 'reader.two',
      password: 'reader-password-value',
      role: 'user'
    });
    tick();
    const updated = await service.updateUser({
      requestId: crypto.randomUUID(),
      actor: principal,
      userId: created.id,
      role: 'user',
      status: 'disabled',
      expectedRevision: 1,
      remark: 'left team'
    });
    expect(updated).toMatchObject({ status: 'disabled', revision: 2, remark: 'left team' });
    await expect(
      service.updateUser({
        requestId: crypto.randomUUID(),
        actor: principal,
        userId: created.id,
        role: 'user',
        status: 'active',
        expectedRevision: 1,
        remark: null
      })
    ).rejects.toMatchObject({ code: 'ENTITY_VERSION_CONFLICT' });

    const audit = await repository.listAudit({ requestId, page: 1, pageSize: 20 });
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({ action: 'admin.users.create', requestId });
  });
});
