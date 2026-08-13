import { afterEach, describe, expect, it } from 'vitest';

import { AuthError, AuthService, LOGIN_LOCK_MILLISECONDS } from '../src/auth/service';
import { SqlAuthRepository } from '../src/auth/repository';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let handle: NodeDatabaseHandle | undefined;

afterEach(() => {
  handle?.connection.close();
  handle = undefined;
});

function fixture() {
  handle = openNodeDatabase(':memory:');
  applyNodeMigrations(handle);
  let now = 1_723_456_789_012;
  const repository = new SqlAuthRepository(handle.executor);
  const service = new AuthService({
    repository,
    bootstrapToken: 'bootstrap-secret-that-is-long',
    clock: () => now
  });
  return { repository, service, setNow: (value: number) => (now = value), now: () => now };
}

describe('AuthService', () => {
  it('bootstraps once, stores only token hashes and validates opaque sessions with CSRF', async () => {
    const { repository, service } = fixture();
    const requestId = crypto.randomUUID();
    const result = await service.bootstrap({
      requestId,
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'Admin.One',
      password: 'a-strong-local-password',
      remark: ' first admin '
    });
    expect(result.user).toMatchObject({ username: 'admin.one', role: 'admin', revision: 1 });
    expect(result.session.sessionId).toBeTruthy();
    expect(result.session.csrfToken).toHaveLength(43);

    const authenticated = await service.authenticate(result.sessionToken);
    expect(authenticated.principal).toMatchObject({ role: 'admin', source: 'bff' });
    await expect(
      service.assertCsrf(authenticated.session, result.session.csrfToken)
    ).resolves.toBeUndefined();
    await expect(service.assertCsrf(authenticated.session, 'wrong')).rejects.toMatchObject({
      code: 'CSRF_INVALID'
    });

    const stored = await repository.findSessionByTokenHash(authenticated.session.tokenHash);
    expect(stored?.session.tokenHash).not.toBe(result.sessionToken);
    expect(stored?.session.csrfTokenHash).not.toBe(result.session.csrfToken);
    await expect(
      service.bootstrap({
        requestId: crypto.randomUUID(),
        bootstrapToken: 'bootstrap-secret-that-is-long',
        username: 'second-admin',
        password: 'another-strong-password'
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_ALREADY_COMPLETED' });
  });

  it('locks after five failures for fifteen minutes and permits login after the lock expires', async () => {
    const { service, setNow, now } = fixture();
    await service.bootstrap({
      requestId: crypto.randomUUID(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value'
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.login({ requestId: crypto.randomUUID(), username: 'admin', password: 'wrong-password-value' })
      ).rejects.toBeInstanceOf(AuthError);
    }
    await expect(
      service.login({ requestId: crypto.randomUUID(), username: 'admin', password: 'correct-password-value' })
    ).rejects.toMatchObject({ code: 'LOGIN_LOCKED' });

    setNow(now() + LOGIN_LOCK_MILLISECONDS + 1);
    await expect(
      service.login({ requestId: crypto.randomUUID(), username: 'admin', password: 'correct-password-value' })
    ).resolves.toMatchObject({ user: { username: 'admin' } });
  }, 15_000);

  it('revokes every session after a password change', async () => {
    const { service } = fixture();
    const first = await service.bootstrap({
      requestId: crypto.randomUUID(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value'
    });
    const authenticated = await service.authenticate(first.sessionToken);
    await service.changePassword({
      requestId: crypto.randomUUID(),
      authenticated,
      currentPassword: 'correct-password-value',
      newPassword: 'new-correct-password-value'
    });
    await expect(service.authenticate(first.sessionToken)).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    await expect(
      service.login({
        requestId: crypto.randomUUID(),
        username: 'admin',
        password: 'new-correct-password-value'
      })
    ).resolves.toMatchObject({ user: { username: 'admin' } });
  });
});
