import { afterEach, expect, it, vi } from 'vitest';
import { createRequestId, GatewayException, type GatewayClient } from '@one-vegetable/core';
import { requireProductOperationContext } from '@one-vegetable/core/product-operation-context';
import { createApiApp } from '../src/app';
import { StaticOperationFeatureFlags } from '../src/abac';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';
let db: NodeDatabaseHandle | undefined;
afterEach(() => db?.connection.close());
it('authenticates context without S3, pins batch receipts and rejects changed identity before dispatch', async () => {
  db = openNodeDatabase(':memory:');
  applyNodeMigrations(db);
  const repository = new SqlAuthRepository(db.executor);
  const auth = new AuthService({ repository, bootstrapToken: 'batch-context-test-token-long' });
  const session = await auth.bootstrap({
    requestId: createRequestId(),
    bootstrapToken: 'batch-context-test-token-long',
    username: 'admin',
    password: 'batch-context-test-password'
  });
  const request = vi.fn<GatewayClient['request']>(() =>
    Promise.reject(
      new GatewayException({ code: 'NETWORK_TIMEOUT', message: 'Provider response lost', retryable: false })
    )
  );
  const gateway = { request, galleryGatewayContextId: () => Promise.resolve('b'.repeat(64)) };
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'real',
    gateway,
    authService: auth,
    adminService: new AdminService(repository),
    featureFlags: new StaticOperationFeatureFlags(new Set(['operation:updateProduct'])),
    productMutationJobs: new SqlProductMutationJobRepository(db.executor),
    allowedOrigins: ['http://localhost']
  });
  const post = (path: string, body: Record<string, unknown>, authenticated = true) =>
    app.request('/api/v1' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: 'http://localhost',
        ...(authenticated
          ? { Cookie: `ov_session=${session.sessionToken}`, 'X-CSRF-Token': session.session.csrfToken }
          : {})
      },
      body: JSON.stringify({ requestId: createRequestId(), ...body })
    });
  expect((await post('/product-mutation-jobs/context/get', {}, false)).status).toBe(401);
  const body = (await (await post('/product-mutation-jobs/context/get', {})).json()) as { data: unknown };
  const context = requireProductOperationContext(body.data);
  expect(context.gateway).toBe('b'.repeat(64));
  expect(Object.keys(context)).toEqual(['identity', 'gateway']);
  const envelope = {
    operation: 'updateProduct',
    productBatchId: createRequestId(),
    productContext: context,
    payload: {
      productId: '301',
      categoryId: 123,
      language: 'en_US',
      schemaPatchXml:
        '<itemSchema><field id="keywords" type="multiInput"><values><value>Linen</value></values></field></itemSchema>'
    }
  };
  expect(
    (
      await post('/operations/call', {
        ...envelope,
        productContext: { ...context, identity: 'c'.repeat(64) }
      })
    ).status
  ).toBe(409);
  expect((await post('/operations/call', { ...envelope, productContext: null })).status).toBe(400);
  expect(request).not.toHaveBeenCalled();
  expect((await post('/operations/call', envelope)).status).toBe(502);
  expect(request).toHaveBeenCalledOnce();
  const jobs = await new SqlProductMutationJobRepository(db.executor).list({ page: 1, pageSize: 100 });
  expect(jobs.items[0]).toMatchObject({
    batchId: envelope.productBatchId,
    productContext: context,
    status: 'recovery-required'
  });
  expect((await post('/operations/call', envelope)).status).toBe(409);
  expect(request).toHaveBeenCalledOnce();
});
