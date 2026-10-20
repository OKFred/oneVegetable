import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlibabaClient, createRequestId, GatewayException } from '@one-vegetable/core';
import * as iopBusiness from '@one-vegetable/core/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import { opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import credentialFixture from '../../../mock/data/node-gateway-credentials.json';
import fixture from '../../../mock/data/api-iop-compatibility.json';
import productFixture from '../../../mock/data/products.json';
import { createApiApp } from '../src/app';
import { StaticOperationFeatureFlags } from '../src/abac';
import { AuthService } from '../src/auth/service';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import {
  AlibabaReadGatewayClient,
  CredentialBackedAlibabaGatewayClient
} from '../src/gateway/alibaba-read-gateway';
import { EnvironmentAlibabaCredentialProvider } from '../src/gateway/credentials';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';
import type { GatewayClient, GatewayCredentials, OperationId, NetworkTransport } from '@one-vegetable/core';
import type { ApiRuntime } from '../src/app';
import type { NodeDatabaseHandle } from '../src/db/node-database';
import type { GatewayRequestContext } from '../src/gateway/alibaba-read-gateway';

const writes = ['publishProduct', 'saveProductDraft', 'updateProduct', 'updateProductDisplay'] as const;
const product = fixtureProduct();
const databases: NodeDatabaseHandle[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((database) => {
    database.connection.close();
  });
});

function fixtureProduct() {
  const value = productFixture.responses.listProducts.items[0];
  if (!value) throw new Error('Missing mock product');
  return value;
}

// Display remains unsupported. Only its hypothetical lifecycle tests simulate a future gate.
// The three accepted schema writes always exercise the real, unmodified protocol policy.
function acceptFutureDisplay(operation: OperationId) {
  if (operation !== 'updateProductDisplay') return;
  const original = iopBusiness.iopOperationReason;
  vi.spyOn(iopBusiness, 'iopOperationReason').mockImplementation((operation, method) =>
    operation === 'updateProductDisplay' ? null : original(operation, method)
  );
}

function payload(operation: (typeof writes)[number]) {
  if (operation === 'updateProduct')
    return {
      ...fixture.renderPayload,
      productId: product.id,
      schemaPatchXml: fixture.schema.result.data
    };
  if (operation === 'updateProductDisplay')
    return {
      productIds: [product.id],
      encryptedProductIds: [product.encryptedId],
      display: 'offline' as const
    };
  return fixture.draftPayload;
}

async function appHarness(
  gateway: GatewayClient & { galleryGatewayContextId?: () => Promise<string> },
  runtime: ApiRuntime = 'node',
  protocol: 'top' | 'iop' = 'iop',
  role: 'admin' | 'user' = 'admin'
) {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const repository = new SqlAuthRepository(database.executor);
  const authService = new AuthService({ repository, bootstrapToken: credentialFixture.workbench.password });
  let session = await authService.bootstrap({
    requestId: createRequestId(),
    bootstrapToken: credentialFixture.workbench.password,
    ...credentialFixture.workbench
  });
  if (role === 'user') {
    const username = 'fixture-readonly';
    await new AdminService(repository).createUser({
      requestId: createRequestId(),
      username,
      password: credentialFixture.workbench.password,
      role,
      actor: { actorId: session.user.id, username: session.user.username, role: 'admin', source: 'bff' }
    });
    session = await authService.login({
      requestId: createRequestId(),
      username,
      password: credentialFixture.workbench.password
    });
  }
  const jobs = new SqlProductMutationJobRepository(database.executor);
  const registrations = [
    vi.spyOn(jobs, 'create'),
    vi.spyOn(jobs, 'createCreation'),
    vi.spyOn(jobs, 'createDisplay')
  ];
  const app = createApiApp({
    runtime,
    database: runtime === 'node' ? 'sqlite' : 'd1',
    environment: 'test',
    gatewayMode: 'real',
    gateway,
    gatewayStatus: new EnvironmentAlibabaCredentialProvider({
      ONE_VEGETABLE_ALIBABA_PROTOCOL: protocol
    }).status(),
    authService,
    productMutationJobs: jobs,
    featureFlags: new StaticOperationFeatureFlags(
      new Set(writes.map((operation) => `operation:${operation}`))
    ),
    allowedOrigins: ['http://localhost']
  });
  const headers = {
    'content-type': 'application/json',
    Origin: 'http://localhost',
    Cookie: `ov_session=${session.sessionToken}`,
    'X-CSRF-Token': session.session.csrfToken
  };
  const identity = await opaqueGalleryId(session.user.id);
  return {
    app,
    jobs,
    registrations,
    identity,
    refresh: (job: { id: string; revision: number }) =>
      app.request('/api/v1/product-mutation-jobs/refresh', {
        method: 'POST',
        headers,
        body: JSON.stringify({ requestId: createRequestId(), id: job.id, revision: job.revision })
      }),
    call: (operation: OperationId, request: unknown, context?: { identity: string; gateway: string }) =>
      app.request('/api/v1/operations/call', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requestId: createRequestId(),
          operation,
          payload: request,
          ...(context ? { productContext: context } : {})
        })
      })
  };
}

