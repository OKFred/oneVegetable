import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId } from '@one-vegetable/core';

import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlRequestEventRepository } from '../src/observability/request-events';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

function fixture() {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const repository = new SqlAuthRepository(database.executor);
  const authService = new AuthService({
    repository,
    bootstrapToken: 'bootstrap-secret-that-is-long'
  });
  const requestEvents = new SqlRequestEventRepository(database.executor);
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'mock',
    authService,
    adminService: new AdminService(repository),
    requestEvents
  });
  return { app, authService, repository, requestEvents };
}

async function bootstrap(authService: AuthService) {
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

describe('authentication and ABAC routes', () => {
  it('exposes bootstrap availability without a session and closes it after initialization', async () => {
    const { app, authService } = fixture();
    const beforeRequestId = createRequestId();
    const before = await app.request('/api/v1/auth/bootstrap/status/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: beforeRequestId })
    });

    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({
      requestId: beforeRequestId,
      ok: true,
      data: {
        initialized: false,
        bootstrapTokenConfigured: true,
        bootstrapAvailable: true
      }
    });

    await bootstrap(authService);
    const after = await app.request('/api/v1/auth/bootstrap/status/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: createRequestId() })
    });
    await expect(after.json()).resolves.toMatchObject({
      ok: true,
      data: { initialized: true, bootstrapTokenConfigured: true, bootstrapAvailable: false }
    });
  });

  it('bootstraps through JSON and returns opaque session and CSRF cookies', async () => {
    const { app } = fixture();
    const requestId = createRequestId();
    const response = await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId,
        bootstrapToken: 'bootstrap-secret-that-is-long',
        username: 'admin',
        password: 'correct-password-value'
      })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-ID')).toBe(requestId);
    const setCookies = response.headers.getSetCookie();
    const cookies = setCookies.join(';');
    expect(cookies).toContain('ov_session=');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('ov_csrf=');
    expect(setCookies.find((cookie) => cookie.startsWith('ov_session='))).toContain('Path=/api/v1');
    expect(setCookies.find((cookie) => cookie.startsWith('ov_csrf='))).toContain('Path=/');
    expect(JSON.stringify(await response.json())).not.toContain('password');
  });

  it('migrates an authenticated legacy CSRF cookie to the web-visible root path', async () => {
    const { app, authService } = fixture();
    const login = await bootstrap(authService);
    const response = await app.request('/api/v1/auth/session/get', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: `ov_session=${login.sessionToken}; ov_csrf=${login.session.csrfToken}`
      },
      body: JSON.stringify({ requestId: createRequestId() })
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().find((cookie) => cookie.startsWith('ov_csrf='))).toContain(
      'Path=/'
    );
  });

  it('rejects weak passwords and oversized remarks as contract errors', async () => {
    const { app } = fixture();
    const weak = await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: createRequestId(),
        bootstrapToken: 'bootstrap-secret-that-is-long',
        username: 'admin',
        password: 'short'
      })
    });
    expect(weak.status).toBe(400);
    await expect(weak.json()).resolves.toMatchObject({ error: { code: 'INVALID_PASSWORD' } });

    const remark = await app.request('/api/v1/auth/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: createRequestId(),
        bootstrapToken: 'bootstrap-secret-that-is-long',
        username: 'admin',
        password: 'correct-password-value',
        remark: '菜'.repeat(501)
      })
    });
    expect(remark.status).toBe(400);
    await expect(remark.json()).resolves.toMatchObject({ error: { code: 'INVALID_REMARK' } });
  });

  it('requires a session for reads and CSRF plus a valid Origin for mutations', async () => {
    const { app, authService } = fixture();
    const login = await bootstrap(authService);
    const read = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: authHeaders(login.sessionToken),
      body: JSON.stringify({ requestId: createRequestId(), operation: 'getDashboard', payload: {} })
    });
    expect(read.status).toBe(200);

    const noSession = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: createRequestId(), operation: 'getDashboard', payload: {} })
    });
    expect(noSession.status).toBe(401);

    const noCsrf = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: authHeaders(login.sessionToken),
      body: JSON.stringify({ requestId: createRequestId(), operation: 'clearDiagnostics', payload: {} })
    });
    expect(noCsrf.status).toBe(403);
    await expect(noCsrf.json()).resolves.toMatchObject({ error: { code: 'CSRF_INVALID' } });
  });

  it('guards management routes, last-admin state and audit lookup', async () => {
    const { app, authService } = fixture();
    const login = await bootstrap(authService);
    const createId = createRequestId();
    const created = await app.request('/api/v1/admin/users/create', {
      method: 'POST',
      headers: authHeaders(login.sessionToken, login.session.csrfToken),
      body: JSON.stringify({
        requestId: createId,
        username: 'reader',
        password: 'reader-password-value',
        role: 'user',
        remark: '只读账号'
      })
    });
    expect(created.status).toBe(200);

    const users = await app.request('/api/v1/admin/users/list', {
      method: 'POST',
      headers: authHeaders(login.sessionToken),
      body: JSON.stringify({ requestId: createRequestId(), page: 1, pageSize: 20 })
    });
    const usersBody = (await users.json()) as {
      data: { items: { id: string; username: string; revision: number }[] };
    };
    expect(usersBody.data.items.map((user) => user.username)).toEqual(['admin', 'reader']);

    const admin = usersBody.data.items.find((user) => user.username === 'admin');
    expect(admin).toBeDefined();
    const disable = await app.request('/api/v1/admin/users/update', {
      method: 'POST',
      headers: authHeaders(login.sessionToken, login.session.csrfToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        userId: admin?.id,
        role: 'user',
        status: 'active',
        revision: admin?.revision,
        remark: null
      })
    });
    expect(disable.status).toBe(409);
    await expect(disable.json()).resolves.toMatchObject({ error: { code: 'LAST_ACTIVE_ADMIN' } });

    const audit = await app.request('/api/v1/admin/audit-events/list', {
      method: 'POST',
      headers: authHeaders(login.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        requestIdFilter: createId,
        page: 1,
        pageSize: 20
      })
    });
    await expect(audit.json()).resolves.toMatchObject({
      ok: true,
      data: { total: 1, items: [{ requestId: createId, action: 'admin.users.create' }] }
    });

    const diagnostics = await app.request('/api/v1/admin/request-events/list', {
      method: 'POST',
      headers: authHeaders(login.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        requestIdFilter: createId,
        page: 1,
        pageSize: 20
      })
    });
    await expect(diagnostics.json()).resolves.toMatchObject({
      ok: true,
      data: {
        total: 1,
        items: [
          {
            requestId: createId,
            actorId: login.user.id,
            operation: 'admin/users/create',
            outcome: 'success',
            statusCode: 200
          }
        ]
      }
    });
  });
});
