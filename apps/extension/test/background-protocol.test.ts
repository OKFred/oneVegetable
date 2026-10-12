import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALIBABA_GATEWAY,
  AlibabaClient,
  SETTINGS_STORAGE_KEY,
  isProductMutationJob,
  type GatewaySettings
} from '@one-vegetable/core';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import { iopOperationReason } from '@one-vegetable/core/alibaba-iop-business';
import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints
} from '../../../packages/core/src/product-mutation-fingerprint';
import { createProductOperationContext } from '../../../packages/core/src/product-operation-context';
import { installNodeXmlDomGlobals } from '../../../scripts/node-xml-dom';
import business from '../../../mock/data/alibaba-auth/iop-business-responses.json';

const state = vi.hoisted<{
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  listener: undefined | ((value: unknown, sender: { id: string; url: string }) => unknown);
}>(() => ({
  local: {},
  session: {},
  listener: undefined
}));
vi.mock('wxt/browser', () => {
  const area = (name: 'local' | 'session') => ({
    get: (key: string) => Promise.resolve(Object.hasOwn(state[name], key) ? { [key]: state[name][key] } : {}),
    set: (items: Record<string, unknown>) => {
      Object.assign(state[name], items);
      return Promise.resolve();
    },
    remove: (key: string) => {
      Reflect.deleteProperty(state[name], key);
      return Promise.resolve();
    },
    setAccessLevel: () => Promise.resolve()
  });
  return {
    browser: {
      storage: { local: area('local'), session: area('session') },
      tabs: { onUpdated: { addListener: vi.fn() } },
      permissions: { contains: () => Promise.resolve(true) },
      runtime: {
        id: 'protocol-test-extension',
        getURL: (path: string) => `chrome-extension://protocol-test-extension${path}`,
        onMessage: {
          addListener: (listener: typeof state.listener) => {
            state.listener = listener;
          }
        },
        onMessageExternal: { addListener: vi.fn() }
      }
    }
  };
});
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (value: unknown) => value }));
import background from '../entrypoints/background';

