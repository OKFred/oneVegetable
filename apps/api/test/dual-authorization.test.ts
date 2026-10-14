import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { galleryGatewayId } from '@one-vegetable/core/gallery-transfer-context';
import { validateAlibabaAuthorizationsSummary } from '@one-vegetable/core/gateway-credential-validators';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';
import { DualAlibabaAuthorization } from '../src/gateway/dual-authorization';
import { CredentialBackedAlibabaGatewayClient } from '../src/gateway/alibaba-read-gateway';
import { createApiApp } from '../src/app';
import { AuthService } from '../src/auth/service';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import type { NetworkTransport } from '@one-vegetable/core';

const databases: NodeDatabaseHandle[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.connection.close();
});
const now = Date.parse('2026-09-12T00:00:00Z');

async function harness(transport?: NetworkTransport) {
  const db = openNodeDatabase(':memory:');
  databases.push(db);
  applyNodeMigrations(db);
  const cipher = await GatewayCredentialCipher.create(btoa('a'.repeat(32)).replace(/=+$/u, ''));
  const repository = new SqlGatewayCredentialRepository(db.executor);
  const service = new GatewayCredentialService(repository, cipher, () => now);
  const provider = new StoredAlibabaCredentialProvider(repository, cipher, {
    clock: () => now,
    ...(transport ? { transport } : {})
  });
  const primary = { service, provider, summary: () => service.status() };
  const dual = new DualAlibabaAuthorization(db.executor, cipher, primary, {
    clock: () => now,
    ...(transport ? { transport } : {})
  });
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
  return { db, cipher, repository, service, provider, dual, primary };
}
async function confirm(dual: DualAlibabaAuthorization) {
  const summary = await dual.authorizations();
  await dual.confirm(
    present(summary.binding.topConfigurationId),
    present(summary.binding.iopConfigurationId),
    'admin'
  );
}
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Test prerequisite missing');
  return value;
}

describe('independent TOP and IOP credentials', () => {
  it('preserves the legacy primary ciphertext and verifies redacted summary; needs confirmation before auto-routing', async () => {
    const { dual, service, repository, cipher } = await harness();
    const row = await repository.find();
    expect(row?.id).toBe('primary');
    expect((await cipher.decryptDocument(present(row))).credentials.accessToken).toBe(
      fixture.oauthBundle.oauth.accessToken
    );
    const summary = await dual.authorizations();
    expect(validateAlibabaAuthorizationsSummary(summary)).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/fixture-secret|fixture-access/);
    expect(summary).toMatchObject({
      defaultProtocol: 'top',
      top: { revision: 1 },
      iop: { revision: 1 },
      binding: { confirmed: false }
    });
    expect(await dual.selectProtocol('listProducts', {})).toBe('top');
    await confirm(dual);
    expect(await dual.selectProtocol('listProducts', {})).toBe('iop');
    expect(await dual.selectProtocol('listPhotos', {})).toBe('top');
    expect(await dual.selectProtocol('listPhotos', { groupId: 'group-a' })).toBe('iop');
    expect(await dual.selectProtocol('listPhotos', { ungrouped: true })).toBe('top');
    expect(await dual.selectProtocol('getTradeOrderAggregate', { orderId: 'test' })).toBe('top');
    expect(await dual.selectProtocol('uploadPhoto', {})).toBe('top');
    expect(await repository.find()).toEqual(row);
    expect(await service.status()).toMatchObject({ configured: true, revision: 1 });
  });
  it('isolates refresh leases and ciphertext AAD by protocol', async () => {
    const { db, repository, cipher } = await harness();
    const iop = new SqlGatewayCredentialRepository(db.executor, 'iop');
    expect(await repository.acquireRefreshLease('top-lease', now, 1)).toBe(true);
    expect(await iop.acquireRefreshLease('iop-lease', now, 1)).toBe(true);
    await iop.failRefresh('iop-lease', 'IOP_TOKEN_REJECTED', now);
    expect((await repository.find())?.lastRefreshErrorCode).toBeNull();
    expect((await repository.find())?.refreshLeaseId).toBe('top-lease');
    const row = await repository.find();
    await expect(cipher.decryptDocument({ ...present(row), id: 'iop' })).rejects.toMatchObject({
      code: 'ALIBABA_CREDENTIAL_VAULT_UNREADABLE'
    });
  });
  it('keeps the profile identity through refresh and invalidates the pair on replacement', async () => {
    const send = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'rotated',
            refresh_token: 'refresh-next',
            expires_in: 3600,
            refresh_expires_in: 7200
          })
        )
      )
    );
    const { dual, service } = await harness({ send });
    await service.import({
      bundle: {
        ...fixture.oauthBundle,
        oauth: { ...fixture.oauthBundle.oauth, refreshToken: 'refresh-fixture' }
      },
      actorId: 'admin',
      expectedRevision: 1,
      remark: null
    });
    await confirm(dual);
    const before = await dual.authorizations();
    await (await dual.managementProvider('top')).requireCredentials(crypto.randomUUID(), true);
    const refreshed = await dual.authorizations();
    expect(refreshed.top?.configurationId).toBe(before.top?.configurationId);
    expect(refreshed.binding.confirmed).toBe(true);
    expect(refreshed.iop).toEqual(before.iop);
    const target = await dual.service('iop');
    await target.import({
      bundle: { ...fixture.oauthBundle, protocol: 'iop' },
      actorId: 'admin',
      expectedRevision: before.iop?.revision ?? null,
      remark: null
    });
    expect((await dual.authorizations()).binding.confirmed).toBe(false);
    await expect(
      dual.confirm(present(before.top?.configurationId), present(before.iop?.configurationId), 'admin')
    ).rejects.toMatchObject({ code: 'ALIBABA_AUTHORIZATION_BINDING_CHANGED' });
    await expect(dual.service()).rejects.toMatchObject({ code: 'ALIBABA_PROTOCOL_SELECTION_REQUIRED' });
  });
  it('pins product/gallery requests to the actual snapshot rather than current preferred protocol', async () => {
    const { dual } = await harness();
    await confirm(dual);
    const top = await (await dual.managementProvider('top')).requireCredentials();
    const iop = await dual.resolveForOperation('listProducts', {});
    const expected = { identity: 'identity', gateway: await galleryGatewayId(top) };
    expect(
      (await dual.resolveForOperation('renderProductSchema', {}, { productContext: expected })).protocol
    ).toBe('top');
    const gateway = new CredentialBackedAlibabaGatewayClient(dual);
    expect(await gateway.galleryGatewayContextId()).toBe(await galleryGatewayId(top));
    expect(await gateway.productGatewayContextId()).toBe(await galleryGatewayId(iop));
    await (await dual.service('top')).clear(1);
    expect((await dual.authorizations()).iop?.configured).toBe(true);
    await expect(
      dual.resolveForOperation('renderProductSchema', {}, { productContext: expected })
    ).rejects.toMatchObject({ code: 'PRODUCT_CONTEXT_CHANGED' });
  });
  it('never falls back to TOP after selected IOP transport failure', async () => {
    const { dual } = await harness();
    await confirm(dual);
    const send = vi.fn<NetworkTransport['send']>(() => Promise.reject(new TypeError('network failed')));
    const gateway = new CredentialBackedAlibabaGatewayClient(dual, { transport: { send }, maxAttempts: 1 });
    await expect(gateway.request('listProducts', { page: 1, pageSize: 20 })).rejects.toBeDefined();
    expect(send).toHaveBeenCalledOnce();
    const input = send.mock.calls[0]?.[0];
    expect(input instanceof Request ? input.url : input instanceof URL ? input.href : input).toContain(
      'openapi-api.alibaba.com'
    );
  });
  it('survives provider recreation and clearing an additional slot without reactivating old data', async () => {
    const { dual, db, cipher, primary } = await harness();
    await confirm(dual);
    const restarted = new DualAlibabaAuthorization(db.executor, cipher, primary);
    expect((await restarted.authorizations()).binding.confirmed).toBe(true);
    await (await restarted.service('iop')).clear(1);
    expect(await restarted.authorizations()).toMatchObject({
      iop: null,
      top: { configured: true },
      binding: { confirmed: false }
    });
    expect(await restarted.selectProtocol('listProducts', {})).toBe('top');
    await (
      await restarted.service('iop')
    ).import({
      bundle: { ...fixture.oauthBundle, protocol: 'iop' },
      actorId: 'admin',
      expectedRevision: null,
      remark: null
    });
    expect((await restarted.authorizations()).iop?.revision).toBe(3);
  });
});

