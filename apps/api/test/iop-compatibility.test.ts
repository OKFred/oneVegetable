import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestId,
  getCapabilityDefinition,
  listCapabilitiesWithAccountVerification,
  parseAlibabaOpenApiCredentialBundle
} from '@one-vegetable/core';
import * as iopBusiness from '@one-vegetable/core/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import credentialFixture from '../../../mock/data/node-gateway-credentials.json';
import tokenFixture from '../../../mock/data/alibaba-auth/iop-token-responses.json';
import fixture from '../../../mock/data/api-iop-compatibility.json';
import tradeFixture from '../../../mock/data/trades.json';
import { credentialDocumentFromBundle, parseCredentialDocument } from '../src/gateway/credential-document';
import { EnvironmentAlibabaCredentialProvider } from '../src/gateway/credentials';
import {
  AlibabaReadGatewayClient,
  CredentialBackedAlibabaGatewayClient
} from '../src/gateway/alibaba-read-gateway';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from '../src/gateway/credential-vault';
import { NodeManagedCredentialProvider } from '../src/gateway/node-managed-credentials';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { createApiApp } from '../src/app';
import { StaticOperationFeatureFlags } from '../src/abac';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';
import { SqlAuthRepository } from '../src/auth/repository';
import { AdminService } from '../src/auth/admin-service';
import { AuthService } from '../src/auth/service';
import type { GatewayClient, GatewayCredentials, NetworkTransport, OperationId } from '@one-vegetable/core';
import type { ApiAppOptions } from '../src/app';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const now = Date.parse('2026-10-12T00:00:00.000Z');
const databases: NodeDatabaseHandle[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => {
    database.connection.close();
  });
});

