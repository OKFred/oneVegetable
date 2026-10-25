import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, expect, it } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { openD1Database, isD1DatabaseReady } from '../src/db/d1-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';
import { DualAlibabaAuthorization } from '../src/gateway/dual-authorization';
import { galleryGatewayId } from '@one-vegetable/core/gallery-transfer-context';
import { CredentialBackedAlibabaGatewayClient } from '../src/gateway/alibaba-read-gateway';
import { createApiApp } from '../src/app';
import { AuthService } from '../src/auth/service';
import { SqlAuthRepository } from '../src/auth/repository';
import { IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
it('isolates protocol rows, confirmation and clear across request-local D1 providers', async () => {
  const db = openD1Database(env.DB);
  expect(await isD1DatabaseReady(db)).toBe(true);
  const cipher = await GatewayCredentialCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, ''));
  const repository = new SqlGatewayCredentialRepository(db.executor);
  const service = new GatewayCredentialService(repository, cipher);
  const primary = {
    service,
    provider: new StoredAlibabaCredentialProvider(repository, cipher),
    summary: () => service.status()
  };
  const dual = new DualAlibabaAuthorization(db.executor, cipher, primary);
  await service.import({
    bundle: fixture.oauthBundle,
    actorId: 'admin',
    expectedRevision: null,
    remark: null
  });
  await (
    await dual.service('iop')
  ).import({
    bundle: { ...fixture.oauthBundle, protocol: 'iop' },
    actorId: 'admin',
    expectedRevision: null,
    remark: null
  });
  const summary = await dual.authorizations();
  const topId = summary.top?.configurationId;
  const iopId = summary.iop?.configurationId;
  if (!topId || !iopId) throw new Error('Missing fixture profiles');
  await dual.confirm(topId, iopId, 'admin');
  const nextRequest = new DualAlibabaAuthorization(db.executor, cipher, primary);
  expect(await nextRequest.selectProtocol('listProducts', {})).toBe('iop');
  const gateway = new CredentialBackedAlibabaGatewayClient(nextRequest);
  const showcase = await gateway.operationGatewayContextId('getProductShowcase', {});
  expect(showcase).not.toBe(await gateway.galleryGatewayContextId());
  const pinnedShowcase = { identity: 'owner', gateway: showcase, storage: null };
  for (const operation of [
    'getProductShowcase',
    'addShowcaseProducts',
    'removeShowcaseProducts',
    'sortShowcaseProduct',
    'replaceShowcaseProduct'
  ] as const)
    expect(await gateway.operationProtocol(operation, {}, { galleryContext: pinnedShowcase })).toBe('top');
  expect(await gateway.operationGatewayContextId('getProductInventory', { source: 'sku' })).toBe(showcase);
  const credentials = await nextRequest.resolveForOperation('listProducts', {});
  const context = { identity: 'owner', gateway: await galleryGatewayId(credentials) };
  expect(
    (await nextRequest.resolveForOperation('renderProductSchema', {}, { productContext: context })).protocol
  ).toBe('iop');
  await (await nextRequest.service('iop')).clear(1);
  expect((await nextRequest.authorizations()).top?.configured).toBe(true);
  await expect(
    nextRequest.resolveForOperation('renderProductSchema', {}, { productContext: context })
  ).rejects.toMatchObject({ code: 'PRODUCT_CONTEXT_CHANGED' });
  const bootstrapToken = crypto.randomUUID();
  const auth = new AuthService({ repository: new SqlAuthRepository(db.executor), bootstrapToken });
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken,
    username: 'context-regression-admin',
    password: 'fixture-password'
  });
  const app = createApiApp({
    runtime: 'cloudflare',
    database: 'd1',
    environment: 'test',
    gatewayMode: 'real',
    gateway,
    authService: auth
  });
  const requestId = crypto.randomUUID();
  const response = await app.request('/api/v1/gallery-transfers/context/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'ov_session=' + session.sessionToken },
    body: JSON.stringify({
      requestId,
      operation: 'callCapability',
      payload: { method: IOP_REFERENCE_METHODS.getProduct, parameters: { product_id: '880001' } }
    })
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    requestId,
    ok: false,
    error: {
      code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
      message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
      retryable: false
    }
  });
});