const sender = {
  id: 'protocol-test-extension',
  url: 'chrome-extension://protocol-test-extension/options.html'
};
const settings: GatewaySettings = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256',
  protocol: 'iop'
};
interface Result {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}
async function send(
  kind: 'credential-vault-request' | 'gateway-request' | 'product-mutation-job-request',
  operation: string,
  payload?: unknown
) {
  return sendEnvelope({ kind, operation, payload });
}
async function sendEnvelope(envelope: Record<string, unknown>, source = sender) {
  return (await state.listener?.({ ...envelope, requestId: crypto.randomUUID() }, source)) as Result;
}
function resultJob(result: Result) {
  const job = result.data?.job;
  if (!isProductMutationJob(job)) throw new Error('Expected a fixture mutation receipt');
  return job;
}
const schemaXml = business.schema.result.data;
const schemaWrites = [
  ['publishProduct', '/icbu/product/schema/add', 'publish_request'],
  ['saveProductDraft', '/icbu/product/schema/add/draft', 'param_product_top_publish_request'],
  ['updateProduct', '/icbu/product/schema/update', null]
] as const;
const creationInput = { categoryId: 123, language: 'en_US', schemaXml };
const updateInput = { categoryId: 123, language: 'en_US', productId: '100001', schemaPatchXml: schemaXml };
let restoreXmlGlobals: () => void;
async function create(value = settings) {
  expect(
    await send('credential-vault-request', 'create', { passphrase: '123456', settings: value })
  ).toMatchObject({ ok: true });
}
beforeEach(() => {
  restoreXmlGlobals = installNodeXmlDomGlobals();
  state.local = {};
  state.session = {};
  background.main();
  // Only local fixtures are allowed. Any unexpected attempt to use the network fails the test.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
});
afterEach(() => {
  restoreXmlGlobals();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('extension background protocol persistence and dispatch', () => {
  it('preserves IOP through create, safe settings/status, save and unlock without leaking secrets', async () => {
    await create();
    const safe = await send('credential-vault-request', 'get-settings');
    expect(safe).toMatchObject({
      ok: true,
      data: {
        protocol: 'iop',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac-sha256',
        appSecret: '',
        accessToken: ''
      }
    });
    expect(JSON.stringify(await send('credential-vault-request', 'status'))).not.toContain(
      settings.appSecret
    );
    expect(JSON.stringify(state.local[SETTINGS_STORAGE_KEY])).not.toContain(settings.accessToken);
    // A save from an older consumer omitting the marker must not strip existing IOP.
    expect(
      await send('credential-vault-request', 'save', {
        appKey: '',
        appSecret: '',
        accessToken: '',
        endpoint: IOP_BUSINESS_ENDPOINT,
        signMethod: 'hmac-sha256'
      })
    ).toMatchObject({ ok: true, data: { protocol: 'iop' } });
    await send('credential-vault-request', 'lock');
    expect(await send('credential-vault-request', 'unlock', { passphrase: '123456' })).toMatchObject({
      ok: true,
      data: { protocol: 'iop' }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains legacy TOP settings and permits only an explicit marker switch', async () => {
    const legacy = { ...settings, endpoint: ALIBABA_GATEWAY, signMethod: 'md5' as const };
    delete legacy.protocol;
    await create(legacy);
    const safe = (await send('credential-vault-request', 'get-settings')).data;
    expect(safe).toMatchObject({ endpoint: ALIBABA_GATEWAY, signMethod: 'md5' });
    expect(safe).not.toHaveProperty('protocol');
    expect(await send('credential-vault-request', 'save', settings)).toMatchObject({
      ok: true,
      data: { protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['bad', null])('rejects invalid protocol %s without storing a vault', async (protocol) => {
    expect(
      await send('credential-vault-request', 'create', {
        passphrase: '123456',
        settings: { ...settings, protocol }
      })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_PROTOCOL_INVALID' } });
    expect(state.local).not.toHaveProperty(SETTINGS_STORAGE_KEY);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unmapped IOP writes and targeted reads before creating a network client', async () => {
    await create();
    const client = vi.spyOn(AlibabaClient, 'create');
    for (const operation of ['uploadPhoto', 'createProductGroup'] as const) {
      const reason = iopOperationReason(operation);
      expect(reason).toBe('ALIBABA_IOP_METHOD_UNSUPPORTED');
      expect(await send('gateway-request', operation, {})).toMatchObject({
        ok: false,
        error: { code: reason }
      });
    }
    expect(
      await send('gateway-request', 'callCapability', { method: 'alibaba.icbu.product.get', parameters: {} })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' } });
    expect(client).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(schemaWrites)(
    'dispatches verified %s with IOP parameters, pinned context and successful readback',
    async (operation, path, wrapper) => {
      await create();
      expect(iopOperationReason(operation)).toBeNull();
      const productContext = await createProductOperationContext('extension:local-admin', settings);
      let writes = 0;
      vi.mocked(fetch).mockImplementation((url, init) => {
        const target = new URL(url instanceof URL ? url.href : typeof url === 'string' ? url : url.url);
        expect(target.origin).toBe(new URL(IOP_BUSINESS_ENDPOINT).origin);
        const parameters = new URLSearchParams(init?.body as URLSearchParams);
        expect(parameters.get('access_token')).toBe(settings.accessToken);
        expect(parameters.get('sign_method')).toBe('sha256');
        expect(parameters.has('method')).toBe(false);
        expect(parameters.has('session')).toBe(false);
        if (target.pathname === '/rest' + path) {
          writes++;
          const input = wrapper
            ? (JSON.parse(parameters.get(wrapper) ?? '') as Record<string, unknown>)
            : Object.fromEntries(parameters);
          expect(input).toMatchObject({ cat_id: wrapper ? 123 : '123', language: 'en_US', xml: schemaXml });
          expect(input).not.toHaveProperty('publish_type');
          expect(input).not.toHaveProperty('version');
          if (operation === 'updateProduct') expect(input.product_id).toBe('100001');
          else expect(input).not.toHaveProperty('product_id');
          return Promise.resolve(
            Response.json({
              code: 0,
              result: {
                success: true,
                ...(operation === 'publishProduct' ? { data: 100001 } : { product_id: 100001 }),
                trace_id: 'fixture-write'
              }
            })
          );
        }
        if (target.pathname === '/rest/alibaba/icbu/product/list')
          return Promise.resolve(Response.json(business.products));
        if (target.pathname === '/rest/icbu/product/schema/render/draft') {
          expect(Object.fromEntries(parameters)).toMatchObject({
            product_id: '100001',
            cat_id: '123',
            language: 'en_US'
          });
          expect(parameters.has('param_product_top_publish_request')).toBe(false);
          return Promise.resolve(Response.json(business.schema));
        }
        if (target.pathname === '/rest/icbu/product/schema/render') {
          expect(JSON.parse(parameters.get('render_request') ?? '')).toEqual({
            product_id: 100001,
            cat_id: 123,
            language: 'en_US'
          });
          return Promise.resolve(Response.json(business.schema));
        }
        throw new Error('Unexpected fixture request');
      });
      const fingerprints = await createProductMutationFingerprints(schemaXml);
      const envelope = {
        kind: 'gateway-request',
        operation,
        productContext,
        ...(operation === 'updateProduct' ? { productMutationFingerprint: fingerprints } : {}),
        payload: operation === 'updateProduct' ? updateInput : creationInput
      };
      const response = await sendEnvelope(envelope);
      expect(response).toMatchObject({ ok: true, data: { success: true, productId: '100001' } });
      const job = resultJob(response);
      expect(job).toMatchObject({ productContext, operation, categoryId: 123, language: 'en_US' });
      if (operation === 'updateProduct') {
        expect(job.status).toBe('auditing');
        expect(await sendEnvelope(envelope)).toMatchObject({
          ok: false,
          error: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
        });
        const readback = await send('gateway-request', 'renderProductSchema', {
          productId: '100001',
          categoryId: 123,
          language: 'en_US'
        });
        expect(readback).toMatchObject({ ok: true, data: { xml: schemaXml } });
        expect(
          await send('product-mutation-job-request', 'complete-update-readback', {
            id: job.id,
            revision: job.revision,
            result: {
              kind: 'comparison',
              comparison: await compareProductMutationFingerprints(
                String(readback.data?.xml),
                job.fieldExpectations
              )
            }
          })
        ).toMatchObject({
          ok: true,
          data: { status: 'verified', reasonCode: 'PRODUCT_MUTATION_READBACK_MATCHED' }
        });
      } else {
        expect(job.status).toBe('verified');
        expect(await sendEnvelope(envelope)).toMatchObject({
          ok: false,
          error: { code: 'PRODUCT_CREATION_ALREADY_ACCEPTED' }
        });
      }
      expect(writes).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await send('credential-vault-request', 'get-settings')).toMatchObject({
        data: { protocol: 'iop' }
      });
      expect(JSON.stringify(job)).not.toContain(settings.accessToken);
    }
  );
  it.each(schemaWrites)(
    'blocks %s with changed account/gateway context before network',
    async (operation) => {
      await create();
      const productContext = await createProductOperationContext('extension:local-admin', settings);
      for (const field of ['identity', 'gateway'] as const) {
        expect(
          await sendEnvelope({
            kind: 'gateway-request',
            operation,
            productContext: { ...productContext, [field]: 'a'.repeat(64) },
            payload: operation === 'updateProduct' ? updateInput : creationInput
          })
        ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
      }
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('keeps update fingerprints and the trusted page boundary after IOP verification', async () => {
    await create();
    const envelope = { kind: 'gateway-request', operation: 'updateProduct', payload: updateInput };
    expect(await sendEnvelope(envelope)).toMatchObject({
      ok: false,
      error: { code: 'PRODUCT_MUTATION_FINGERPRINT_REQUIRED' }
    });
    const fingerprints = await createProductMutationFingerprints(schemaXml);
    expect(
      await sendEnvelope({
        ...envelope,
        productMutationFingerprint: { ...fingerprints, payloadFingerprint: 'a'.repeat(64) }
      })
    ).toMatchObject({ ok: false, error: { code: 'PRODUCT_MUTATION_FINGERPRINT_MISMATCH' } });
    expect(
      await sendEnvelope(
        { ...envelope, productMutationFingerprint: fingerprints },
        { ...sender, url: 'chrome-extension://protocol-test-extension/popup.html' }
      )
    ).toMatchObject({ ok: false, error: { code: 'EXTENSION_TRUSTED_PAGE_REQUIRED' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects completion of a pending IOP update after saved credentials change', async () => {
    await create();
    const productContext = await createProductOperationContext('extension:local-admin', settings);
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ code: 0, result: { success: true, product_id: 100001 } })
    );
    const response = await sendEnvelope({
      kind: 'gateway-request',
      operation: 'updateProduct',
      productContext,
      productMutationFingerprint: await createProductMutationFingerprints(schemaXml),
      payload: updateInput
    });
    const job = resultJob(response);
    expect(
      await send('credential-vault-request', 'save', { ...settings, accessToken: 'fixture-changed-token' })
    ).toMatchObject({ ok: true });
    expect(
      await send('product-mutation-job-request', 'complete-update-readback', {
        id: job.id,
        revision: job.revision,
        result: {
          kind: 'comparison',
          comparison: { matched: true, missingFieldIds: [], mismatchedFieldIds: [] }
        }
      })
    ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('gates existing catalog and definition metadata by target without closing mapped reads', async () => {
    await create();
    const catalog = await send('gateway-request', 'listCapabilities');
    const capabilities = catalog.data as unknown as { method: string; realCallEnabled: boolean }[];
    expect(
      capabilities.find((capability) => capability.method === 'alibaba.icbu.product.list')
    ).toMatchObject({ realCallEnabled: true });
    expect(capabilities.find((capability) => capability.method === 'alibaba.icbu.product.get')).toMatchObject(
      { realCallEnabled: false }
    );
    expect(
      await send('gateway-request', 'getCapabilityDefinition', { method: 'alibaba.icbu.product.get' })
    ).toMatchObject({ data: { realCallEnabled: false } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { groupId: '-1' }, { ungrouped: true }])(
    'requires an explicit IOP photo group for %s',
    async (payload) => {
      await create();
      expect(await send('gateway-request', 'listPhotos', payload)).toMatchObject({
        ok: false,
        error: { code: 'ALIBABA_IOP_PHOTO_GROUP_REQUIRED' }
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('dispatches a mapped IOP read without creating a TOP sync client', async () => {
    await create();
    const client = vi.spyOn(AlibabaClient, 'create');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: '0', result: { groups: [] } }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const response = await send('gateway-request', 'listPhotoGroups', {});
    expect(response.error).toBeUndefined();
    expect(response).toMatchObject({ ok: true, data: [] });
    expect(client).toHaveBeenCalledOnce();
    expect(client.mock.calls[0]?.[0]).toMatchObject({ protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({
      href: `${IOP_BUSINESS_ENDPOINT}/icbu/product/photobank/group/list`
    });
  });
  it('rejects unsupported IOP order filters instead of ignoring them or sending to TOP', async () => {
    await create();
    expect(
      await send('gateway-request', 'listTradeOrders', {
        page: 1,
        pageSize: 20,
        buyerLoginId: 'fixture-buyer'
      })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(await send('credential-vault-request', 'get-settings')).toMatchObject({
      data: { protocol: 'iop', endpoint: IOP_BUSINESS_ENDPOINT }
    });
  });
  it.each([
    ['listTradeOrders', { page: 1, pageSize: 20 }, '/alibaba/order/list', { order_list: [], total_count: 0 }],
    [
      'getTradeOrderLogistics',
      { orderId: 'fixture-order' },
      '/order/logistics/query',
      { logistic_status: 'WAITING', shipping_order_list: [] }
    ]
  ] as const)(
    'dispatches the mapped IOP order read %s without TOP fields',
    async (operation, payload, path, value) => {
      await create();
      vi.mocked(fetch).mockResolvedValue(Response.json({ code: '0', value }));
      expect(await send('gateway-request', operation, payload)).toMatchObject({ ok: true });
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
      expect(url).toMatchObject({ href: IOP_BUSINESS_ENDPOINT + path });
      const parameters = init?.body as URLSearchParams;
      expect(parameters.get('access_token')).toBe(settings.accessToken);
      expect(parameters.has('method')).toBe(false);
      expect(parameters.has('session')).toBe(false);
    }
  );
  it.each([
    [{ code: 'InvalidAccessToken', message: 'fixture rejection' }, 'ALIBABA_IOP_API_REJECTED'],
    [{ unexpected: 'fixture response' }, 'ALIBABA_IOP_RESPONSE_INVALID']
  ] as const)('never retries or falls back to TOP after an IOP read error (%s)', async (body, code) => {
    await create();
    const client = vi.spyOn(AlibabaClient, 'create');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
    expect(await send('gateway-request', 'listPhotoGroups', {})).toMatchObject({
      ok: false,
      error: { code }
    });
    expect(client).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({
      href: `${IOP_BUSINESS_ENDPOINT}/icbu/product/photobank/group/list`
    });
  });
  it('still dispatches unmarked legacy credentials using TOP session/signing', async () => {
    const legacy = { ...settings, endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' as const };
    delete legacy.protocol;
    await create(legacy);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          alibaba_icbu_photobank_group_list_response: { groups: [] }
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );
    expect(await send('gateway-request', 'listPhotoGroups', {})).toMatchObject({ ok: true, data: [] });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({ href: ALIBABA_GATEWAY });
    const parameters = new URLSearchParams(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string);
    expect(parameters.get('session')).toBe(settings.accessToken);
    expect(parameters.get('sign_method')).toBe('hmac');
    expect(parameters.has('access_token')).toBe(false);
  });
});
