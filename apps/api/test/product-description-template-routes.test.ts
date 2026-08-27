import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { StaticOperationFeatureFlags } from '../src/abac';
import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlProductDescriptionTemplateRepository } from '../src/product-description-templates/repository';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

function fixture(flags = new Set<string>(), gatewayMode: 'mock' | 'replay' = 'mock') {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const repository = new SqlAuthRepository(database.executor);
  const authService = new AuthService({
    repository,
    bootstrapToken: 'bootstrap-secret-that-is-long'
  });
  const adminService = new AdminService(repository);
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode,
    ...(gatewayMode === 'replay' ? { gateway: new MockGatewayClient(0) } : {}),
    authService,
    adminService,
    featureFlags: new StaticOperationFeatureFlags(flags),
    productDescriptionTemplates: new SqlProductDescriptionTemplateRepository(database.executor)
  });
  return { app, authService, adminService, repository };
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

describe('shared product description template routes', () => {
  it('allows an active ordinary user to manage sanitized shared templates with CSRF and audit', async () => {
    const { app, authService, adminService, repository } = fixture();
    const admin = await bootstrap(authService);
    await adminService.createUser({
      requestId: createRequestId(),
      actor: admin.session.principal,
      username: 'editor',
      password: 'editor-password-value',
      role: 'user'
    });
    const editor = await authService.login({
      requestId: createRequestId(),
      username: 'editor',
      password: 'editor-password-value'
    });

    const createRequestIdValue = createRequestId();
    const create = await app.request('/api/v1/product-description-templates/create', {
      method: 'POST',
      headers: authHeaders(editor.sessionToken, editor.session.csrfToken),
      body: JSON.stringify({
        requestId: createRequestIdValue,
        name: 'Our company',
        category: 'company',
        language: 'en_US',
        html: '<div><h2 onclick="bad()">About us</h2><script>bad()</script></div>',
        remark: 'Shared by sales'
      })
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as {
      data: { id: string; html: string; revision: number; creatorId: string };
    };
    expect(created.data).toMatchObject({
      html: '<h2>About us</h2>',
      revision: 1,
      creatorId: editor.user.id
    });

    const list = await app.request('/api/v1/product-description-templates/list', {
      method: 'POST',
      headers: authHeaders(editor.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        page: 1,
        pageSize: 20,
        language: 'en_US',
        status: 'active'
      })
    });
    await expect(list.json()).resolves.toMatchObject({
      ok: true,
      data: { total: 1, page: 1, pageSize: 20, items: [{ id: created.data.id }] }
    });

    const noCsrf = await app.request('/api/v1/product-description-templates/archive', {
      method: 'POST',
      headers: authHeaders(editor.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        id: created.data.id,
        revision: created.data.revision
      })
    });
    expect(noCsrf.status).toBe(403);
    await expect(noCsrf.json()).resolves.toMatchObject({ error: { code: 'CSRF_INVALID' } });

    const archive = await app.request('/api/v1/product-description-templates/archive', {
      method: 'POST',
      headers: authHeaders(editor.sessionToken, editor.session.csrfToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        id: created.data.id,
        revision: created.data.revision
      })
    });
    await expect(archive.json()).resolves.toMatchObject({
      ok: true,
      data: { status: 'archived', revision: 2 }
    });

    const stale = await app.request('/api/v1/product-description-templates/restore', {
      method: 'POST',
      headers: authHeaders(editor.sessionToken, editor.session.csrfToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        id: created.data.id,
        revision: 1
      })
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: 'ENTITY_VERSION_CONFLICT' }
    });

    const audit = await repository.listAudit({
      requestId: createRequestIdValue,
      page: 1,
      pageSize: 20
    });
    expect(audit.items).toMatchObject([
      {
        actorId: editor.user.id,
        action: 'product-description-template.create',
        resourceId: created.data.id,
        revisionAfter: 1
      }
    ]);
  });

  it('reports per-operation availability for the current role and server flags', async () => {
    const { app, authService } = fixture(new Set(['operation:saveProductDraft']));
    const admin = await bootstrap(authService);
    const requestId = createRequestId();
    const response = await app.request('/api/v1/operations/availability/get', {
      method: 'POST',
      headers: authHeaders(admin.sessionToken),
      body: JSON.stringify({
        requestId,
        operations: ['saveProductDraft', 'publishProduct', 'updateProduct', 'missingOperation']
      })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-ID')).toBe(requestId);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        items: [
          { operation: 'saveProductDraft', allowed: true, reasonCode: 'ADMIN_MUTATION_ALLOWED' },
          { operation: 'publishProduct', allowed: false, reasonCode: 'MUTATION_FLAG_DISABLED' },
          { operation: 'updateProduct', allowed: false, reasonCode: 'MUTATION_FLAG_DISABLED' },
          { operation: 'missingOperation', allowed: false, reasonCode: 'OPERATION_UNKNOWN' }
        ]
      }
    });
  });

  it('reports provider qualification gates independently from the UI runtime mode', async () => {
    const { app, authService } = fixture(new Set(), 'replay');
    const admin = await bootstrap(authService);
    const requestId = createRequestId();
    const response = await app.request('/api/v1/operations/availability/get', {
      method: 'POST',
      headers: authHeaders(admin.sessionToken),
      body: JSON.stringify({
        requestId,
        operations: ['calculateLogisticsQuote', 'listShippingTemplates']
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [
          {
            operation: 'calculateLogisticsQuote',
            allowed: false,
            reasonCode: 'LOGISTICS_QUALIFICATION_REQUIRED'
          },
          { operation: 'listShippingTemplates', allowed: true, reasonCode: 'READ_ALLOWED' }
        ]
      }
    });
  });
});
