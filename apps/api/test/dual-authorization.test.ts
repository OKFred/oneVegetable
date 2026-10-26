import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import photoFixture from '../../../mock/data/alibaba-auth/iop-photo-responses.json';
import showcaseFixture from '../../../mock/data/showcase-management.json';
import skuFixture from '../../../mock/data/product-sku-inventory.json';
import referenceFixture from '../../../mock/data/product-reference/examples.json';
import scoreFixture from '../../../mock/data/product-score-protocols.json';
import { ProductReferenceClient, IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';
import { BffGatewayClient } from '@one-vegetable/core';
import { galleryGatewayId, opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import { validateAlibabaAuthorizationsSummary } from '@one-vegetable/core/gateway-credential-validators';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';
import { DualAlibabaAuthorization } from '../src/gateway/dual-authorization';
import {
  AlibabaReadGatewayClient,
  CredentialBackedAlibabaGatewayClient
} from '../src/gateway/alibaba-read-gateway';
import { createDocumentationReplayGateway } from '../src/gateway/documentation-replay';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { createApiApp } from '../src/app';
import { AuthService } from '../src/auth/service';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import type { NetworkTransport } from '@one-vegetable/core';

const databases: NodeDatabaseHandle[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.connection.close();
});
const now = Date.parse('2026-09-12T00:00:00Z');

async function harness(transport?: NetworkTransport, preferred: 'top' | 'iop' = 'top') {
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
    bundle: preferred === 'top' ? fixture.oauthBundle : { ...fixture.oauthBundle, protocol: 'iop' },
    actorId: 'admin',
    expectedRevision: null,
    remark: null
  });
  await (
    await dual.service(preferred === 'top' ? 'iop' : 'top')
  ).import({
    bundle: { ...fixture.oauthBundle, protocol: preferred === 'top' ? 'iop' : 'top' },
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
  it.each(['top-only', 'iop-only', 'dual-top', 'dual-iop'] as const)(
    'keeps score identifiers and operation contexts correlated in %s',
    async (mode) => {
      const preferred = mode === 'iop-only' || mode === 'dual-iop' ? 'iop' : 'top';
      const { dual, db } = await harness(undefined, preferred);
      if (mode === 'top-only') await (await dual.service('iop')).clear(1);
      if (mode === 'iop-only') await (await dual.service('top')).clear(1);
      const seen: string[] = [];
      const send = vi.fn<NetworkTransport['send']>((input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const form =
          init.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(typeof init.body === 'string' ? init.body : '');
        if (mode === 'top-only') {
          const method = form.get('method') ?? '';
          expect(url.origin).toBe('https://eco.taobao.com');
          seen.push(method);
          if (method === 'alibaba.icbu.product.list') {
            expect(form.get('id')).toBe('410001');
            return Promise.resolve(
              Response.json({ alibaba_icbu_product_list_response: scoreFixture.products })
            );
          }
          expect(method).toBe('alibaba.icbu.product.score.get');
          expect(form.get('product_id')).toBe('opaque-score-fixture');
          return Promise.resolve(
            Response.json({ alibaba_icbu_product_score_get_response: scoreFixture.score })
          );
        }
        expect(url.origin).toBe('https://openapi-api.alibaba.com');
        expect(url.pathname).toBe('/rest/icbu/product/score/get');
        expect(form.get('product_id')).toBe('410001');
        expect(form.has('session')).toBe(false);
        seen.push(url.pathname);
        return Promise.resolve(Response.json(scoreFixture.iopScore));
      });
      const gateway = new CredentialBackedAlibabaGatewayClient(dual, { transport: { send }, maxAttempts: 1 });
      const auth = new AuthService({
        repository: new SqlAuthRepository(db.executor),
        bootstrapToken: 'bootstrap-token'
      });
      const session = await auth.bootstrap({
        requestId: crypto.randomUUID(),
        bootstrapToken: 'bootstrap-token',
        username: 'admin',
        password: 'fixture-password'
      });
      const app = createApiApp({
        runtime: 'node',
        database: 'sqlite',
        environment: 'test',
        gatewayMode: 'real',
        gateway,
        authService: auth
      });
      const client = new BffGatewayClient({
        baseUrl: 'http://localhost',
        transport: {
          send: async (input, init) =>
            app.request(input instanceof Request ? input.url : String(input), {
              ...init,
              headers: {
                ...Object.fromEntries(new Headers(init.headers)),
                Cookie: 'ov_session=' + session.sessionToken
              }
            })
        }
      });
      const before = await dual.authorizations();
      const payload = { productId: '410001' };
      const context = await client.galleryTransferContext('getProductScore', payload);
      expect(await client.request('getProductScore', payload, { galleryContext: context })).toEqual({
        productId: '410001',
        score: 4.6,
        issues: []
      });
      expect(seen).toEqual(
        mode === 'top-only'
          ? ['alibaba.icbu.product.list', 'alibaba.icbu.product.score.get']
          : ['/rest/icbu/product/score/get']
      );
      expect(await dual.authorizations()).toEqual(before);
    }
  );
  it('preserves the missing IOP authorization reason through the authenticated context endpoint', async () => {
    const { dual, db } = await harness();
    await (await dual.service('iop')).clear(1);
    const auth = new AuthService({
      repository: new SqlAuthRepository(db.executor),
      bootstrapToken: 'bootstrap-token'
    });
    const session = await auth.bootstrap({
      requestId: crypto.randomUUID(),
      bootstrapToken: 'bootstrap-token',
      username: 'admin',
      password: 'correct-password'
    });
    const send = vi.fn<NetworkTransport['send']>();
    const gateway = new CredentialBackedAlibabaGatewayClient(dual, { transport: { send }, maxAttempts: 1 });
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      gateway,
      authService: auth
    });
    const client = new BffGatewayClient({
      baseUrl: 'http://localhost',
      transport: {
        send: async (input, init) =>
          app.request(input instanceof Request ? input.url : String(input), {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init.headers)),
              Cookie: 'ov_session=' + session.sessionToken
            }
          })
      }
    });
    for (const method of Object.values(IOP_REFERENCE_METHODS))
      await expect(
        client.galleryTransferContext('callCapability', {
          method,
          parameters: {}
        })
      ).rejects.toMatchObject({
        gatewayError: {
          code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
          message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
          retryable: false
        }
      });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['top', 'iop'] as const)(
    'routes all native reference reads and catalogue metadata with default %s',
    async (preferred) => {
      const { dual } = await harness(undefined, preferred);
      const seen: string[] = [];
      const send = vi.fn<NetworkTransport['send']>((input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        expect(url.origin).toBe('https://openapi-api.alibaba.com');
        const path = url.pathname.replace(/^\/rest/u, '');
        const example = referenceFixture[path as keyof typeof referenceFixture];
        expect(example).toBeDefined();
        const parameters =
          init.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(typeof init.body === 'string' ? init.body : '');
        expect(parameters.has('session')).toBe(false);
        expect(parameters.has('method')).toBe(false);
        expect(parameters.get('sign_method')).toBe('sha256');
        seen.push(path);
        return Promise.resolve(Response.json(example.response));
      });
      const gateway = new CredentialBackedAlibabaGatewayClient(dual, {
        transport: { send },
        maxAttempts: 1
      });
      const client = new ProductReferenceClient(gateway);
      expect((await client.getProduct('880001')).productId).toBe('880001');
      expect((await client.listCategories()).length).toBe(2);
      expect((await client.predictCategory({ title: 'Glass cup' })).categoryId).toBe('220001');
      expect((await client.getAttributes('220001')).attributes.length).toBe(1);
      expect((await client.listShippingTemplates()).length).toBe(2);
      expect(new Set(seen)).toEqual(new Set(Object.values(IOP_REFERENCE_METHODS)));
      expect(send).toHaveBeenCalledTimes(5);
      const catalogue = await gateway.request('listCapabilities', undefined);
      for (const method of Object.values(IOP_REFERENCE_METHODS)) {
        expect(catalogue.find((entry) => entry.method === method)?.realCallEnabled).toBe(true);
        expect((await gateway.request('getCapabilityDefinition', { method })).realCallEnabled).toBe(true);
      }
      expect((await dual.authorizations()).defaultProtocol).toBe(preferred);
      await (await dual.service('iop')).clear(1);
      await expect(client.getProduct('880001')).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }
      });
      const remaining = await gateway.request('listCapabilities', undefined);
      for (const method of Object.values(IOP_REFERENCE_METHODS))
        expect(remaining.find((entry) => entry.method === method)?.realCallEnabled).toBe(false);
      expect(send).toHaveBeenCalledTimes(5);
    }
  );
  it.each(['top', 'iop'] as const)(
    'dispatches BFF showcase and SKU reads to TOP after acquiring their contexts with default %s',
    async (preferred) => {
      const { dual, db } = await harness(undefined, preferred);
      const auth = new AuthService({
        repository: new SqlAuthRepository(db.executor),
        bootstrapToken: 'bootstrap-token'
      });
      const session = await auth.bootstrap({
        requestId: crypto.randomUUID(),
        bootstrapToken: 'bootstrap-token',
        username: 'admin',
        password: 'correct-password'
      });
      const methods: string[] = [];
      const vendorSend = vi.fn<NetworkTransport['send']>((input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        expect(url.origin).toBe('https://eco.taobao.com');
        const parameters =
          init.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(typeof init.body === 'string' ? init.body : '');
        const method = parameters.get('method') ?? '';
        methods.push(method);
        const data =
          method === 'alibaba.scbp.showcase.status'
            ? showcaseFixture.status
            : method === 'alibaba.scbp.showcase.list'
              ? showcaseFixture.before
              : method === skuFixture.method
                ? skuFixture.response
                : null;
        if (data === null) throw new Error(`Unexpected fixture method: ${method}`);
        return Promise.resolve(Response.json({ [method.replaceAll('.', '_') + '_response']: data }));
      });
      const gateway = new CredentialBackedAlibabaGatewayClient(dual, {
        transport: { send: vendorSend },
        maxAttempts: 1
      });
      const app = createApiApp({
        runtime: 'node',
        database: 'sqlite',
        environment: 'test',
        gatewayMode: 'real',
        gateway,
        authService: auth
      });
      const client = new BffGatewayClient({
        baseUrl: 'http://localhost',
        transport: {
          send: async (input, init) =>
            app.request(input instanceof Request ? input.url : String(input), {
              ...init,
              headers: {
                ...Object.fromEntries(new Headers(init.headers)),
                Cookie: `ov_session=${session.sessionToken}`
              }
            })
        }
      });
      expect((await dual.authorizations()).defaultProtocol).toBe(preferred);
      const legacy = await client.galleryTransferContext();
      const showcase = await client.galleryTransferContext('getProductShowcase');
      expect(showcase.gateway).not.toBe(legacy.gateway);
      expect(
        await client.request('getProductShowcase', undefined, { galleryContext: showcase })
      ).toMatchObject({
        total: 2,
        used: 1
      });
      const inventory = await client.galleryTransferContext('getProductInventory', { source: 'sku' });
      expect(inventory.gateway).toBe(showcase.gateway);
      expect(
        await client.request(
          'getProductInventory',
          { productId: '1000000', source: 'sku', language: 'en_US' },
          { galleryContext: inventory }
        )
      ).toMatchObject({ status: 'ready', records: [{ inventory: 444 }] });
      expect(methods).toEqual([
        'alibaba.scbp.showcase.status',
        'alibaba.scbp.showcase.list',
        skuFixture.method
      ]);
      // An old IOP-bound context remains bound. Fixing new context acquisition must not
      // silently rebind an existing task or try a second provider after a rejection.
      await expect(
        client.request('getProductShowcase', undefined, { galleryContext: legacy })
      ).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
      });
      expect(vendorSend).toHaveBeenCalledTimes(3);
    }
  );
  it('selects operation-specific contexts without rebinding legacy image transfers or admitting unknown operations', async () => {
    const { dual, db } = await harness();
    const auth = new AuthService({
      repository: new SqlAuthRepository(db.executor),
      bootstrapToken: 'bootstrap-token'
    });
    const session = await auth.bootstrap({
      requestId: crypto.randomUUID(),
      bootstrapToken: 'bootstrap-token',
      username: 'admin',
      password: 'long-correct-password'
    });
    const gateway = new CredentialBackedAlibabaGatewayClient(dual);
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      gateway,
      authService: auth
    });
    const post = (body: object, loggedIn = true) =>
      app.request('/api/v1/gallery-transfers/context/get', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(loggedIn ? { Cookie: `ov_session=${session.sessionToken}` } : {})
        },
        body: JSON.stringify({ requestId: crypto.randomUUID(), ...body })
      });
    const upload = (await (await post({})).json()) as { data: { gateway: string } };
    const video = (await (await post({ operation: 'listVideos' })).json()) as { data: { gateway: string } };
    expect(upload.data.gateway).toBe(await gateway.operationGatewayContextId('uploadPhoto', {}));
    expect(video.data.gateway).toBe(await gateway.operationGatewayContextId('listVideos', {}));
    expect(video.data.gateway).not.toBe(upload.data.gateway);
    const contexts = [
      { operation: 'getProductShowcase' },
      { operation: 'sortShowcaseProduct' },
      { operation: 'replaceShowcaseProduct' },
      { operation: 'addShowcaseProducts' },
      { operation: 'removeShowcaseProducts' },
      { operation: 'getProductInventory', payload: { source: 'sku' } },
      { operation: 'getTradeOrderAggregate' },
      { operation: 'verifyProductVideoAssociation' },
      { operation: 'listPhotos', payload: { groupId: '1001' } },
      { operation: 'callCapability', payload: { method: 'alibaba.icbu.video.upload' } }
    ];
    const dispatch = vi.spyOn(gateway, 'request');
    for (const selection of contexts) {
      const response = await post(selection);
      expect(response.status, selection.operation).toBe(200);
      expect(await response.json()).toMatchObject({ data: { gateway: video.data.gateway } });
    }
    const inventory = await post({ operation: 'getProductInventory', payload: { source: 'product' } });
    expect(await inventory.json()).toMatchObject({ data: { gateway: upload.data.gateway } });
    expect(dispatch).not.toHaveBeenCalled();
    expect((await post({ operation: 'listVideos' }, false)).status).toBe(401);
    for (const operation of ['not-registered', '__proto__', ['listVideos'], {}, null])
      expect((await post({ operation })).status).toBe(400);
    expect((await post({ payload: {} })).status).toBe(400);
    expect((await post({ operation: 'getProductShowcase', payload: [] })).status).toBe(400);
  });
  it.each(['mock', 'replay'] as const)(
    'retains %s TOP availability only for the exact local context and rejects an unprovable real gateway',
    async (gatewayMode) => {
      const { db } = await harness();
      const auth = new AuthService({
        repository: new SqlAuthRepository(db.executor),
        bootstrapToken: 'bootstrap-token'
      });
      const session = await auth.bootstrap({
        requestId: crypto.randomUUID(),
        bootstrapToken: 'bootstrap-token',
        username: 'admin',
        password: 'long-correct-password'
      });
      const gateway = new MockGatewayClient(0);
      const dispatch = vi.spyOn(gateway, 'request');
      const app = createApiApp({
        runtime: 'node',
        database: 'sqlite',
        environment: 'test',
        gatewayMode,
        gateway,
        authService: auth
      });
      const post = (target: ReturnType<typeof createApiApp>, path: string, body: object) =>
        target.request(`/api/v1/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: `ov_session=${session.sessionToken}` },
          body: JSON.stringify({ requestId: crypto.randomUUID(), ...body })
        });
      const contextResult = await post(app, 'gallery-transfers/context/get', {});
      const envelope = (await contextResult.json()) as {
        data: { identity: string; gateway: string; storage: null };
      };
      const context = envelope.data;
      const scoped = await post(app, 'operations/availability/get', {
        operations: ['listPhotos'],
        galleryContext: context
      });
      expect(scoped.status).toBe(200);
      expect(await scoped.json()).toMatchObject({
        data: { items: [{ operation: 'listPhotos', allowed: true }] }
      });
      expect(
        (
          await post(app, 'operations/availability/get', {
            operations: ['listPhotos'],
            galleryContext: { ...context, gateway: 'different-local-context' }
          })
        ).status
      ).toBe(409);
      const real = createApiApp({
        runtime: 'node',
        database: 'sqlite',
        environment: 'test',
        gatewayMode: 'real',
        gateway,
        authService: auth
      });
      const unknown = await post(real, 'operations/availability/get', {
        operations: ['listPhotos'],
        galleryContext: context
      });
      expect(unknown.status).toBe(503);
      expect(await unknown.json()).toMatchObject({ error: { code: 'GALLERY_CONTEXT_UNAVAILABLE' } });
      expect(dispatch).not.toHaveBeenCalled();
    }
  );

  it('reads the protocol of frozen TOP/IOP and documentation replay credentials without dispatch', async () => {
    const { provider, dual } = await harness();
    const top = new AlibabaReadGatewayClient(present(await provider.credentialSnapshot()));
    const iop = new AlibabaReadGatewayClient(
      present(await (await dual.managementProvider('iop')).credentialSnapshot?.())
    );
    const replay = createDocumentationReplayGateway();
    for (const [gateway, protocol] of [
      [top, 'top'],
      [iop, 'iop'],
      [replay, 'top']
    ] as const) {
      const dispatch = vi.spyOn(gateway, 'request');
      const context = {
        identity: 'route-validated-actor',
        gateway: await gateway.galleryGatewayContextId(),
        storage: null
      };
      expect(await gateway.operationProtocol('listPhotos', {}, { galleryContext: context })).toBe(protocol);
      await expect(
        gateway.operationProtocol(
          'listPhotos',
          {},
          { galleryContext: { ...context, gateway: 'stale-context' } }
        )
      ).rejects.toMatchObject({ gatewayError: { code: 'GALLERY_CONTEXT_CHANGED' } });
      expect(dispatch).not.toHaveBeenCalled();
    }
  });
  it('pins availability to trusted gallery context without refreshing or dispatching, while retaining legacy routing', async () => {
    const send = vi.fn<NetworkTransport['send']>(() =>
      Promise.reject(new Error('No provider calls allowed'))
    );
    const { dual, db } = await harness({ send });
    const repository = new SqlAuthRepository(db.executor);
    const auth = new AuthService({ repository, bootstrapToken: 'bootstrap-token' });
    const session = await auth.bootstrap({
      requestId: crypto.randomUUID(),
      bootstrapToken: 'bootstrap-token',
      username: 'admin',
      password: 'long-correct-password'
    });
    const identity = await opaqueGalleryId(session.user.id);
    const contextFor = async (protocol: 'top' | 'iop') => ({
      identity,
      gateway: await galleryGatewayId(
        present(await (await dual.managementProvider(protocol)).credentialSnapshot?.())
      ),
      storage: null
    });
    const top = await contextFor('top');
    const iop = await contextFor('iop');
    const refresh = vi.spyOn(StoredAlibabaCredentialProvider.prototype, 'requireCredentials');
    const gateway = new CredentialBackedAlibabaGatewayClient(dual, { transport: { send } });
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      authService: auth,
      gateway,
      gatewayAuthorizations: dual
    });
    const request = (body: object = {}, authenticated = true) =>
      app.request('/api/v1/operations/availability/get', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authenticated ? { Cookie: `ov_session=${session.sessionToken}` } : {})
        },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          operations: ['listPhotos', 'createTradeOrder'],
          ...body
        })
      });
    const legacy = await request();
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({
      data: {
        items: [
          { operation: 'listPhotos', allowed: true },
          { operation: 'createTradeOrder', allowed: false }
        ]
      }
    });
    const pinned = await request({ galleryContext: iop });
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toMatchObject({
      data: {
        items: [
          {
            operation: 'listPhotos',
            protocolSupport: {
              protocol: 'iop',
              constraints: ['photo-group-required', 'photo-group-scope-unverified']
            }
          },
          { operation: 'createTradeOrder', allowed: false }
        ]
      }
    });
    const historical = await request({ galleryContext: top });
    expect(historical.status).toBe(200);
    const historicalBody = (await historical.json()) as { data: { items: Record<string, unknown>[] } };
    expect(historicalBody.data.items[0]).not.toHaveProperty('protocolSupport');
    const failedSnapshot = vi
      .spyOn(gateway, 'operationProtocol')
      .mockRejectedValueOnce(new Error('private-provider-message'));
    const failed = await request({ galleryContext: iop });
    expect(failed.status).toBe(500);
    const failedBody = await failed.text();
    expect(failedBody).toContain('OPERATION_AVAILABILITY_FAILED');
    expect(failedBody).not.toContain('private-provider-message');
    failedSnapshot.mockRestore();
    expect((await request({ galleryContext: iop }, false)).status).toBe(401);
    for (const changed of [
      { ...iop, identity: 'another-actor' },
      { ...iop, gateway: 'unknown-gateway' },
      { ...iop, storage: 'changed-storage' }
    ]) {
      const rejected = await request({ galleryContext: changed });
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({
        error: { code: 'GALLERY_CONTEXT_CHANGED', retryable: false }
      });
    }
    expect((await request({ protocol: 'iop' })).status).toBe(400);
    await (await dual.service('iop')).clear(1);
    const cleared = await request({ galleryContext: iop });
    expect(cleared.status).toBe(409);
    expect(await cleared.json()).toMatchObject({ error: { code: 'GALLERY_CONTEXT_CHANGED' } });
    expect(refresh).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    refresh.mockRestore();
  });

  it('matches a single-provider context only through a read-only credential snapshot', async () => {
    const { provider } = await harness();
    const credentials = present(await provider.credentialSnapshot());
    const context = {
      identity: 'validated-by-route',
      gateway: await galleryGatewayId(credentials),
      storage: null
    };
    const refresh = vi.spyOn(provider, 'requireCredentials');
    const gateway = new CredentialBackedAlibabaGatewayClient(provider);
    expect(await gateway.operationProtocol('listPhotos', {}, { galleryContext: context })).toBe('top');
    await expect(
      gateway.operationProtocol('listPhotos', {}, { galleryContext: { ...context, gateway: 'changed' } })
    ).rejects.toMatchObject({ gatewayError: { code: 'GALLERY_CONTEXT_CHANGED' } });
    expect(refresh).not.toHaveBeenCalled();
    const withoutSnapshot = new CredentialBackedAlibabaGatewayClient({
      status: () => provider.status(),
      requireCredentials: () => provider.requireCredentials()
    });
    await expect(
      withoutSnapshot.operationProtocol('listPhotos', {}, { galleryContext: context })
    ).rejects.toMatchObject({ gatewayError: { code: 'GALLERY_CONTEXT_UNAVAILABLE' } });
    expect(refresh).not.toHaveBeenCalled();
  });
  it('preserves the legacy primary ciphertext and routes configured profiles without claiming a confirmed binding', async () => {
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
    expect(await dual.selectProtocol('listProducts', {})).toBe('iop');
    expect(await dual.selectProtocol('listPhotos', {})).toBe('top');
    expect(await dual.selectProtocol('listPhotos', { groupId: '1001' })).toBe('top');
    expect(
      await dual.selectProtocol('callCapability', {
        method: 'alibaba.icbu.photobank.list',
        parameters: { group_id: '1001', location_type: 'SUB_GROUP', current_page: 1, page_size: 1 }
      })
    ).toBe('top');
    expect(await dual.selectProtocol('listPhotos', { ungrouped: true })).toBe('top');
    expect(await dual.selectProtocol('getTradeOrderAggregate', { orderId: 'test' })).toBe('top');
    expect(await dual.selectProtocol('uploadPhoto', {})).toBe('iop');
    expect((await dual.authorizations()).binding.confirmed).toBe(false);
    expect(await repository.find()).toEqual(row);
    expect(await service.status()).toMatchObject({ configured: true, revision: 1 });
  });
  it('keeps dedicated and generic photo queries on IOP when TOP is not configured', async () => {
    const { dual } = await harness();
    await (await dual.service('top')).clear(1);
    const query = { groupId: '1001', page: 1, pageSize: 1 };
    const capability = {
      method: 'alibaba.icbu.photobank.list',
      parameters: { group_id: '1001', location_type: 'SUB_GROUP', current_page: 1, page_size: 1 }
    };
    expect(await dual.selectProtocol('listPhotos', query)).toBe('iop');
    expect(await dual.selectProtocol('callCapability', capability)).toBe('iop');
    expect((await dual.resolveForOperation('listPhotos', query)).protocol).toBe('iop');
    expect((await dual.resolveForOperation('callCapability', capability)).protocol).toBe('iop');
  });
  it.each(['dedicated', 'capability'] as const)(
    'propagates IOP photo scope errors through the %s gateway without retry or TOP fallback',
    async (route) => {
      const { dual } = await harness();
      await (await dual.service('top')).clear(1);
      const send = vi.fn<NetworkTransport['send']>(() =>
        Promise.resolve(Response.json(photoFixture.scopedPhotos))
      );
      const gateway = new CredentialBackedAlibabaGatewayClient(dual, {
        transport: { send },
        maxAttempts: 3
      });
      const request =
        route === 'dedicated'
          ? gateway.request('listPhotos', { groupId: '2001', page: 1, pageSize: 1 })
          : gateway.request('callCapability', {
              method: 'alibaba.icbu.photobank.list',
              parameters: { group_id: '2001', location_type: 'SUB_GROUP', current_page: 1, page_size: 1 }
            });
      await expect(request).rejects.toMatchObject({
        gatewayError: {
          code: 'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH',
          subCode: 'PHOTO_GROUP_MISMATCH',
          traceId: photoFixture.scopedPhotos.request_id,
          retryable: false
        }
      });
      expect(send).toHaveBeenCalledOnce();
      const input = send.mock.calls[0]?.[0];
      expect(input instanceof Request ? input.url : input instanceof URL ? input.href : input).toBe(
        'https://openapi-api.alibaba.com/rest/icbu/product/photobank/list'
      );
    }
  );
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
    expect(await gateway.galleryGatewayContextId()).toBe(await galleryGatewayId(iop));
    expect(await gateway.galleryGatewayContextId(await galleryGatewayId(top))).toBe(
      await galleryGatewayId(top)
    );
    expect(await gateway.productGatewayContextId()).toBe(await galleryGatewayId(iop));
    expect(
      (
        await dual.resolveForOperation(
          'listPhotos',
          { groupId: '1001' },
          { galleryContext: { identity: 'identity', gateway: await galleryGatewayId(iop), storage: null } }
        )
      ).protocol
    ).toBe('iop');
    await (await dual.service('top')).clear(1);
    expect((await dual.authorizations()).iop?.configured).toBe(true);
    await expect(
      dual.resolveForOperation('renderProductSchema', {}, { productContext: expected })
    ).rejects.toMatchObject({ code: 'PRODUCT_CONTEXT_CHANGED' });
  });
  it('never falls back to TOP after selected IOP transport failure', async () => {
    const { dual } = await harness();
    expect((await dual.authorizations()).binding.confirmed).toBe(false);
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
