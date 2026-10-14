import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALIBABA_GATEWAY,
  AlibabaClient,
  SETTINGS_STORAGE_KEY,
  isProductMutationJob,
  unlockCredentialVault,
  type AlibabaAuthorizationsSummary,
  type CredentialVaultRecord,
  type GatewaySettings
} from '@one-vegetable/core';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import { AlibabaIopTokenClient } from '@one-vegetable/core/alibaba-iop';
import { iopOperationReason } from '@one-vegetable/core/alibaba-iop-business';
import {
  compareProductMutationFingerprints,
  createProductMutationFingerprints
} from '../../../packages/core/src/product-mutation-fingerprint';
import { createProductOperationContext } from '../../../packages/core/src/product-operation-context';
import { installNodeXmlDomGlobals } from '../../../scripts/node-xml-dom';
import business from '../../../mock/data/alibaba-auth/iop-business-responses.json';
import credentialFixtures from '../../../mock/data/node-gateway-credentials.json';
import { ExtensionAlibabaCredentialAcquisitionController } from '../lib/alibaba-credential-acquisition';
import { ExtensionCredentialVaultSession } from '../lib/credential-vault-session';
import { AUTHORIZATION_REFRESH_INTENTS_KEY } from '../lib/authorization-refresh';

const state = vi.hoisted<{
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  localReads: string[];
  listener: undefined | ((value: unknown, sender: { id: string; url: string }) => unknown);
}>(() => ({
  local: {},
  session: {},
  localReads: [],
  listener: undefined
}));
vi.mock('wxt/browser', () => {
  const area = (name: 'local' | 'session') => ({
    get: (key: string) => {
      if (name === 'local') state.localReads.push(key);
      return Promise.resolve(Object.hasOwn(state[name], key) ? { [key]: state[name][key] } : {});
    },
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
  kind:
    | 'credential-vault-request'
    | 'gateway-request'
    | 'product-mutation-job-request'
    | 'alibaba-credential-acquisition-request',
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
const topSettings: GatewaySettings = {
  appKey: 'fixture-top-key',
  appSecret: 'fixture-top-secret',
  accessToken: 'fixture-top-access',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
};
async function createPair(confirm = true) {
  await create(topSettings);
  expect(
    await send('credential-vault-request', 'save', { ...settings, refreshToken: 'fixture-iop-refresh' })
  ).toMatchObject({ ok: true });
  const summary = (await send('credential-vault-request', 'authorizations'))
    .data as unknown as AlibabaAuthorizationsSummary;
  if (confirm)
    expect(
      await send('credential-vault-request', 'confirm-authorizations', {
        topConfigurationId: summary.binding.topConfigurationId,
        iopConfigurationId: summary.binding.iopConfigurationId
      })
    ).toMatchObject({ ok: true, data: { binding: { confirmed: true } } });
  return summary;
}
async function fixtureContext(value = settings) {
  const summary = (await send('credential-vault-request', 'authorizations'))
    .data as unknown as AlibabaAuthorizationsSummary;
  const configurationId = summary[value.protocol ?? 'top']?.configurationId;
  if (!configurationId) throw new Error('Missing fixture configuration ID');
  return createProductOperationContext('extension:local-admin', {
    ...value,
    galleryAccountGeneration: configurationId
  });
}
beforeEach(() => {
  restoreXmlGlobals = installNodeXmlDomGlobals();
  state.local = {};
  state.session = {};
  state.localReads = [];
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
  it('returns a safe empty profile for first-time import without requiring an existing vault', async () => {
    for (const protocol of ['top', 'iop'] as const) {
      expect(await send('credential-vault-request', 'get-authorization', { protocol })).toMatchObject({
        ok: true,
        data: {
          protocol,
          appKey: '',
          appSecret: '',
          accessToken: '',
          endpoint: protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY
        }
      });
    }
    expect(state.local).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
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
  it('retains legacy TOP as the default when saving an explicit IOP profile', async () => {
    const legacy = { ...settings, endpoint: ALIBABA_GATEWAY, signMethod: 'md5' as const };
    delete legacy.protocol;
    await create(legacy);
    const safe = (await send('credential-vault-request', 'get-settings')).data;
    expect(safe).toMatchObject({ endpoint: ALIBABA_GATEWAY, signMethod: 'md5' });
    expect(safe).not.toHaveProperty('protocol');
    expect(await send('credential-vault-request', 'save', settings)).toMatchObject({
      ok: true,
      data: { endpoint: ALIBABA_GATEWAY }
    });
    expect(await send('credential-vault-request', 'get-authorization', { protocol: 'iop' })).toMatchObject({
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
      const productContext = await fixtureContext();
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
      const productContext = await fixtureContext();
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
    const productContext = await fixtureContext();
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
  it('never returns the unselected profile even when it is the default and the caller selects the other slot', async () => {
    await createPair();
    const masked = await send('credential-vault-request', 'get-authorization', { protocol: 'iop' });
    const visible = JSON.stringify(masked);
    for (const field of [
      topSettings.appKey,
      topSettings.endpoint,
      topSettings.accessToken,
      topSettings.appSecret
    ])
      expect(visible).not.toContain(field);
    expect(masked.data).not.toHaveProperty('authorizationBinding');
    expect(masked.data).not.toHaveProperty('protocolCredentials');
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
  it('preserves TOP importing IOP and rejects stale pair confirmation after replacement', async () => {
    const summary = await createPair();
    const record = state.local[SETTINGS_STORAGE_KEY] as CredentialVaultRecord;
    const restored = await unlockCredentialVault(record, '123456');
    expect(restored.settings).toMatchObject(topSettings);
    expect(restored.settings.protocolCredentials?.iop).toMatchObject({
      ...settings,
      refreshToken: 'fixture-iop-refresh'
    });
    const safe = await send('credential-vault-request', 'get-authorization', { protocol: 'iop' });
    const encoded = JSON.stringify([
      safe,
      await send('credential-vault-request', 'get-settings'),
      await send('credential-vault-request', 'authorizations'),
      state.local,
      state.session
    ]);
    for (const secret of [
      settings.appSecret,
      settings.accessToken,
      'fixture-iop-refresh',
      topSettings.appSecret,
      topSettings.accessToken
    ])
      expect(encoded).not.toContain(secret);
    expect(safe.data).not.toHaveProperty('protocolCredentials');
    expect(safe.data).not.toHaveProperty('refreshToken');
    await send('credential-vault-request', 'save', settings);
    expect(
      await send('credential-vault-request', 'confirm-authorizations', {
        topConfigurationId: summary.binding.topConfigurationId,
        iopConfigurationId: summary.binding.iopConfigurationId
      })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_AUTHORIZATION_BINDING_STALE' } });
    expect(await send('credential-vault-request', 'authorizations')).toMatchObject({
      data: { binding: { confirmed: false } }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('routes all and ungrouped photos to TOP, a specific group to IOP, with no error fallback', async () => {
    await createPair();
    for (const [payload, protocol] of [
      [{}, 'top'],
      [{ groupId: '-1' }, 'top'],
      [{ ungrouped: true }, 'top'],
      [{ groupId: '123' }, 'iop']
    ] as const) {
      vi.mocked(fetch).mockClear();
      vi.mocked(fetch).mockImplementation(() =>
        Promise.resolve(
          Response.json(
            protocol === 'iop'
              ? { code: '0', result: { pagination_query_list: { list: [], total: 0 } } }
              : { images: [], total: 0 }
          )
        )
      );
      const result = await send('gateway-request', 'listPhotos', payload);
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true });
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
      const parameters = new URLSearchParams(init?.body as string);
      expect(url).toMatchObject({
        href: protocol === 'iop' ? `${IOP_BUSINESS_ENDPOINT}/icbu/product/photobank/list` : ALIBABA_GATEWAY
      });
      expect(parameters.get(protocol === 'iop' ? 'access_token' : 'session')).toBe(
        protocol === 'iop' ? settings.accessToken : topSettings.accessToken
      );
    }
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValue(Response.json({ code: 'InvalidAccessToken' }));
    expect(await send('gateway-request', 'listPhotos', { groupId: '123' })).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('generates operation-specific contexts and honors the pinned profile before preferred routing', async () => {
    await createPair();
    const product = await sendEnvelope({ kind: 'product-operation-context' });
    const gallery = await sendEnvelope({ kind: 'gallery-transfer-context' });
    expect(product.data).toMatchObject(await fixtureContext());
    expect(gallery.data).toMatchObject(await fixtureContext(topSettings));
    // listPhotoGroups normally prefers IOP, but this request is pinned to TOP.
    vi.mocked(fetch).mockResolvedValue(Response.json({ groups: [] }));
    expect(
      await sendEnvelope({
        kind: 'gateway-request',
        operation: 'listPhotoGroups',
        payload: {},
        productContext: await fixtureContext(topSettings)
      })
    ).toMatchObject({ ok: true });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({ href: ALIBABA_GATEWAY });
    vi.mocked(fetch).mockClear();
    await send('credential-vault-request', 'clear-authorization', { protocol: 'iop' });
    expect(
      await sendEnvelope({
        kind: 'gateway-request',
        operation: 'listPhotoGroups',
        payload: {},
        productContext: product.data
      })
    ).toMatchObject({ ok: false, error: { code: 'PRODUCT_CONTEXT_CHANGED' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps denied dual-profile writes closed and never sends a second uncertain write', async () => {
    await createPair();
    expect(await send('gateway-request', 'createTradeOrder', {})).toMatchObject({
      ok: false,
      error: { code: 'REAL_MUTATION_DISABLED' }
    });
    expect(
      await send('gateway-request', 'callCapability', {
        method: 'alibaba.icbu.product.schema.update',
        parameters: {}
      })
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValue(new Error('fixture uncertain response'));
    expect(await send('gateway-request', 'saveProductDraft', creationInput)).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({
      href: `${IOP_BUSINESS_ENDPOINT}/icbu/product/schema/add/draft`
    });
  });
  it('refreshes only IOP, preserving both configuration IDs and user confirmation', async () => {
    const summary = await createPair();
    const refresh = vi.spyOn(AlibabaIopTokenClient.prototype, 'request').mockResolvedValue({
      accessToken: 'fixture-rotated-access',
      refreshToken: 'fixture-rotated-refresh',
      expiresInSeconds: 3600,
      refreshExpiresInSeconds: 7200
    });
    expect(
      await send('credential-vault-request', 'refresh-authorization', { protocol: 'iop' })
    ).toMatchObject({
      ok: true,
      data: {
        binding: {
          confirmed: true,
          topConfigurationId: summary.binding.topConfigurationId,
          iopConfigurationId: summary.binding.iopConfigurationId
        }
      }
    });
    expect(refresh).toHaveBeenCalledOnce();
    const restored = await unlockCredentialVault(
      state.local[SETTINGS_STORAGE_KEY] as CredentialVaultRecord,
      '123456'
    );
    expect(restored.settings.accessToken).toBe(topSettings.accessToken);
    expect(restored.settings.protocolCredentials?.iop).toMatchObject({
      accessToken: 'fixture-rotated-access',
      configurationId: summary.binding.iopConfigurationId
    });
    expect(
      JSON.stringify(await send('credential-vault-request', 'get-authorization', { protocol: 'iop' }))
    ).not.toContain('fixture-rotated');
    expect(
      await send('credential-vault-request', 'refresh-authorization', { protocol: 'top' })
    ).toMatchObject({ ok: false, error: { code: 'ALIBABA_REFRESH_TOKEN_MISSING' } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['top', 'iop'] as const)(
    'saves acquired %s to its actual slot, reports that slot, and never exposes the other profile',
    async (protocol) => {
      const other = protocol === 'top' ? settings : topSettings;
      await create(other);
      const original = (
        await unlockCredentialVault(state.local[SETTINGS_STORAGE_KEY] as CredentialVaultRecord, '123456')
      ).settings;
      const bundle = {
        ...credentialFixtures.oauthBundle,
        schemaVersion: 1 as const,
        protocol,
        application: {
          ...credentialFixtures.oauthBundle.application,
          appKey: 'acquired-slot-key',
          appSecret: 'acquired-slot-secret'
        },
        oauth: {
          ...credentialFixtures.oauthBundle.oauth,
          accessToken: 'acquired-slot-access',
          refreshToken: 'acquired-slot-refresh'
        },
        callback: { ...credentialFixtures.oauthBundle.callback, stateMatched: true as const }
      };
      vi.spyOn(
        ExtensionAlibabaCredentialAcquisitionController.prototype,
        'completedBundle'
      ).mockResolvedValue(bundle);
      const result = await send('alibaba-credential-acquisition-request', 'save-to-vault');
      expect(result).toMatchObject({ ok: true, data: { protocol, appKey: bundle.application.appKey } });
      expect(JSON.stringify(result)).not.toContain(other.appKey);
      expect(JSON.stringify(result)).not.toContain('acquired-slot-secret');
      expect(JSON.stringify(result)).not.toContain('acquired-slot-refresh');
      const restored = await unlockCredentialVault(
        state.local[SETTINGS_STORAGE_KEY] as CredentialVaultRecord,
        '123456'
      );
      const { protocolCredentials, ...primary } = restored.settings;
      expect(primary).toEqual(original);
      expect(protocolCredentials?.[protocol]).toMatchObject({
        protocol,
        appKey: bundle.application.appKey,
        refreshToken: bundle.oauth.refreshToken
      });
      const masked = await send('credential-vault-request', 'get-authorization', { protocol });
      expect(masked).toMatchObject({
        data: { protocol, appKey: bundle.application.appKey, appSecret: '', accessToken: '' }
      });
      expect(JSON.stringify(masked)).not.toContain(other.appKey);
      expect(masked.data).not.toHaveProperty('protocolCredentials');
      expect(masked.data).not.toHaveProperty('refreshToken');
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('reports an unknown refresh only for the matching configuration ID without leaking intent values', async () => {
    await createPair();
    const before = (await send('credential-vault-request', 'authorizations'))
      .data as unknown as AlibabaAuthorizationsSummary;
    const refresh = vi
      .spyOn(AlibabaIopTokenClient.prototype, 'request')
      .mockRejectedValue(new Error('fixture-provider-secret'));
    expect(
      await send('credential-vault-request', 'refresh-authorization', { protocol: 'iop' })
    ).toMatchObject({ ok: false, error: { code: 'AUTH_REFRESH_RESULT_UNKNOWN' } });
    const after = (await send('credential-vault-request', 'authorizations'))
      .data as unknown as AlibabaAuthorizationsSummary;
    expect(after.top).toEqual(before.top);
    expect(after.iop).toMatchObject({
      canRefresh: false,
      lastRefreshErrorCode: 'AUTH_REFRESH_RESULT_UNKNOWN'
    });
    const id = before.binding.iopConfigurationId;
    if (!id) throw new Error('Missing fixture IOP configuration ID');
    state.local[AUTHORIZATION_REFRESH_INTENTS_KEY] = {
      [id]: { requestId: 'private-intent-value', status: 'sending', body: 'private-intent-body' }
    };
    const safe = await send('credential-vault-request', 'authorizations');
    expect(JSON.stringify(safe)).not.toContain('private-intent');
    expect(
      await send('credential-vault-request', 'refresh-authorization', { protocol: 'iop' })
    ).toMatchObject({ ok: false, error: { code: 'AUTH_REFRESH_RESULT_UNKNOWN' } });
    expect(refresh).toHaveBeenCalledOnce();
    await send('credential-vault-request', 'save', { ...settings, refreshToken: 'fixture-new-refresh' });
    expect(await send('credential-vault-request', 'authorizations')).toMatchObject({
      data: {
        iop: {
          canRefresh: true,
          lastRefreshErrorCode: null
        }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reads vault storage once for status/pool and once for an entire capability catalog', async () => {
    await createPair();
    state.localReads = [];
    expect(await send('credential-vault-request', 'status')).toMatchObject({
      data: {
        pool: { top: true, iop: true, defaultProtocol: 'top', bindingConfirmed: true }
      }
    });
    expect(state.localReads.filter((key) => key === SETTINGS_STORAGE_KEY)).toHaveLength(1);
    state.localReads = [];
    expect(await send('gateway-request', 'listCapabilities')).toMatchObject({ ok: true });
    expect(state.localReads.filter((key) => key === SETTINGS_STORAGE_KEY)).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps TOP gallery and IOP product contexts stable across both token refreshes and session restoration', async () => {
    const originalSummary = await createPair();
    await send('credential-vault-request', 'save', { ...topSettings, refreshToken: 'fixture-top-refresh' });
    const summary = (await send('credential-vault-request', 'authorizations'))
      .data as unknown as AlibabaAuthorizationsSummary;
    await send('credential-vault-request', 'confirm-authorizations', {
      topConfigurationId: summary.binding.topConfigurationId,
      iopConfigurationId: summary.binding.iopConfigurationId
    });
    expect(summary.binding.iopConfigurationId).toBe(originalSummary.binding.iopConfigurationId);
    const productBefore = await sendEnvelope({ kind: 'product-operation-context' });
    const galleryBefore = await sendEnvelope({ kind: 'gallery-transfer-context' });
    const iopRefresh = vi.spyOn(AlibabaIopTokenClient.prototype, 'request').mockResolvedValue({
      accessToken: 'fixture-iop-rotated',
      refreshToken: 'fixture-iop-next-refresh',
      expiresInSeconds: 3600,
      refreshExpiresInSeconds: null
    });
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        access_token: 'fixture-top-rotated',
        refresh_token: 'fixture-top-next-refresh',
        expires_in: 3600
      })
    );
    expect(
      await send('credential-vault-request', 'refresh-authorization', { protocol: 'top' })
    ).toMatchObject({ ok: true, data: { binding: { confirmed: true } } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({ href: 'https://oauth.alibaba.com/token' });
    expect(
      await send('credential-vault-request', 'refresh-authorization', { protocol: 'iop' })
    ).toMatchObject({ ok: true, data: { binding: { confirmed: true } } });
    expect(iopRefresh).toHaveBeenCalledOnce();
    expect((await sendEnvelope({ kind: 'product-operation-context' })).data).toEqual(productBefore.data);
    expect((await sendEnvelope({ kind: 'gallery-transfer-context' })).data).toEqual(galleryBefore.data);
    const record = state.local[SETTINGS_STORAGE_KEY] as CredentialVaultRecord;
    const session = new ExtensionCredentialVaultSession({
      get: (key) => Promise.resolve({ [key]: state.session[key] }),
      set: (items) => {
        Object.assign(state.session, items);
        return Promise.resolve();
      },
      remove: (key) => {
        Reflect.deleteProperty(state.session, key);
        return Promise.resolve();
      }
    });
    const restored = await session.read(record);
    expect(restored?.value.settings.configurationId).toBe(summary.binding.topConfigurationId);
    expect(restored?.value.settings.protocolCredentials?.iop?.configurationId).toBe(
      summary.binding.iopConfigurationId
    );
    expect(JSON.stringify(restored?.value.settings)).not.toContain('galleryAccountGeneration');
    await send('credential-vault-request', 'lock');
    await send('credential-vault-request', 'unlock', { passphrase: '123456' });
    expect((await sendEnvelope({ kind: 'product-operation-context' })).data).toEqual(productBefore.data);
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValue(Response.json({ code: '0', result: { groups: [] } }));
    expect(
      await sendEnvelope({
        kind: 'gateway-request',
        operation: 'listPhotoGroups',
        payload: {},
        productContext: productBefore.data
      })
    ).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toMatchObject({
      href: `${IOP_BUSINESS_ENDPOINT}/icbu/product/photobank/group/list`
    });
  });
  it('allows only trusted options to access/manage either slot, including summaries', async () => {
    await createPair();
    for (const operation of [
      'status',
      'get-settings',
      'authorizations',
      'get-authorization',
      'save',
      'confirm-authorizations',
      'clear-authorization',
      'refresh-authorization',
      'lock'
    ]) {
      expect(
        await sendEnvelope(
          { kind: 'credential-vault-request', operation, payload: { protocol: 'iop' } },
          { ...sender, url: 'chrome-extension://protocol-test-extension/popup.html' }
        )
      ).toMatchObject({ ok: false, error: { code: 'EXTENSION_TRUSTED_PAGE_REQUIRED' } });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['authorizations', {}],
    ['get-authorization', { protocol: 'bad' }],
    ['clear-authorization', { protocol: 'top', extra: true }],
    ['confirm-authorizations', { topConfigurationId: 'test' }],
    ['save', { ...settings, protocolCredentials: { top: topSettings } }],
    ['save', { ...settings, refreshToken: {} }],
    ['save', { ...settings, refreshTokenExpiresTimeUtc: -1 }]
  ])('strictly rejects malformed vault %s payloads before storage changes', async (operation, payload) => {
    await createPair();
    const ciphertext = JSON.stringify(state.local);
    expect(await send('credential-vault-request', operation, payload)).toMatchObject({ ok: false });
    expect(JSON.stringify(state.local)).toBe(ciphertext);
    expect(fetch).not.toHaveBeenCalled();
  });
});