function iopBundle() {
  return parseAlibabaOpenApiCredentialBundle({
    ...credentialFixture.oauthBundle,
    protocol: 'iop',
    oauth: { ...credentialFixture.oauthBundle.oauth, refreshToken: tokenFixture.success.refresh_token }
  });
}
function gatewayCredentials(protocol: 'top' | 'iop' = 'iop'): GatewayCredentials {
  return {
    ...credentialFixture.manual,
    protocol,
    endpoint: protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac'
  };
}
function transportUrl(input: Parameters<NetworkTransport['send']>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function harness(clock: () => number = () => now) {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const repository = new SqlGatewayCredentialRepository(database.executor);
  const cipher = await GatewayCredentialCipher.create(btoa('k'.repeat(32)).replace(/=+$/u, ''));
  const service = new GatewayCredentialService(repository, cipher, clock, 'sqlite-vault');
  return { database, repository, cipher, service };
}
async function importIop(service: GatewayCredentialService, expectedRevision: number | null = null) {
  return service.import({ bundle: iopBundle(), actorId: 'fixture-admin', expectedRevision, remark: null });
}
function fixtureTradeOrder() {
  const order = tradeFixture.tradeOrders[0];
  if (!order) throw new Error('Missing mock trade order');
  return order;
}

describe('explicit TOP / IOP credential compatibility', () => {
  it.each([undefined, 'top', 'iop'] as const)(
    'preserves document protocol %s without rewriting a legacy bundle',
    (protocol) => {
      const input = parseAlibabaOpenApiCredentialBundle({
        ...credentialFixture.oauthBundle,
        ...(protocol ? { protocol } : {})
      });
      const document = credentialDocumentFromBundle(input, 'fixture-generation');
      expect(document.credentials.protocol).toBe(protocol);
      expect(parseCredentialDocument(document)).toEqual(document);
      const historical = parseCredentialDocument(input);
      expect(historical.credentials.protocol).toBe(protocol);
      expect(historical.configurationId).toBe(`legacy:${input.capturedAtUtc}`);
      expect(historical.authorization).toEqual(input);
    }
  );
  it('rejects mixed authorization, tokens or protocol rather than guessing', () => {
    const document = credentialDocumentFromBundle(iopBundle());
    expect(() =>
      parseCredentialDocument({ ...document, credentials: { ...document.credentials, protocol: 'top' } })
    ).toThrow('INVALID_CREDENTIAL_DOCUMENT');
    expect(() =>
      parseCredentialDocument({
        ...document,
        credentials: { ...document.credentials, accessToken: tokenFixture.success.access_token }
      })
    ).toThrow('INVALID_CREDENTIAL_DOCUMENT');
  });
  it('leaves historical TOP ciphertext and configuration identities unchanged on read', async () => {
    const h = await harness();
    const bundle = parseAlibabaOpenApiCredentialBundle(credentialFixture.oauthBundle);
    const encrypted = await h.cipher.encrypt(bundle);
    await h.repository.save({
      ...encrypted,
      actorId: 'fixture-admin',
      expectedRevision: null,
      accessTokenExpiresTimeUtc: null,
      refreshTokenExpiresTimeUtc: null,
      now,
      remark: null
    });
    const before = await h.repository.find();
    const provider = new StoredAlibabaCredentialProvider(h.repository, h.cipher, { clock: () => now });
    expect(await provider.requireCredentials()).toMatchObject({
      protocol: 'top',
      endpoint: 'https://eco.taobao.com/router/rest',
      galleryAccountGeneration: `legacy:${bundle.capturedAtUtc}`
    });
    expect(await h.repository.find()).toEqual(before);
    expect(await provider.status()).toMatchObject({
      protocol: 'top',
      endpointOrigin: 'https://eco.taobao.com'
    });
  });
  it('switches stored credentials immediately and invalidates account contexts even with reused keys and tokens', async () => {
    const h = await harness();
    const stored = new StoredAlibabaCredentialProvider(h.repository, h.cipher, { clock: () => now });
    const managed = new NodeManagedCredentialProvider(h.repository, stored, h.service, {});
    const gateway = new CredentialBackedAlibabaGatewayClient(managed);
    const before = await h.service.save({
      credentials: credentialFixture.manual,
      actorId: 'fixture-admin',
      expectedRevision: null,
      remark: null
    });
    const context = await gateway.galleryGatewayContextId();
    await h.service.save({
      credentials: { ...credentialFixture.manual, protocol: 'iop' },
      actorId: 'fixture-admin',
      expectedRevision: before.revision,
      remark: null
    });
    expect(await managed.summary()).toMatchObject({
      protocol: 'iop',
      source: 'sqlite-vault',
      updaterId: 'fixture-admin'
    });
    expect(await managed.status()).toMatchObject({ protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT });
    expect(await gateway.galleryGatewayContextId()).not.toBe(context);
    const top = new AlibabaReadGatewayClient({
      ...gatewayCredentials('top'),
      galleryAccountGeneration: 'same-generation'
    });
    const iop = new AlibabaReadGatewayClient({
      ...gatewayCredentials(),
      galleryAccountGeneration: 'same-generation'
    });
    expect(await iop.galleryGatewayContextId()).not.toBe(await top.galleryGatewayContextId());
    await expect(
      iop.request(
        'listProducts',
        {},
        {
          requestId: createRequestId(),
          productContext: { identity: 'a'.repeat(64), gateway: await top.galleryGatewayContextId() }
        }
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' } });
  });
  it.each(['manual', 'oauth-import'] as const)(
    'refreshes %s via IOP once while preserving configuration and actor metadata',
    async (source) => {
      const h = await harness();
      const before =
        source === 'oauth-import'
          ? await importIop(h.service)
          : await h.service.save({
              credentials: {
                ...credentialFixture.manual,
                protocol: 'iop',
                refreshToken: tokenFixture.success.refresh_token
              },
              actorId: 'fixture-admin',
              expectedRevision: null,
              remark: null
            });
      const send = vi.fn<NetworkTransport['send']>((input, init) => {
        expect(transportUrl(input)).toBe(`${IOP_BUSINESS_ENDPOINT}/auth/token/refresh`);
        if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
        expect(init.body.get('refresh_token')).toBe(tokenFixture.success.refresh_token);
        expect(init.body.get('sign_method')).toBe('sha256');
        expect(init.body.has('client_secret')).toBe(false);
        expect(init.body.has('session')).toBe(false);
        expect(init.body.get('sign')).toMatch(/^[A-F0-9]{64}$/u);
        return Promise.resolve(Response.json(tokenFixture.success));
      });
      const provider = new StoredAlibabaCredentialProvider(h.repository, h.cipher, {
        transport: { send },
        clock: () => now,
        source: 'sqlite-vault'
      });
      const result = await provider.requireCredentials(createRequestId(), true);
      expect(result).toMatchObject({
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        accessToken: tokenFixture.success.access_token,
        galleryAccountGeneration: before.configurationId
      });
      expect(send).toHaveBeenCalledOnce();
      expect(await h.service.status()).toMatchObject({
        protocol: 'iop',
        configurationId: before.configurationId,
        revision: 2,
        lastRefreshTimeUtc: now,
        updaterId: 'system:maintenance',
        canRefresh: true
      });
      const record = await h.repository.find();
      if (!record) throw new Error('Missing fixture record');
      expect(record.creatorId).toBe('fixture-admin');
      const document = await h.cipher.decryptDocument(record);
      expect(document.credentials.protocol).toBe('iop');
      expect(document.authorization?.protocol ?? (source === 'manual' ? 'iop' : undefined)).toBe('iop');
    }
  );
  it.each(['invalid-json', 'missing-success', 'server-error', 'network-error'] as const)(
    'fences unknown IOP refresh %s across retries/restart until reauthorization',
    async (scenario) => {
      const h = await harness();
      const before = await importIop(h.service);
      const send = vi.fn<NetworkTransport['send']>(() => {
        if (scenario === 'network-error') return Promise.reject(new TypeError('fixture network failure'));
        return Promise.resolve(
          scenario === 'invalid-json'
            ? new Response('<html>fixture</html>')
            : Response.json(
                scenario === 'missing-success' ? tokenFixture.missingSuccess : tokenFixture.success,
                { status: scenario === 'server-error' ? 503 : 200 }
              )
        );
      });
      const provider = () =>
        new StoredAlibabaCredentialProvider(h.repository, h.cipher, {
          transport: { send },
          clock: () => now
        });
      await expect(provider().requireCredentials(createRequestId(), true)).rejects.toMatchObject({
        code: 'IOP_TOKEN_RESULT_UNKNOWN'
      });
      expect(await h.service.status()).toMatchObject({
        protocol: 'iop',
        revision: before.revision,
        canRefresh: false,
        lastRefreshErrorCode: 'IOP_TOKEN_RESULT_UNKNOWN'
      });
      await expect(provider().requireCredentials(createRequestId(), true)).rejects.toMatchObject({
        code: 'IOP_TOKEN_RESULT_UNKNOWN'
      });
      expect((await provider().requireCredentials()).accessToken).toBe(iopBundle().oauth.accessToken);
      expect(send).toHaveBeenCalledOnce();
      await importIop(h.service, before.revision);
      expect(await h.service.status()).toMatchObject({ canRefresh: true, lastRefreshErrorCode: null });
      send.mockResolvedValue(Response.json(tokenFixture.success));
      await provider().requireCredentials(createRequestId(), true);
      expect(send).toHaveBeenCalledTimes(2);
    }
  );
  it('persists the one-shot fence before transport and retains it if storing the success fails', async () => {
    const h = await harness();
    await importIop(h.service);
    vi.spyOn(h.repository, 'completeRefresh').mockRejectedValueOnce(new Error('Fixture persistence failure'));
    const send = vi.fn<NetworkTransport['send']>(async () => {
      expect((await h.repository.find())?.lastRefreshErrorCode).toBe('IOP_TOKEN_RESULT_UNKNOWN');
      return Response.json(tokenFixture.success);
    });
    const provider = new StoredAlibabaCredentialProvider(h.repository, h.cipher, {
      transport: { send },
      clock: () => now
    });
    await expect(provider.requireCredentials(createRequestId(), true)).rejects.toMatchObject({
      code: 'IOP_TOKEN_RESULT_UNKNOWN'
    });
    await expect(provider.requireCredentials(createRequestId(), true)).rejects.toMatchObject({
      code: 'IOP_TOKEN_RESULT_UNKNOWN'
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('does not reuse the consumed IOP refresh token when the response omits a replacement', async () => {
    const h = await harness();
    await importIop(h.service);
    const withoutRefresh = { ...tokenFixture.success, refresh_token: null };
    const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(withoutRefresh));
    const provider = new StoredAlibabaCredentialProvider(h.repository, h.cipher, {
      transport: { send },
      clock: () => now
    });
    await provider.requireCredentials(createRequestId(), true);
    expect(await h.service.status()).toMatchObject({ canRefresh: false });
    await expect(provider.requireCredentials(createRequestId(), true)).rejects.toMatchObject({
      code: 'ALIBABA_REFRESH_TOKEN_MISSING'
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('reports an active IOP lease as IN_PROGRESS and refreshes only once under concurrency', async () => {
    const h = await harness();
    await importIop(h.service);
    const started = Promise.withResolvers<boolean>();
    const result = Promise.withResolvers<Response>();
    const send = vi.fn<NetworkTransport['send']>(() => {
      started.resolve(true);
      return result.promise;
    });
    const provider = () =>
      new StoredAlibabaCredentialProvider(h.repository, h.cipher, { transport: { send }, clock: () => now });
    const first = provider().requireCredentials(createRequestId(), true);
    await started.promise;
    try {
      await expect(provider().requireCredentials(createRequestId(), true)).rejects.toMatchObject({
        code: 'ALIBABA_CREDENTIAL_REFRESH_IN_PROGRESS'
      });
      expect(await h.service.status()).toMatchObject({
        lastRefreshErrorCode: 'ALIBABA_CREDENTIAL_REFRESH_IN_PROGRESS',
        canRefresh: false
      });
      expect(await provider().status()).toMatchObject({
        lastRefreshErrorCode: 'ALIBABA_CREDENTIAL_REFRESH_IN_PROGRESS'
      });
      expect((await provider().requireCredentials()).accessToken).toBe(iopBundle().oauth.accessToken);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      result.resolve(Response.json(tokenFixture.success));
    }
    expect((await first).accessToken).toBe(tokenFixture.success.access_token);
    expect(await h.service.status()).toMatchObject({
      lastRefreshErrorCode: null,
      revision: 2,
      canRefresh: true
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'retains a process-interruption fence after lease expiry, expired access=%s',
    async (expired) => {
      let clock = now;
      const h = await harness(() => clock);
      const bundle = iopBundle();
      if (expired) bundle.oauth.expiresAtUtc = new Date(now + 30_000).toISOString();
      await h.service.import({ bundle, actorId: 'fixture-admin', expectedRevision: null, remark: null });
      const record = await h.repository.find();
      if (!record) throw new Error('Missing fixture record');
      // Simulate an isolate disappearing after acquiring the durable one-shot fence.
      expect(
        await h.repository.acquireRefreshLease(
          'fixture-interrupted-lease',
          now,
          record.revision,
          'IOP_TOKEN_RESULT_UNKNOWN'
        )
      ).toBe(true);
      const send = vi.fn<NetworkTransport['send']>();
      const provider = () =>
        new StoredAlibabaCredentialProvider(h.repository, h.cipher, {
          transport: { send },
          clock: () => clock
        });
      await expect(provider().requireCredentials(createRequestId(), true)).rejects.toMatchObject({
        code: 'ALIBABA_CREDENTIAL_REFRESH_IN_PROGRESS'
      });
      clock += 60_001;
      expect(await h.service.status()).toMatchObject({
        lastRefreshErrorCode: 'IOP_TOKEN_RESULT_UNKNOWN',
        canRefresh: false
      });
      await expect(provider().requireCredentials(createRequestId(), true)).rejects.toMatchObject({
        code: 'IOP_TOKEN_RESULT_UNKNOWN'
      });
      if (expired)
        await expect(provider().requireCredentials()).rejects.toMatchObject({
          code: 'ALIBABA_ACCESS_TOKEN_EXPIRED'
        });
      else expect((await provider().requireCredentials()).accessToken).toBe(bundle.oauth.accessToken);
      expect(send).not.toHaveBeenCalled();
      expect(
        await h.repository.acquireRefreshLease(
          'fixture-retry-lease',
          clock,
          record.revision,
          'IOP_TOKEN_RESULT_UNKNOWN'
        )
      ).toBe(false);
      const before = await h.repository.find();
      expect(before?.encryptedBundle).toBe(record.encryptedBundle);
    }
  );

  it('returns a safe IOP rejection without exposing the provider body or replacing credentials', async () => {
    const h = await harness();
    await importIop(h.service);
    const before = await h.repository.find();
    const send = vi
      .fn<NetworkTransport['send']>()
      .mockResolvedValue(Response.json(tokenFixture.invalidAppKey));
    const provider = new StoredAlibabaCredentialProvider(h.repository, h.cipher, {
      transport: { send },
      clock: () => now
    });
    await expect(provider.requireCredentials(createRequestId(), true)).rejects.toMatchObject({
      code: 'IOP_TOKEN_REJECTED'
    });
    expect((await h.repository.find())?.encryptedBundle).toBe(before?.encryptedBundle);
    expect((await provider.requireCredentials()).accessToken).toBe(iopBundle().oauth.accessToken);
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('IOP API gateway integration without external networking', () => {
  it.each([undefined, 'top', 'iop'] as const)(
    'keeps catalog and definition availability consistent with protocol %s without network access',
    async (protocol) => {
      const send = vi.fn<NetworkTransport['send']>();
      const { protocol: _protocol, ...credentials } = gatewayCredentials(protocol ?? 'top');
      const gateway = new AlibabaReadGatewayClient(
        { ...credentials, ...(protocol ? { protocol } : {}) },
        { transport: { send } }
      );
      const originals = listCapabilitiesWithAccountVerification();
      const capabilities = await gateway.request('listCapabilities', undefined);
      expect(capabilities).toHaveLength(originals.length);
      for (const method of ['alibaba.icbu.product.list', 'alibaba.icbu.product.country.getcountrylist']) {
        const original = originals.find((capability) => capability.method === method);
        const definition = getCapabilityDefinition(method);
        expect(original).toBeDefined();
        expect(definition).not.toBeNull();
        const unsupported = protocol === 'iop' && method !== 'alibaba.icbu.product.list';
        expect(capabilities.find((capability) => capability.method === method)).toEqual(
          unsupported ? { ...original, realCallEnabled: false } : original
        );
        expect(await gateway.request('getCapabilityDefinition', { method })).toEqual(
          unsupported ? { ...definition, realCallEnabled: false } : definition
        );
      }
      expect(listCapabilitiesWithAccountVerification()).toEqual(originals);
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('routes a mapped read to IOP with no TOP parameters', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      expect(transportUrl(input)).toBe(`${IOP_BUSINESS_ENDPOINT}/alibaba/icbu/product/list`);
      if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
      expect(init.body.get('access_token')).toBe(credentialFixture.manual.accessToken);
      expect(init.body.get('sign_method')).toBe('sha256');
      expect(init.body.has('session')).toBe(false);
      expect(init.body.has('method')).toBe(false);
      return Promise.resolve(Response.json(fixture.productList));
    });
    const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
    expect(await gateway.request('listProducts', {})).toMatchObject({
      total: 1,
      items: [{ id: '123', subject: 'Fixture product' }]
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('translates schema parameters to render_request and keeps the adapter read client on IOP', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      expect(transportUrl(input)).toBe(`${IOP_BUSINESS_ENDPOINT}/icbu/product/schema/render`);
      if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
      expect(init.body.has('param_product_top_publish_request')).toBe(false);
      expect(JSON.parse(init.body.get('render_request') ?? 'null')).toMatchObject({
        product_id: 123,
        language: 'en_US'
      });
      return Promise.resolve(Response.json(fixture.schema));
    });
    const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
    expect(
      await gateway.request('renderProductSchema', { ...fixture.renderPayload, language: 'en_US' })
    ).toMatchObject({ xml: fixture.schema.result.data });
    expect(send).toHaveBeenCalledOnce();
  });
  it('allows only explicit photo SUB_GROUP and translates groupId', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      expect(transportUrl(input)).toBe(`${IOP_BUSINESS_ENDPOINT}/icbu/product/photobank/list`);
      if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
      expect(init.body.get('groupId')).toBe('10');
      expect(init.body.has('location_type')).toBe(false);
      expect(init.body.has('group_id')).toBe(false);
      return Promise.resolve(Response.json(fixture.photos));
    });
    const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
    for (const payload of [{}, { ungrouped: true }, { groupId: '-1' }])
      await expect(gateway.request('listPhotos', payload)).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_PHOTO_GROUP_REQUIRED' }
      });
    expect(send).not.toHaveBeenCalled();
    expect(await gateway.request('listPhotos', { groupId: '10' })).toMatchObject({
      total: 1,
      items: [{ id: '1001' }]
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('consumes seller order list normalization without dropping role, status, pagination or dates', async () => {
    const order = fixtureTradeOrder();
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      expect(transportUrl(input)).toBe(`${IOP_BUSINESS_ENDPOINT}/alibaba/order/list`);
      if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
      expect(init.body.get('role')).toBe('seller');
      expect(init.body.get('start_page')).toBe('1');
      expect(init.body.get('page_size')).toBe('20');
      expect(init.body.get('status')).toBe(order.status);
      expect(JSON.parse(init.body.get('create_date_start') ?? 'null')).toEqual({ date_str: order.createdAt });
      expect(init.body.has('param_trade_ecology_order_list_query')).toBe(false);
      expect(init.body.has('session')).toBe(false);
      return Promise.resolve(
        Response.json({
          code: '0',
          value: {
            total_count: 1,
            order_list: [
              {
                trade_id: order.id,
                trade_status: order.status,
                create_date: { timestamp: Date.parse(order.createdAt) },
                modify_date: { timestamp: Date.parse(order.modifiedAt) }
              }
            ]
          }
        })
      );
    });
    const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
    expect(
      await gateway.request('listTradeOrders', {
        page: 2,
        pageSize: 20,
        status: order.status,
        createDateStart: order.createdAt
      })
    ).toEqual({
      items: [{ ...order, buyerLoginId: null, amount: null, currency: null }],
      page: 2,
      pageSize: 20,
      total: 1,
      documentTimeZoneUnverified: true
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('rejects the undocumented buyer filter before seller order networking', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
    await expect(
      gateway.request('listTradeOrders', { buyerLoginId: fixtureTradeOrder().buyerLoginId })
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED', retryable: false }
    });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'independently degrades unsupported aggregate funds with valid logistics=%s',
    async (valid) => {
      const order = fixtureTradeOrder();
      const logistics = tradeFixture.responses.getTradeOrderLogistics;
      const send = vi.fn<NetworkTransport['send']>((input, init) => {
        expect(transportUrl(input)).toBe(`${IOP_BUSINESS_ENDPOINT}/order/logistics/query`);
        if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
        expect(init.body.get('trade_id')).toBe(order.id);
        expect(init.body.has('e_trade_id')).toBe(false);
        return Promise.resolve(
          Response.json({
            code: 0,
            value: valid
              ? {
                  logistic_status: logistics.status,
                  shipping_order_list: []
                }
              : {}
          })
        );
      });
      const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
      expect(await gateway.request('getTradeOrderAggregate', { order })).toEqual({
        order,
        fund: null,
        logistics: valid ? logistics : null,
        availability: {
          order: 'available',
          fund: 'unavailable',
          logistics: valid ? 'available' : 'unavailable',
          fullDetail: 'jushita-only'
        }
      });
      // No fund network call and no retry/replacement request for malformed logistics.
      expect(send).toHaveBeenCalledOnce();
    }
  );
  it('keeps standalone funds and RFQ dedicated/capability calls uniformly unsupported', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
    for (const operation of [
      'getTradeOrderFund',
      'listRfqs',
      'listRecommendedRfqs',
      'getRfq',
      'getRfqEquity',
      'getRfqReadStatus'
    ] satisfies OperationId[])
      await expect(gateway.request<OperationId>(operation, {})).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED', retryable: false }
      });
    for (const method of ['alibaba.seller.order.fund.get', 'alibaba.icbu.rfq.search']) {
      await expect(gateway.request('callCapability', { method, parameters: {} })).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
      });
      expect(await gateway.request('getCapabilityDefinition', { method })).toMatchObject({
        realCallEnabled: false
      });
    }
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['uploadPhoto', 'listVideos', 'getRfq', 'downloadProductAsset'] satisfies OperationId[])(
    'rejects %s before any gateway network call',
    async (operation) => {
      const send = vi.fn<NetworkTransport['send']>();
      const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
      await expect(gateway.request<OperationId>(operation, {})).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED', retryable: false }
      });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it.each(['publishProduct', 'updateProduct'] as const)(
    'keeps mapped but unverified %s blocked before network access',
    async (operation) => {
      const send = vi.fn<NetworkTransport['send']>();
      const gateway = new AlibabaReadGatewayClient(gatewayCredentials(), { transport: { send } });
      await expect(gateway.request<OperationId>(operation, {})).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_MUTATION_UNVERIFIED', retryable: false }
      });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it('rejects unmapped capability reads/writes before credential refresh as well as transport', async () => {
    const provider = new EnvironmentAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_PROTOCOL: 'iop' });
    const requireCredentials = vi.fn<() => Promise<GatewayCredentials>>();
    const gateway = new CredentialBackedAlibabaGatewayClient({
      status: () => Promise.resolve(provider.status()),
      requireCredentials
    });
    for (const method of ['alibaba.icbu.product.schema.add', 'alibaba.icbu.product.country.getcountrylist'])
      await expect(gateway.request('callCapability', { method, parameters: {} })).rejects.toMatchObject({
        gatewayError: { code: iopBusiness.iopOperationReason('callCapability', method) }
      });
    expect(requireCredentials).not.toHaveBeenCalled();
  });
  it.each(['node', 'cloudflare'] as const)(
    'denies availability and calls before task registration in %s with the same CORS/wrapper',
    async (runtime) => {
      const h = await harness();
      const jobs = new SqlProductMutationJobRepository(h.database.executor);
      const registrations = ['create', 'createCreation', 'createDisplay'].map((method) =>
        vi.spyOn(jobs, method as 'create' | 'createCreation' | 'createDisplay')
      );
      const request = vi.fn<GatewayClient['request']>();
      const logger = vi.fn();
      const authRepository = new SqlAuthRepository(h.database.executor);
      const authService = new AuthService({
        repository: authRepository,
        bootstrapToken: credentialFixture.workbench.password
      });
      const session = await authService.bootstrap({
        requestId: createRequestId(),
        bootstrapToken: credentialFixture.workbench.password,
        ...credentialFixture.workbench
      });
      const app = createApiApp({
        runtime,
        database: runtime === 'node' ? 'sqlite' : 'd1',
        environment: 'test',
        gatewayMode: 'real',
        gateway: { request },
        gatewayStatus: new EnvironmentAlibabaCredentialProvider({
          ONE_VEGETABLE_ALIBABA_PROTOCOL: 'iop'
        }).status(),
        authService,
        adminService: new AdminService(authRepository),
        productMutationJobs: jobs,
        featureFlags: new StaticOperationFeatureFlags(new Set(['operation:publishProduct'])),
        allowedOrigins: ['http://localhost'],
        logger
      });
      const headers = {
        'content-type': 'application/json',
        Origin: 'http://localhost',
        Cookie: `ov_session=${session.sessionToken}`,
        'X-CSRF-Token': session.session.csrfToken
      };
      const availability = await app.request('/api/v1/operations/availability/get', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requestId: createRequestId(),
          operations: [
            'listProducts',
            'publishProduct',
            'getRfq',
            'getProductSchema',
            'listTradeOrders',
            'getTradeOrderAggregate',
            'getTradeOrderFund'
          ]
        })
      });
      expect(availability.status).toBe(200);
      expect(await availability.json()).toMatchObject({
        ok: true,
        data: {
          items: [
            { operation: 'listProducts', allowed: true },
            { operation: 'publishProduct', allowed: false, reasonCode: 'ALIBABA_IOP_MUTATION_UNVERIFIED' },
            { operation: 'getRfq', allowed: false, reasonCode: 'ALIBABA_IOP_METHOD_UNSUPPORTED' },
            { operation: 'getProductSchema', allowed: true },
            { operation: 'listTradeOrders', allowed: true },
            { operation: 'getTradeOrderAggregate', allowed: true },
            { operation: 'getTradeOrderFund', allowed: false, reasonCode: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
          ]
        }
      });
      const requestId = createRequestId();
      const response = await app.request('/api/v1/operations/call', {
        method: 'POST',
        headers,
        body: JSON.stringify({ requestId, operation: 'publishProduct', payload: fixture.draftPayload })
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('X-Request-ID')).toBe(requestId);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost');
      expect(await response.json()).toMatchObject({
        requestId,
        ok: false,
        error: { code: 'ALIBABA_IOP_MUTATION_UNVERIFIED', retryable: false }
      });
      expect(logger).toHaveBeenLastCalledWith(
        expect.objectContaining({ actorId: session.user.id, outcome: 'denied', statusCode: 403 })
      );
      for (const register of registrations) expect(register).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }
  );
  it('resolves live protocol per request and retains missing-protocol TOP behavior', async () => {
    let protocol: 'top' | 'iop' | undefined;
    const gateway = { request: vi.fn<GatewayClient['request']>().mockResolvedValue(undefined) };
    const options: ApiAppOptions = {
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      gateway,
      gatewayStatus: () =>
        Promise.resolve({
          source: 'environment',
          configured: true,
          hasAppKey: true,
          hasAppSecret: true,
          hasAccessToken: true,
          endpointOrigin: 'https://eco.taobao.com',
          signMethod: 'hmac',
          ...(protocol ? { protocol } : {})
        })
    };
    const app = createApiApp(options);
    const run = () =>
      app.request('/api/v1/operations/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: createRequestId(), operation: 'getRfq', payload: {} })
      });
    expect((await run()).status).toBe(200);
    protocol = 'iop';
    expect((await run()).status).toBe(403);
    protocol = 'top';
    expect((await run()).status).toBe(200);
    expect(gateway.request).toHaveBeenCalledTimes(2);
  });
});