describe('accepted IOP write BFF consistency (display simulation only)', () => {
  it.each([
    ['publishProduct', true],
    ['publishProduct', 'true'],
    ['saveProductDraft', true],
    ['saveProductDraft', 'true'],
    ['updateProduct', true],
    ['updateProduct', 'true']
  ] as const)(
    'feeds documented %s success=%s through the real normalizer and adapter',
    async (operation, success) => {
      const send = vi.fn<NetworkTransport['send']>((input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path =
          operation === 'publishProduct'
            ? '/icbu/product/schema/add'
            : operation === 'saveProductDraft'
              ? '/icbu/product/schema/add/draft'
              : '/icbu/product/schema/update';
        expect(url).toBe(IOP_BUSINESS_ENDPOINT + path);
        if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
        expect(init.body.get('access_token')).toBe(credentialFixture.manual.accessToken);
        expect(init.body.get('sign_method')).toBe('sha256');
        expect(init.body.has('session')).toBe(false);
        expect(init.body.has('method')).toBe(false);
        const business: unknown =
          operation === 'updateProduct'
            ? Object.fromEntries(init.body)
            : JSON.parse(
                init.body.get(
                  operation === 'publishProduct' ? 'publish_request' : 'param_product_top_publish_request'
                ) ?? 'null'
              );
        expect(business).toMatchObject({
          cat_id:
            operation === 'updateProduct'
              ? String(fixture.renderPayload.categoryId)
              : fixture.draftPayload.categoryId,
          language: fixture.draftPayload.language,
          xml: operation === 'updateProduct' ? fixture.schema.result.data : fixture.draftPayload.schemaXml
        });
        if (operation === 'updateProduct') expect(init.body.get('product_id')).toBe(product.id);
        return Promise.resolve(
          Response.json({
            code: 0,
            result: {
              success,
              ...(operation === 'publishProduct' ? { data: product.id } : { product_id: product.id })
            }
          })
        );
      });
      const gateway = new AlibabaReadGatewayClient(
        {
          ...credentialFixture.manual,
          protocol: 'iop',
          endpoint: IOP_BUSINESS_ENDPOINT,
          signMethod: 'hmac'
        },
        { transport: { send } }
      );
      expect(
        await gateway.request<OperationId>(operation, payload(operation), {
          requestId: createRequestId(),
          productContext: {
            identity: await opaqueGalleryId('fixture-admin'),
            gateway: await gateway.galleryGatewayContextId()
          }
        })
      ).toMatchObject({
        success: true,
        productId: product.id
      });
      expect(send).toHaveBeenCalledOnce();
    }
  );

  it.each(['publishProduct', 'saveProductDraft', 'updateProduct'] as const)(
    'rejects uncertain %s envelopes before adapter success and never retries',
    async (operation) => {
      const send = vi
        .fn<NetworkTransport['send']>()
        .mockResolvedValue(Response.json({ code: 0, result: { success: 'true' } }));
      const wait = vi.fn<() => Promise<void>>();
      const gateway = new AlibabaReadGatewayClient(
        {
          ...credentialFixture.manual,
          protocol: 'iop',
          endpoint: IOP_BUSINESS_ENDPOINT,
          signMethod: 'hmac'
        },
        { transport: { send }, wait, maxAttempts: 3 }
      );
      await expect(gateway.request<OperationId>(operation, payload(operation))).rejects.toMatchObject({
        gatewayError: { retryable: false }
      });
      expect(send).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
    }
  );

  it.each(['top', 'iop'] as const)(
    'keeps %s mutation transport failures to one attempt without a supplied context',
    async (protocol) => {
      const send = vi
        .fn<NetworkTransport['send']>()
        .mockRejectedValue(new Error('Fixture transport interruption'));
      const wait = vi.fn<() => Promise<void>>();
      const gateway = new AlibabaReadGatewayClient(
        {
          ...credentialFixture.manual,
          protocol,
          endpoint: protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : 'https://eco.taobao.com/router/rest',
          signMethod: 'hmac'
        },
        { transport: { send }, wait, maxAttempts: 3 }
      );
      await expect(
        gateway.request<OperationId>('updateProduct', payload('updateProduct'))
      ).rejects.toBeInstanceOf(GatewayException);
      expect(send).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
    }
  );

  it.each(writes)(
    'rejects changed credential context before %s registers any task or dispatches',
    async (operation) => {
      acceptFutureDisplay(operation);
      const request = vi.fn<GatewayClient['request']>();
      const galleryGatewayContextId = vi
        .fn()
        .mockResolvedValue(await opaqueGalleryId('fixture-current-generation'));
      const h = await appHarness({ request, galleryGatewayContextId });
      const response = await h.call(operation, payload(operation), {
        identity: h.identity,
        gateway: await opaqueGalleryId('fixture-stale-generation')
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'PRODUCT_CONTEXT_CHANGED', retryable: false }
      });
      expect(galleryGatewayContextId).toHaveBeenCalledOnce();
      for (const register of h.registrations) expect(register).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }
  );

  it.each(['node', 'cloudflare'] as const)(
    'checks current credentials before task creation in %s even without a supplied context',
    async (runtime) => {
      const request = vi.fn<GatewayClient['request']>();
      const galleryGatewayContextId = vi.fn().mockRejectedValue(
        new GatewayException({
          code: 'ALIBABA_CREDENTIALS_NOT_CONFIGURED',
          message: 'Fixture credentials unavailable',
          retryable: false
        })
      );
      const h = await appHarness({ request, galleryGatewayContextId }, runtime);
      const response = await h.call('saveProductDraft', fixture.draftPayload);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'ALIBABA_CREDENTIALS_NOT_CONFIGURED' }
      });
      for (const register of h.registrations) expect(register).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    }
  );

  it.each(writes)('forwards the bound context through %s and its immediate readback', async (operation) => {
    acceptFutureDisplay(operation);
    const gatewayId = await opaqueGalleryId('fixture-current-generation');
    const request = vi.fn((operation: OperationId, _payload: unknown, _context?: GatewayRequestContext) => {
      if (operation === 'listProducts') return Promise.resolve(productFixture.responses.listProducts);
      if (operation === 'getProductDraft')
        return Promise.resolve({
          ...product,
          categoryId: fixture.draftPayload.categoryId,
          language: fixture.draftPayload.language,
          status: 'draft',
          schemaXml: fixture.draftPayload.schemaXml
        });
      if (operation === 'updateProductDisplay')
        return Promise.resolve({
          productIds: [product.id],
          display: 'offline',
          success: true,
          traceId: 'fixture-trace'
        });
      return Promise.resolve({ productId: product.id, success: true, traceId: 'fixture-trace' });
    });
    const h = await appHarness({
      request: request as GatewayClient['request'],
      galleryGatewayContextId: () => Promise.resolve(gatewayId)
    });
    const context = { identity: h.identity, gateway: gatewayId };
    const response = await h.call(operation, payload(operation), context);
    expect(response.status).toBe(200);
    expect(request.mock.calls.some(([called]) => called === operation)).toBe(true);
    for (const [, , received] of request.mock.calls) expect(received?.productContext).toEqual(context);
    if (operation === 'updateProductDisplay')
      expect(request.mock.calls.map(([called]) => called)).toEqual(['listProducts', 'updateProductDisplay']);
    if (operation === 'saveProductDraft')
      expect(request.mock.calls.map(([called]) => called)).toEqual(['saveProductDraft', 'getProductDraft']);
    if (operation === 'publishProduct')
      expect(request.mock.calls.map(([called]) => called)).toEqual(['publishProduct', 'listProducts']);
  });

  it('retains legacy TOP submissions without requiring a new context provider', async () => {
    const request = vi
      .fn<GatewayClient['request']>()
      .mockResolvedValue({ productId: product.id, success: true, traceId: 'fixture-trace' });
    const h = await appHarness({ request }, 'node', 'top');
    expect((await h.call('updateProduct', payload('updateProduct'))).status).toBe(200);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(writes)(
    'does not let the dedicated adapter assume success for unknown %s responses',
    async (operation) => {
      acceptFutureDisplay(operation);
      const send = vi.fn<NetworkTransport['send']>();
      const call = vi.spyOn(AlibabaClient.prototype, 'call').mockImplementation((method) =>
        Promise.resolve({
          method,
          data: { [method.replaceAll('.', '_') + '_response']: { success: 'true', product_id: product.id } },
          traceId: 'fixture-trace'
        })
      );
      const gateway = new AlibabaReadGatewayClient(
        {
          ...credentialFixture.manual,
          protocol: 'iop',
          endpoint: IOP_BUSINESS_ENDPOINT,
          signMethod: 'hmac'
        },
        { transport: { send } }
      );
      await expect(gateway.request<OperationId>(operation, payload(operation))).rejects.toBeInstanceOf(
        GatewayException
      );
      expect(call).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it.each(writes)(
    'fences a non-retryable unknown %s outcome against repeated submission',
    async (operation) => {
      acceptFutureDisplay(operation);
      const gatewayId = await opaqueGalleryId('fixture-current-generation');
      const request = vi.fn((called: OperationId) =>
        called === 'listProducts'
          ? Promise.resolve(productFixture.responses.listProducts)
          : Promise.reject(
              new GatewayException({
                code: 'ALIBABA_IOP_RESPONSE_INVALID',
                message: 'Fixture unknown outcome',
                retryable: false
              })
            )
      );
      const h = await appHarness({
        request: request as GatewayClient['request'],
        galleryGatewayContextId: () => Promise.resolve(gatewayId)
      });
      expect((await h.call(operation, payload(operation))).status).toBe(502);
      const persisted = await h.jobs.list({ page: 1, pageSize: 20 });
      expect(persisted).toMatchObject({
        total: 1,
        items: [
          {
            status: 'recovery-required',
            reasonCode: 'ALIBABA_IOP_RESPONSE_INVALID'
          }
        ]
      });
      if (operation === 'updateProduct')
        expect(persisted.items[0]?.productContext).toEqual({
          identity: h.identity,
          gateway: gatewayId
        });
      const second = await h.call(operation, payload(operation));
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: { code: 'PRODUCT_MUTATION_IN_PROGRESS' } });
      expect(request.mock.calls.filter(([called]) => called === operation)).toHaveLength(1);
    }
  );
  it.each(writes)('distinguishes known provider rejection from an unknown %s outcome', async (operation) => {
    acceptFutureDisplay(operation);
    const request = vi.fn((called: OperationId) =>
      called === 'listProducts'
        ? Promise.resolve(productFixture.responses.listProducts)
        : Promise.reject(
            new GatewayException({
              code: 'ALIBABA_IOP_BUSINESS_REJECTED',
              message: 'Fixture explicit rejection',
              retryable: false
            })
          )
    );
    const h = await appHarness({
      request: request as GatewayClient['request'],
      galleryGatewayContextId: () => opaqueGalleryId('fixture-current-generation')
    });
    expect((await h.call(operation, payload(operation))).status).toBe(502);
    expect(await h.jobs.list({ page: 1, pageSize: 20 })).toMatchObject({
      total: 1,
      items: [{ status: 'failed' }]
    });
    expect(request.mock.calls.filter(([called]) => called === operation)).toHaveLength(1);
  });
});

