import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestId } from '@one-vegetable/core';
import { createApiApp } from '../src/app';
import { StaticOperationFeatureFlags } from '../src/abac';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';

import type { GatewayClient, OperationId } from '@one-vegetable/core';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const PATCH = `<itemSchema><field id="subject" type="input"><values><value>Updated title</value></values></field></itemSchema>`;

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

describe('product mutation lifecycle routes', () => {
  it('returns an auditing job, blocks duplicates and verifies through readback', async () => {
    database = openNodeDatabase(':memory:');
    applyNodeMigrations(database);
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: 'bootstrap-secret-that-is-long'
    });
    const session = await authService.bootstrap({
      requestId: createRequestId(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value'
    });
    const gatewayRequest = vi.fn(
      (operation: OperationId, _payload: unknown, _context?: { requestId: string }) => {
        if (operation === 'updateProduct') {
          return Promise.resolve({ productId: '1601928079741', traceId: 'trace-1', success: true });
        }
        if (operation === 'renderProductSchema') {
          return Promise.resolve({
            xml: PATCH,
            categoryId: 201712702,
            language: 'en_US',
            market: 'wholesale'
          });
        }
        return Promise.reject(new Error(`unexpected operation: ${operation}`));
      }
    );
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      gateway: { request: gatewayRequest },
      authService,
      adminService: new AdminService(authRepository),
      featureFlags: new StaticOperationFeatureFlags(new Set(['operation:updateProduct'])),
      productMutationJobs: new SqlProductMutationJobRepository(database.executor),
      allowedOrigins: ['http://localhost']
    });
    const payload = {
      productId: '1601928079741',
      categoryId: 201712702,
      language: 'en_US',
      schemaPatchXml: PATCH
    };
    const submitted = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({ requestId: createRequestId(), operation: 'updateProduct', payload })
    });
    expect(submitted.status).toBe(200);
    const submittedBody = (await submitted.json()) as {
      data: { job: { id: string; revision: number; status: string } };
    };
    expect(submittedBody.data.job.status).toBe('auditing');

    const duplicate = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({ requestId: createRequestId(), operation: 'updateProduct', payload })
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: 'PRODUCT_MUTATION_IN_PROGRESS' }
    });
    expect(gatewayRequest.mock.calls.filter(([operation]) => operation === 'updateProduct')).toHaveLength(1);

    const list = await app.request('/api/v1/product-mutation-jobs/list', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({ requestId: createRequestId(), productId: payload.productId })
    });
    await expect(list.json()).resolves.toMatchObject({
      data: { total: 1, items: [{ id: submittedBody.data.job.id, status: 'auditing' }] }
    });

    const refreshed = await app.request('/api/v1/product-mutation-jobs/refresh', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        id: submittedBody.data.job.id,
        revision: submittedBody.data.job.revision
      })
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({ data: { status: 'verified' } });
  });

  it('persists a display mutation and verifies it through the real product-list shape', async () => {
    database = openNodeDatabase(':memory:');
    applyNodeMigrations(database);
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: 'bootstrap-secret-that-is-long'
    });
    const session = await authService.bootstrap({
      requestId: createRequestId(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value'
    });
    let display: 'online' | 'offline' = 'online';
    const gatewayRequest = vi.fn((operation: OperationId) => {
      if (operation === 'listProducts') {
        return Promise.resolve({
          items: [
            {
              id: '1601928079741',
              encryptedId: 'encrypted-1',
              subject: 'Smoke product',
              groupName: 'Smoke',
              status: display,
              score: 0,
              updatedAt: '2026-08-22T00:00:00.000Z',
              categoryId: 201712702
            }
          ],
          page: 1,
          pageSize: 100,
          total: 1
        });
      }
      if (operation === 'updateProductDisplay') {
        return Promise.resolve({
          encryptedProductIds: ['encrypted-1'],
          display: 'offline',
          traceId: 'display-trace',
          success: true
        });
      }
      return Promise.reject(new Error(`unexpected operation: ${operation}`));
    });
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      gateway: { request: gatewayRequest as GatewayClient['request'] },
      authService,
      adminService: new AdminService(authRepository),
      featureFlags: new StaticOperationFeatureFlags(new Set(['operation:updateProductDisplay'])),
      productMutationJobs: new SqlProductMutationJobRepository(database.executor),
      allowedOrigins: ['http://localhost']
    });
    const submitted = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        operation: 'updateProductDisplay',
        payload: {
          productIds: ['1601928079741'],
          encryptedProductIds: ['encrypted-1'],
          display: 'offline'
        }
      })
    });
    expect(submitted.status).toBe(200);
    const submittedBody = (await submitted.json()) as {
      data: { jobs: { id: string; revision: number; status: string }[] };
    };
    expect(submittedBody.data.jobs).toMatchObject([{ status: 'verifying' }]);
    const job = submittedBody.data.jobs[0];
    if (!job) throw new Error('Missing display mutation job');

    display = 'offline';
    const refreshed = await app.request('/api/v1/product-mutation-jobs/refresh', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify({ requestId: createRequestId(), id: job.id, revision: job.revision })
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      data: { operation: 'updateProductDisplay', status: 'verified', targetDisplay: 'offline' }
    });
  });
});

function authHeaders(sessionToken: string, csrfToken?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    Cookie: `ov_session=${sessionToken}`,
    Origin: 'http://localhost',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };
}
