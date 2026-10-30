import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlibabaClient } from '@one-vegetable/core';
import { createProductOperationContext } from '@one-vegetable/core/product-operation-context';
import { validateProductMaintenanceServiceResult } from '@one-vegetable/core/product-maintenance-control';
import type { ProductMaintenanceCommand } from '@one-vegetable/core/product-maintenance-service';
import credentialsFixture from '../../../mock/data/node-gateway-credentials.json';
import referenceFixture from '../../../mock/data/product-reference/examples.json';
import maintenanceFixture from '../../../mock/data/product-maintenance-repository.json';
import { registerProductMaintenanceRoutes } from '../src/product-maintenance/routes';
import { SqlProductMaintenanceRepository } from '../src/product-maintenance/repository';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { StaticOperationFeatureFlags } from '../src/abac';

let db: NodeDatabaseHandle | undefined;
afterEach(() => {
  db?.connection.close();
  db = undefined;
  vi.restoreAllMocks();
});
async function setup() {
  db = openNodeDatabase(':memory:');
  applyNodeMigrations(db);
  const auth = new AuthService({
    repository: new SqlAuthRepository(db.executor),
    bootstrapToken: 'fixture-bootstrap-token'
  });
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'fixture-bootstrap-token',
    username: 'fixture-admin',
    password: credentialsFixture.workbench.password
  });
  const credentials = {
    ...credentialsFixture.manual,
    protocol: 'iop' as const,
    endpoint: 'https://openapi-api.alibaba.com/rest',
    signMethod: 'hmac-sha256' as const
  };
  const context = await createProductOperationContext(session.user.id, credentials);
  const call = vi.fn((method: string) =>
    Promise.resolve({ method, data: referenceFixture['/alibaba/icbu/product/get/v2'].response })
  );
  vi.spyOn(AlibabaClient, 'create').mockReturnValue({ call } as unknown as AlibabaClient);
  const resolveForOperation = vi.fn(() => Promise.resolve(credentials));
  const app = new Hono();
  registerProductMaintenanceRoutes(app, {
    repository: new SqlProductMaintenanceRepository(db.executor),
    auth,
    credentials: {
      resolveForOperation,
      requireCredentials: () => Promise.resolve(credentials),
      status: () =>
        Promise.resolve({
          source: 'environment',
          configured: true,
          hasAppKey: true,
          hasAppSecret: true,
          hasAccessToken: true,
          endpointOrigin: 'https://openapi-api.alibaba.com',
          signMethod: 'hmac-sha256'
        })
    },
    flags: new StaticOperationFeatureFlags(
      new Set(['/icbu/product/edit-inventory'].map((method) => 'method:' + method))
    )
  });
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost',
    Cookie: 'ov_session=' + session.sessionToken,
    'X-CSRF-Token': session.session.csrfToken
  };
  const request = (command: ProductMaintenanceCommand, customHeaders = headers, customContext = context) =>
    app.request('/product-maintenance/call', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify({ requestId: crypto.randomUUID(), context: customContext, command })
    });
  return { app, context, headers, request, call, resolveForOperation };
}
describe('durable product maintenance API', () => {
  it('requires a workbench session and CSRF without selecting credentials', async () => {
    const env = await setup();
    expect((await env.request({ action: 'list' }, { ...env.headers, Cookie: '' })).status).not.toBe(200);
    expect((await env.request({ action: 'list' }, { ...env.headers, 'X-CSRF-Token': '' })).status).not.toBe(
      200
    );
    expect(env.call).not.toHaveBeenCalled();
    expect(env.resolveForOperation).not.toHaveBeenCalled();
  });
  it('validates the request and never accepts arbitrary native method parameters', async () => {
    const env = await setup();
    const response = await env.app.request('/product-maintenance/call', {
      method: 'POST',
      headers: env.headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        context: env.context,
        command: { action: 'call', method: '/alibaba/icbu/product/delete', parameters: {} }
      })
    });
    expect(response.status).toBe(400);
    expect(env.call).not.toHaveBeenCalled();
  });
  it('selects IOP by actual inventory action and durably prepares without sending a mutation', async () => {
    const env = await setup();
    const draft = maintenanceFixture.records.inventory.task.intent.draft;
    const response = await env.request({ action: 'create', draft });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    const data = await validateProductMaintenanceServiceResult(body.data);
    const task = data.tasks[0];
    if (!task) throw new Error('Missing prepared task');
    expect(task.status).toBe('prepared');
    expect(task.submitAttempted).toBe(false);
    expect(task.baseline?.productId).toBe(draft.productId);
    expect(env.call.mock.calls.map(([method]) => method)).toEqual(['/alibaba/icbu/product/get/v2']);
    expect(env.resolveForOperation.mock.calls.length).toBe(1);
    const sent = await env.request({
      action: 'send',
      taskId: task.id,
      revision: task.revision,
      fingerprint: task.intent.fingerprint
    });
    expect(sent.status).toBe(400);
    expect(await sent.text()).toContain('PRODUCT_MAINTENANCE_METHOD_DISABLED');
    expect(env.call).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed identity before provider reads', async () => {
    const env = await setup();
    const response = await env.request(
      { action: 'create', draft: maintenanceFixture.records.inventory.task.intent.draft },
      env.headers,
      { ...env.context, identity: 'f'.repeat(64) }
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('PRODUCT_CONTEXT_CHANGED');
    expect(env.call).not.toHaveBeenCalled();
  });
  it('does not trust client-supplied draft provenance', async () => {
    const env = await setup();
    const response = await env.request({
      action: 'create',
      draft: {
        operation: 'deleteDraft',
        draftIds: ['770001'],
        knownDrafts: [{ kind: 'draft', draftId: '770001', source: 'draft-create' }]
      }
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('PRODUCT_MAINTENANCE_KNOWN_DRAFT_REQUIRED');
    expect(env.call).not.toHaveBeenCalled();
  });
});