describe('account-accepted IOP draft routing (no verification mock)', () => {
  it.each(['node', 'cloudflare'] as const)(
    'still denies non-admin schema writes in %s even when all flags are enabled',
    async (runtime) => {
      const request = vi.fn<GatewayClient['request']>();
      const galleryGatewayContextId = vi.fn<() => Promise<string>>();
      const h = await appHarness({ request, galleryGatewayContextId }, runtime, 'iop', 'user');
      for (const operation of ['publishProduct', 'saveProductDraft', 'updateProduct'] as const) {
        const response = await h.call(operation, payload(operation));
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'USER_MUTATION_DENIED', retryable: false }
        });
      }
      for (const register of h.registrations) expect(register).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(galleryGatewayContextId).not.toHaveBeenCalled();
    }
  );
  it('keeps unadapted display unsupported despite an admin and an enabled flag', async () => {
    const request = vi.fn<GatewayClient['request']>();
    const galleryGatewayContextId = vi.fn<() => Promise<string>>();
    const h = await appHarness({ request, galleryGatewayContextId });
    const response = await h.call('updateProductDisplay', payload('updateProductDisplay'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'ALIBABA_IOP_MUTATION_UNVERIFIED', retryable: false }
    });
    for (const register of h.registrations) expect(register).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(galleryGatewayContextId).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'uses the persisted context on later draft dispatch with a preflight race=%s',
    async (switchDuringDispatch) => {
      const credentials: GatewayCredentials = {
        ...credentialFixture.manual,
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac',
        galleryAccountGeneration: 'fixture-generation-before'
      };
      let readbacks = 0;
      const send = vi.fn<NetworkTransport['send']>((input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/schema/add/draft'))
          return Promise.resolve(
            Response.json({
              code: 0,
              result: { success: true, product_id: product.id }
            })
          );
        readbacks += 1;
        return Promise.resolve(Response.json(readbacks === 1 ? { code: 0, result: {} } : fixture.schema));
      });
      const status = new EnvironmentAlibabaCredentialProvider({
        ONE_VEGETABLE_ALIBABA_PROTOCOL: 'iop'
      }).status();
      const provider = {
        status: () => Promise.resolve(status),
        requireCredentials: () => Promise.resolve(credentials)
      };
      const h = await appHarness(new CredentialBackedAlibabaGatewayClient(provider, { transport: { send } }));
      expect((await h.call('saveProductDraft', fixture.draftPayload)).status).toBe(200);
      const saved = (await h.jobs.list({ page: 1, pageSize: 20 })).items[0];
      if (!saved) throw new Error('Missing persisted draft task');
      expect(saved.status).toBe('verifying');
      if (switchDuringDispatch)
        vi.spyOn(provider, 'requireCredentials')
          .mockResolvedValueOnce(credentials)
          .mockResolvedValue({ ...credentials, galleryAccountGeneration: 'fixture-generation-after' });
      const response = await h.refresh(saved);
      expect(response.status).toBe(switchDuringDispatch ? 409 : 200);
      if (switchDuringDispatch) {
        expect(await response.json()).toMatchObject({ error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
        expect(await h.jobs.get(saved.id)).toEqual(saved);
      } else {
        expect(await h.jobs.get(saved.id)).toMatchObject({
          status: 'verified',
          productContext: saved.productContext
        });
      }
      expect(send).toHaveBeenCalledTimes(switchDuringDispatch ? 2 : 3);
    }
  );
  it.each([
    ['node', true],
    ['node', false],
    ['cloudflare', true],
    ['cloudflare', false]
  ] as const)(
    'persists creation context and rejects switched credentials in %s with initial readback=%s',
    async (runtime, readable) => {
      let credentials: GatewayCredentials = {
        ...credentialFixture.manual,
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac',
        galleryAccountGeneration: 'fixture-generation-before'
      };
      const send = vi.fn<NetworkTransport['send']>((input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/schema/add/draft'))
          return Promise.resolve(
            Response.json({
              code: 0,
              result: { success: true, product_id: product.id }
            })
          );
        expect(url).toBe(IOP_BUSINESS_ENDPOINT + '/icbu/product/schema/render/draft');
        return Promise.resolve(Response.json(readable ? fixture.schema : { code: 0, result: {} }));
      });
      const status = new EnvironmentAlibabaCredentialProvider({
        ONE_VEGETABLE_ALIBABA_PROTOCOL: 'iop'
      }).status();
      const provider = {
        status: () => Promise.resolve(status),
        requireCredentials: () => Promise.resolve(credentials)
      };
      const gateway = new CredentialBackedAlibabaGatewayClient(provider, { transport: { send } });
      const h = await appHarness(gateway, runtime);
      const gatewayId = await gateway.galleryGatewayContextId();
      expect((await h.call('saveProductDraft', fixture.draftPayload)).status).toBe(200);
      const saved = (await h.jobs.list({ page: 1, pageSize: 20 })).items[0];
      if (!saved) throw new Error('Missing persisted draft task');
      expect(saved).toMatchObject({
        status: readable ? 'verified' : 'verifying',
        productContext: { identity: h.identity, gateway: gatewayId }
      });
      expect(send).toHaveBeenCalledTimes(2);
      // Same endpoint, key and token; only the account/configuration generation changes.
      credentials = { ...credentials, galleryAccountGeneration: 'fixture-generation-after' };
      expect(await gateway.galleryGatewayContextId()).not.toBe(gatewayId);
      const response = await h.refresh(saved);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'PRODUCT_CONTEXT_CHANGED', retryable: false }
      });
      expect(send).toHaveBeenCalledTimes(2);
      expect(await h.jobs.get(saved.id)).toEqual(saved);
    }
  );
  it('does not infer a context for unbound legacy TOP creation tasks on refresh', async () => {
    const galleryGatewayContextId = vi.fn<() => Promise<string>>();
    let readbacks = 0;
    const request = vi.fn((operation: OperationId, _payload: unknown, _context?: GatewayRequestContext) => {
      if (operation === 'saveProductDraft')
        return Promise.resolve({ productId: product.id, success: true, traceId: 'fixture-trace' });
      if (operation !== 'getProductDraft') throw new Error('Unexpected operation');
      readbacks += 1;
      if (readbacks === 1) return Promise.reject(new Error('Fixture readback pending'));
      return Promise.resolve({
        ...product,
        language: fixture.draftPayload.language,
        schemaXml: fixture.schema.result.data
      });
    });
    const h = await appHarness(
      { request: request as GatewayClient['request'], galleryGatewayContextId },
      'node',
      'top'
    );
    expect((await h.call('saveProductDraft', fixture.draftPayload)).status).toBe(200);
    const saved = (await h.jobs.list({ page: 1, pageSize: 20 })).items[0];
    if (!saved) throw new Error('Missing legacy draft task');
    expect(saved.productContext).toBeNull();
    expect((await h.refresh(saved)).status).toBe(200);
    expect(await h.jobs.get(saved.id)).toMatchObject({ status: 'verified', productContext: null });
    expect(galleryGatewayContextId).not.toHaveBeenCalled();
    for (const [, , context] of request.mock.calls) expect(context?.productContext).toBeUndefined();
  });
  it('preserves configuration errors during preflight instead of registering a draft task', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    const provider = new EnvironmentAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_PROTOCOL: 'iop' });
    const gateway = new CredentialBackedAlibabaGatewayClient(
      {
        status: () => Promise.resolve(provider.status()),
        requireCredentials: () => Promise.resolve().then(() => provider.requireCredentials())
      },
      { transport: { send } }
    );
    const h = await appHarness(gateway);
    const response = await h.call('saveProductDraft', fixture.draftPayload);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'ALIBABA_CREDENTIALS_INCOMPLETE', retryable: false }
    });
    for (const register of h.registrations) expect(register).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    'alibaba.icbu.product.schema.add',
    'alibaba.icbu.product.schema.add.draft',
    'alibaba.icbu.product.schema.update'
  ])('does not let generic %s bypass its dedicated task workflow', async (method) => {
    const send = vi.fn<NetworkTransport['send']>();
    const gateway = new AlibabaReadGatewayClient(
      {
        ...credentialFixture.manual,
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac'
      },
      { transport: { send } }
    );
    const h = await appHarness(gateway);
    const response = await h.call('callCapability', {
      method,
      parameters: {}
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'REAL_MUTATION_DISABLED', retryable: false }
    });
    for (const register of h.registrations) expect(register).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('creates a durable draft and forwards its known job category to the real adapter readback', async () => {
    const send = vi.fn<NetworkTransport['send']>((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!(init.body instanceof URLSearchParams)) throw new Error('Expected form');
      if (url.endsWith('/schema/add/draft'))
        return Promise.resolve(
          Response.json({
            code: 0,
            result: { success: 'true', product_id: product.id }
          })
        );
      expect(url).toBe(IOP_BUSINESS_ENDPOINT + '/icbu/product/schema/render/draft');
      expect(init.body.get('cat_id')).toBe(String(fixture.draftPayload.categoryId));
      expect(init.body.get('product_id')).toBe(product.id);
      expect(init.body.has('param_product_top_publish_request')).toBe(false);
      return Promise.resolve(Response.json(fixture.schema));
    });
    const gateway = new AlibabaReadGatewayClient(
      {
        ...credentialFixture.manual,
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac'
      },
      { transport: { send } }
    );
    const h = await appHarness(gateway);
    const response = await h.call('saveProductDraft', fixture.draftPayload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        success: true,
        productId: product.id,
        job: { status: 'verified', categoryId: fixture.draftPayload.categoryId }
      }
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('rejects draft readback without a category instead of guessing or networking', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    const gateway = new AlibabaReadGatewayClient(
      {
        ...credentialFixture.manual,
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac'
      },
      { transport: { send } }
    );
    const h = await appHarness(gateway);
    const response = await h.call('getProductDraft', {
      productId: product.id,
      language: fixture.draftPayload.language
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'REQUEST_CONTRACT_INVALID', retryable: false }
    });
    expect(send).not.toHaveBeenCalled();
  });
});