it('requires admin + CSRF for pairing, rejects protocol mismatch and preserves independent revisions', async () => {
  const { dual, service, provider, db } = await harness();
  const repository = new SqlAuthRepository(db.executor);
  const auth = new AuthService({ repository, bootstrapToken: 'bootstrap-token' });
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'bootstrap-token',
    username: 'admin',
    password: 'long-correct-password'
  });
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'mock',
    authService: auth,
    adminService: new AdminService(repository),
    gatewayCredentialService: service,
    gatewayCredentialProvider: provider,
    gatewayAuthorizations: dual
  });
  const request = (path: string, body: object = {}, csrf = false, login = true) =>
    app.request(`/api/v1/admin/gateway-credentials/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        ...(login ? { Cookie: `ov_session=${session.sessionToken}` } : {}),
        ...(csrf ? { 'X-CSRF-Token': session.session.csrfToken } : {})
      },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body })
    });
  expect((await request('authorizations/get', {}, false, false)).status).toBe(401);
  const pair = (await dual.authorizations()).binding;
  expect(
    (
      await request('authorizations/confirm', {
        topConfigurationId: pair.topConfigurationId,
        iopConfigurationId: pair.iopConfigurationId
      })
    ).status
  ).toBe(403);
  expect(
    (
      await request(
        'authorizations/confirm',
        { topConfigurationId: pair.topConfigurationId, iopConfigurationId: pair.iopConfigurationId },
        true
      )
    ).status
  ).toBe(200);
  const response = await request('get', { protocol: 'iop' });
  expect(await response.json()).toMatchObject({ data: { configured: true, protocol: 'iop' } });
  expect(
    (await request('save', { protocol: 'iop', credentials: fixture.manual, revision: 1 }, true)).status
  ).toBe(400);
  expect((await request('clear', { protocol: 'iop', revision: 1 }, true)).status).toBe(200);
  expect((await dual.authorizations()).top?.configured).toBe(true);
});
