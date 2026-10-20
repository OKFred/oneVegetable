import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/iop-business-responses.json';
import { AlibabaClient } from '../src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import {
  applyIopCapabilityProtocol,
  createIopBusinessRequest,
  iopOperationReason,
  normalizeIopBusinessResponse
} from '../src/alibaba-iop-business';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { ProductAdapter } from '../src/product-adapter';
import { PhotoAdapter } from '../src/photo-adapter';
import { ProductInventoryAdapter } from '../src/product-inventory';
import { executeCapabilityCall } from '../src/capability-call';
import { findCapability } from '../src/capability-registry';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import type { GatewayCredentials } from '../src/types';

const credentials: GatewayCredentials = {
  protocol: 'iop',
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256'
};
function createClient(response: unknown = fixtures.products, options = {}) {
  const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(response));
  const network = new NetworkManager({
    transport: { send },
    policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
  });
  return { send, client: new AlibabaClient(credentials, network, options) };
}
const inventoryMethod = 'alibaba.icbu.product.inventory.get';
const encryptMethod = 'alibaba.icbu.product.id.encrypt';
const inventoryInput = { productId: '100001', source: 'product' as const, language: 'en_US' as const };
const inventoryAdapter = (response: unknown) => {
  const current = createClient(response);
  return {
    ...current,
    adapter: new ProductInventoryAdapter(
      current.client,
      validateCapabilityRequest,
      validateCapabilityResponse
    )
  };
};
describe('explicit IOP business compatibility', () => {
  it('keeps IOP live acceptance separate from TOP and never mutates shared metadata', () => {
    const top = { method: encryptMethod, realCallEnabled: true, verification: 'account-verified' };
    expect(applyIopCapabilityProtocol(top)).toEqual({ ...top, verification: 'documented' });
    expect(top.verification).toBe('account-verified');
    expect(applyIopCapabilityProtocol({ ...top, method: inventoryMethod })).toMatchObject({
      verification: 'account-verified',
      realCallEnabled: true
    });
    for (const method of ['alibaba.icbu.category.id.mapping', 'alibaba.icbu.category.schema.level.get'])
      expect(applyIopCapabilityProtocol({ ...top, method })).toMatchObject({
        verification: 'documented',
        realCallEnabled: true
      });
    expect(applyIopCapabilityProtocol({ ...top, method: 'alibaba.icbu.rfq.list' })).toMatchObject({
      verification: 'documented',
      realCallEnabled: false
    });
    expect(
      applyIopCapabilityProtocol({ ...top, method: 'alibaba.icbu.product.schema.update' })
    ).toMatchObject({
      verification: 'account-verified',
      realCallEnabled: true
    });
  });
  it('signs the actual API path and never includes TOP method/session/date fields', async () => {
    const payload = await createIopBusinessRequest(
      credentials,
      'alibaba.icbu.product.list',
      { current_page: 1, page_size: 1 },
      1800000000000
    );
    expect(payload.url).toBe(`${IOP_BUSINESS_ENDPOINT}/alibaba/icbu/product/list`);
    expect(payload.parameters).toMatchObject({
      app_key: credentials.appKey,
      access_token: credentials.accessToken,
      timestamp: '1800000000000',
      sign_method: 'sha256'
    });
    expect(payload.parameters.sign).toBe(
      await signIopRequest('/alibaba/icbu/product/list', payload.parameters, credentials.appSecret)
    );
    expect(payload.parameters).not.toHaveProperty('method');
    expect(payload.parameters).not.toHaveProperty('session');
    const { client, send } = createClient(fixtures.products, { protocol: 'sync' as const });
    await client.call('alibaba.icbu.product.list', { current_page: 1, page_size: 1 });
    const url = send.mock.calls[0]?.[0];
    expect(url instanceof URL ? url.href : url).toBe(payload.url);
    const body = send.mock.calls[0]?.[1].body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('access_token')).toBe(credentials.accessToken);
    expect((body as URLSearchParams).has('session')).toBe(false);
  });
  it('maps render_request and the case-sensitive photo pagination parameters', async () => {
    const { client, send } = createClient(fixtures.schema);
    const schema = await new ProductAdapter(client).renderSchema({
      productId: '100001',
      categoryId: 123,
      language: 'en_US'
    });
    expect(schema.xml).toContain('<itemSchema>');
    const body = send.mock.calls[0]?.[1].body as URLSearchParams;
    expect(JSON.parse(body.get('render_request') ?? '')).toMatchObject({
      product_id: 100001,
      cat_id: 123,
      language: 'en_US'
    });
    expect(body.has('param_product_top_publish_request')).toBe(false);
    const photos = createClient(fixtures.photos);
    await expect(
      new PhotoAdapter(photos.client).list({ groupId: '1001', page: 1, pageSize: 24 })
    ).resolves.toMatchObject({ total: 1, items: [{ id: '1002', name: 'fixture.png' }] });
    const parameters = photos.send.mock.calls[0]?.[1].body as URLSearchParams;
    expect(Object.fromEntries(parameters)).toMatchObject({
      groupId: '1001',
      currentPage: '1',
      pageSize: '24'
    });
    expect(parameters.has('location_type')).toBe(false);
  });
  it('allows real empty lists but rejects a missing total or malformed list rather than fabricating empty data', () => {
    expect(
      normalizeIopBusinessResponse(fixtures.emptyProducts, 'alibaba.icbu.product.list', credentials)
    ).toMatchObject({ alibaba_icbu_product_list_response: { products: [], total_item: 0 } });
    for (const result of [
      {},
      { products: [] },
      { products: [null], total_item: 1 },
      { products: [], total_item: -1 }
    ]) {
      expect(() =>
        normalizeIopBusinessResponse({ code: 0, result }, 'alibaba.icbu.product.list', credentials)
      ).toThrow();
    }
    expect(() =>
      normalizeIopBusinessResponse({ code: 0, result: {} }, 'alibaba.icbu.product.group.get', credentials)
    ).toThrow();
    expect(() =>
      normalizeIopBusinessResponse(
        { code: 0, result: { success: false, data: '<itemSchema />' } },
        'alibaba.icbu.product.schema.render',
        credentials
      )
    ).toThrow();
  });
  it('does not treat outer code zero as business success', async () => {
    const { client } = createClient(fixtures.groupRejected);
    await expect(client.call('alibaba.icbu.product.group.get', { group_id: 0 })).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_API_REJECTED', subCode: '400004' }
    });
  });
  it('reuses product and photo adapters without confusing identifiers or wrappers', async () => {
    await expect(
      new ProductAdapter(createClient().client).list({ page: 1, pageSize: 1 })
    ).resolves.toMatchObject({ items: [{ id: '100001' }], total: 1 });
    await expect(
      new ProductAdapter(createClient(fixtures.productGroups).client).listGroups()
    ).resolves.toEqual([]);
    await expect(
      new PhotoAdapter(createClient(fixtures.photoGroups).client).listGroups()
    ).resolves.toMatchObject([{ id: '1001', name: 'Fixture images' }]);
  });
  it.each([
    [inventoryMethod, '/icbu/product/inventory/get'],
    [encryptMethod, '/alibaba/icbu/product/id/encrypt']
  ] as const)('maps only documented numeric ID/language parameters for %s', async (method, path) => {
    expect(iopOperationReason('callCapability', method)).toBeNull();
    expect(findCapability(method)).toMatchObject({ risk: 'read', realCallEnabled: true });
    const payload = await createIopBusinessRequest(credentials, method, {
      product_id: inventoryInput.productId,
      language: inventoryInput.language
    });
    expect(payload.url).toBe(IOP_BUSINESS_ENDPOINT + path);
    expect(payload.parameters).toMatchObject({ product_id: '100001', language: 'en_US' });
    expect(payload.parameters.sign).toBe(
      await signIopRequest(path, payload.parameters, credentials.appSecret)
    );
    const { client, send } = createClient();
    for (const product_id of [
      undefined,
      null,
      true,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      '9007199254740992',
      '1e3',
      '001',
      'fixture-encrypted-product'
    ])
      await expect(client.call(method, { product_id, language: 'en_US' })).rejects.toMatchObject({
        gatewayError: { code: 'REQUEST_CONTRACT_INVALID' }
      });
    for (const language of [undefined, null, false, '', ' '])
      await expect(client.call(method, { product_id: 100001, language })).rejects.toMatchObject({
        gatewayError: { code: 'REQUEST_CONTRACT_INVALID' }
      });
    await expect(
      client.call(method, { product_id: 100001, language: 'en_US', sku_id: 33323 })
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED' }
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('feeds the dedicated inventory adapter and generic capability validator without wrapper drift', async () => {
    expect(iopOperationReason('getProductInventory')).toBeNull();
    const { adapter, send } = inventoryAdapter(fixtures.inventory);
    await expect(adapter.get(inventoryInput)).resolves.toMatchObject({
      status: 'ready',
      traceId: 'fixture-inventory-trace',
      issues: [],
      records: [{ skuId: '33323', inventoryCode: 'CN_LOCAL_01', inventory: 100 }]
    });
    expect(send.mock.calls[0]?.[0]).toEqual(new URL(IOP_BUSINESS_ENDPOINT + '/icbu/product/inventory/get'));
    expect(Object.fromEntries(send.mock.calls[0]?.[1].body as URLSearchParams)).toMatchObject({
      product_id: '100001',
      language: 'en_US',
      access_token: credentials.accessToken,
      sign_method: 'sha256'
    });
    await expect(
      executeCapabilityCall(
        createClient(fixtures.inventory).client,
        {
          method: inventoryMethod,
          parameters: { product_id: 100001, language: 'en_US' }
        },
        { validateCapabilityRequest, validateCapabilityResponse }
      )
    ).resolves.toMatchObject({
      contractValid: true,
      contractIssues: [],
      data: { result: { success: true, biz_message: 'success' } }
    });
  });
  it('preserves absent quantities and unsafe SKU IDs as drift, not invented stock or identifiers', async () => {
    const result = fixtures.inventory.result.result;
    for (const [row, expected] of [
      [
        { sku_id: 33323, inventory_code: 'CN_LOCAL_01', inventory: 0 },
        { status: 'ready', records: [{ inventory: 0 }] }
      ],
      [
        { sku_id: 33323, inventory_code: 'CN_LOCAL_01' },
        { status: 'drift', records: [{ inventory: null }] }
      ],
      [
        { sku_id: Number.MAX_SAFE_INTEGER + 1, inventory_code: 'CN_LOCAL_01', inventory: 1 },
        { status: 'drift', records: [{ skuId: null }] }
      ],
      [
        { sku_id: '33323', inventory_code: 'CN_LOCAL_01', inventory: 1 },
        { status: 'drift', records: [{ skuId: null }] }
      ],
      [
        { sku_id: 33323, inventory_code: 'CN_LOCAL_01', inventory: -1 },
        { status: 'drift', records: [{ inventory: null }] }
      ]
    ] as const) {
      await expect(
        inventoryAdapter({ code: 0, result: { result: { ...result, data_list: [row] } } }).adapter.get(
          inventoryInput
        )
      ).resolves.toMatchObject(expected);
    }
    await expect(
      inventoryAdapter({ code: 0, result: { result: { ...result, data_list: [] } } }).adapter.get(
        inventoryInput
      )
    ).resolves.toMatchObject({ status: 'no-data', records: [] });
  });
  it('accepts the observed single inventory layer and supplements its trace from request_id', async () => {
    await expect(
      inventoryAdapter(fixtures.emptyInventory).adapter.get(inventoryInput)
    ).resolves.toMatchObject({
      status: 'no-data',
      records: [],
      issues: [],
      traceId: 'fixture-empty-inventory-trace'
    });
    const { trace_id: _trace, ...result } = fixtures.inventory.result.result;
    const response = { ...fixtures.emptyInventory, result };
    await expect(inventoryAdapter(response).adapter.get(inventoryInput)).resolves.toMatchObject({
      status: 'ready',
      records: [{ inventory: 100 }],
      issues: [],
      traceId: 'fixture-empty-inventory-trace'
    });
    await expect(
      executeCapabilityCall(
        createClient(fixtures.emptyInventory).client,
        {
          method: inventoryMethod,
          parameters: { product_id: 100001, language: 'en_US' }
        },
        { validateCapabilityRequest, validateCapabilityResponse }
      )
    ).resolves.toMatchObject({
      contractValid: true,
      contractIssues: [],
      traceId: 'fixture-empty-inventory-trace',
      data: { result: { success: true, data_list: [] } }
    });
  });
  it.each([
    {},
    { success: true },
    { data_list: [] },
    { success: true, data_list: [null] },
    { result: null, success: true, data_list: [] },
    { result: fixtures.inventory.result },
    { result: {} },
    { result: { success: true } },
    { result: { data_list: [] } },
    { result: { success: true, data_list: [null] } }
  ])('rejects missing or malformed inventory envelopes: %j', async (result) => {
    const { client, send } = createClient({ code: 0, result }, { maxAttempts: 3, shouldRetry: () => true });
    await expect(
      client.call(inventoryMethod, { product_id: 100001, language: 'en_US' })
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_RESPONSE_INVALID', retryable: false }
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([
    { ...fixtures.inventory, code: 'InvalidAccessToken' },
    { code: 0, result: { ...fixtures.inventory.result, error_code: 'DENIED' } },
    {
      code: 0,
      result: { result: { ...fixtures.inventory.result.result, success: false, msg_code: 'DENIED' } }
    },
    { code: 0, result: { result: { ...fixtures.inventory.result.result, success: 'false' } } },
    { code: 0, result: { ...fixtures.emptyInventory.result, success: false, msg_code: 'DENIED' } },
    { code: 0, result: { result: { ...fixtures.inventory.result.result, msg_code: 'DENIED' } } }
  ])('never converts inventory failures into successful/empty stock: %j', async (response) => {
    const { client, send } = createClient(response, { maxAttempts: 3, shouldRetry: () => true });
    await expect(
      client.call(inventoryMethod, { product_id: 100001, language: 'en_US' })
    ).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_API_REJECTED', retryable: false }
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('normalizes ID encryption into the existing read-only capability contract', async () => {
    const { client, send } = createClient(fixtures.encryptedProduct);
    await expect(
      executeCapabilityCall(
        client,
        {
          method: encryptMethod,
          parameters: { product_id: 100001, language: 'en_US' }
        },
        { validateCapabilityRequest, validateCapabilityResponse }
      )
    ).resolves.toMatchObject({
      contractValid: true,
      contractIssues: [],
      data: { secret_id: 'fixture-encrypted-product' }
    });
    expect(send.mock.calls[0]?.[0]).toEqual(
      new URL(IOP_BUSINESS_ENDPOINT + '/alibaba/icbu/product/id/encrypt')
    );
    for (const secret_id of [
      undefined,
      null,
      100001,
      '',
      ' ',
      'fixture\nid',
      'fixture\u007fid',
      'x'.repeat(1025)
    ])
      expect(() =>
        normalizeIopBusinessResponse({ code: 0, result: { secret_id } }, encryptMethod, credentials)
      ).toThrow('ALIBABA_IOP_RESPONSE_INVALID');
    const secret_id = ' fixture.+/=opaque-id ';
    expect(
      normalizeIopBusinessResponse({ code: 0, result: { secret_id } }, encryptMethod, credentials)
    ).toEqual({ alibaba_icbu_product_id_encrypt_response: { secret_id } });
    expect(() =>
      normalizeIopBusinessResponse(
        { code: 0, result: { secret_id: 'fixture-id', error_code: 'DENIED' } },
        encryptMethod,
        credentials
      )
    ).toThrow('ALIBABA_IOP_API_REJECTED');
  });
  it('keeps SKU inventory, stock writes and ID decryption unsupported before network', async () => {
    const { adapter, send, client } = inventoryAdapter(fixtures.inventory);
    await expect(adapter.get({ ...inventoryInput, source: 'sku' })).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' }
    });
    for (const method of [
      'alibaba.icbu.product.inventory.update',
      'alibaba.icbu.product.sku.inventory.get',
      'alibaba.icbu.product.id.decrypt'
    ]) {
      const reason =
        method === 'alibaba.icbu.product.inventory.update'
          ? 'ALIBABA_IOP_MUTATION_UNVERIFIED'
          : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
      expect(iopOperationReason('callCapability', method)).toBe(reason);
      await expect(client.call(method, {})).rejects.toMatchObject({
        gatewayError: { code: reason }
      });
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('fails unmapped methods and writes before network; never derives a path from the TOP method', async () => {
    const { client, send } = createClient();
    for (const method of ['alibaba.seller.trade.order.list', 'alibaba.icbu.product.display.update']) {
      const reason =
        method === 'alibaba.icbu.photobank.group.operate'
          ? 'ALIBABA_IOP_MUTATION_UNVERIFIED'
          : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
      await expect(client.call(method, {})).rejects.toMatchObject({
        gatewayError: {
          code: reason
        }
      });
    }
    await expect(
      client.callWithFile(
        'alibaba.icbu.photobank.upload',
        {},
        {
          bytes: new Uint8Array([1]),
          fieldName: 'image_bytes',
          fileName: 'fixture.png',
          contentType: 'image/png'
        }
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
    expect(send).not.toHaveBeenCalled();
    expect(iopOperationReason('updateProduct')).toBeNull();
    expect(iopOperationReason('getProductDraft')).toBeNull();
    expect(iopOperationReason('listProductGroups')).toBeNull();
    expect(iopOperationReason('listPhotoGroups')).toBeNull();
    expect(iopOperationReason('callCapability', 'alibaba.icbu.product.list')).toBeNull();
    expect(iopOperationReason('callCapability', 'alibaba.icbu.product.schema.update')).toBeNull();
  });
  it('maps each account-verified Schema write with its documented shape', async () => {
    const request = {
      cat_id: '123',
      language: 'en_US',
      product_id: '100001',
      xml: '<itemSchema />',
      version: 'trade.1.1',
      publish_type: 'default'
    };
    for (const [method, key] of [
      ['alibaba.icbu.product.schema.add', 'publish_request'],
      ['alibaba.icbu.product.schema.add.draft', 'param_product_top_publish_request'],
      ['alibaba.icbu.product.schema.update', null]
    ] as const) {
      const result = await createIopBusinessRequest(credentials, method, {
        param_product_top_publish_request: request
      });
      const body = key
        ? (JSON.parse(result.parameters[key] ?? '') as Record<string, unknown>)
        : result.parameters;
      expect(body.cat_id).toBe(key ? 123 : '123');
      expect(body).not.toHaveProperty('version');
      expect(body).not.toHaveProperty('publish_type');
      expect(body).not.toHaveProperty('market');
      const response = normalizeIopBusinessResponse(
        {
          code: 0,
          result: {
            success: true,
            ...(method.endsWith('schema.add') ? { data: 100001 } : { product_id: 100001 }),
            trace_id: 'fixture-trace'
          }
        },
        method,
        credentials
      );
      expect(response).toMatchObject({
        [`${method.replaceAll('.', '_')}_response`]: { biz_success: true, product_id: 100001 }
      });
      const verified = createClient({
        code: 0,
        result: {
          success: true,
          trace_id: 'fixture-trace',
          ...(method.endsWith('schema.add') ? { data: 100001 } : { product_id: 100001 })
        }
      });
      expect(iopOperationReason('callCapability', method)).toBeNull();
      await expect(
        verified.client.call(method, { param_product_top_publish_request: request })
      ).resolves.toMatchObject({ data: response });
      expect(verified.send).toHaveBeenCalledOnce();
      for (const result of [
        { success: true },
        { product_id: 100001 },
        { success: true, product_id: 9007199254740992 }
      ])
        expect(() => normalizeIopBusinessResponse({ code: 0, result }, method, credentials)).toThrow();
    }
    expect(() =>
      normalizeIopBusinessResponse(
        { code: 0, result: { success: false, msg_code: 'NOT_EDITABLE', message_info: 'rejected' } },
        'alibaba.icbu.product.schema.update',
        credentials
      )
    ).toThrow('rejected');
  });
  it('flattens draft rendering and schema get; omits tokens on documented unauthorised category APIs', async () => {
    const draft = await createIopBusinessRequest(credentials, 'alibaba.icbu.product.schema.render.draft', {
      param_product_top_publish_request: { cat_id: 123, product_id: '100001', language: 'en_US' }
    });
    expect(draft.parameters).toMatchObject({ cat_id: '123', product_id: '100001', language: 'en_US' });
    expect(draft.parameters).not.toHaveProperty('render_request');
    const schema = await createIopBusinessRequest(credentials, 'alibaba.icbu.product.schema.get', {
      param_product_top_publish_request: { cat_id: 123, language: 'en_US', market: 'wholesale' }
    });
    expect(schema.parameters).not.toHaveProperty('market');
    const level = await createIopBusinessRequest(credentials, 'alibaba.icbu.category.schema.level.get', {
      cat_id: 123,
      xml: '<itemSchema />',
      language: 'en_US'
    });
    expect(level.parameters).not.toHaveProperty('access_token');
    await expect(
      createIopBusinessRequest(credentials, 'alibaba.icbu.product.schema.update', {
        param_product_top_publish_request: {
          cat_id: 123,
          product_id: '9007199254740992',
          language: 'en_US',
          xml: '<itemSchema />'
        }
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
  });
  it('uses explicit seller role and rejects an unsupported buyer filter before network', async () => {
    const order = createClient(fixtures.orders);
    const { TradeAdapter } = await import('../src/trade-adapter');
    await expect(new TradeAdapter(order.client).list({ page: 1 })).resolves.toMatchObject({
      items: [{ id: 'fixture-order', status: 'PAID', amount: null, currency: null }]
    });
    expect(Object.fromEntries(order.send.mock.calls[0]?.[1].body as URLSearchParams)).toMatchObject({
      role: 'seller',
      start_page: '0'
    });
    expect(
      (order.send.mock.calls[0]?.[1].body as URLSearchParams).has('param_trade_ecology_order_list_query')
    ).toBe(false);
    order.send.mockClear();
    await expect(new TradeAdapter(order.client).list({ buyerLoginId: 'buyer' })).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED' }
    });
    expect(order.send).not.toHaveBeenCalled();
    expect(() =>
      normalizeIopBusinessResponse({ code: 0, value: {} }, 'alibaba.seller.order.list', credentials)
    ).toThrow();
    const logistics = createClient(fixtures.logistics);
    await expect(new TradeAdapter(logistics.client).getLogistics('fixture-order')).resolves.toMatchObject({
      carrier: 'Fixture carrier',
      trackingNumber: 'fixture-tracking'
    });
    expect((logistics.send.mock.calls[0]?.[1].body as URLSearchParams).get('trade_id')).toBe('fixture-order');
    await expect(
      new TradeAdapter(createClient(fixtures.unshipped).client).getLogistics('fixture-order')
    ).resolves.toMatchObject({ status: 'unknown', carrier: null, trackingNumber: null });
  });
  it('requires an explicit photo group and rejects credential parameter overrides before network', async () => {
    const { client, send } = createClient();
    await expect(new PhotoAdapter(client).list({})).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_PHOTO_GROUP_REQUIRED' }
    });
    for (const input of [{ access_token: 'override' }, { session: 'override' }, { app_key: 'override' }])
      await expect(client.call('alibaba.icbu.product.list', input)).rejects.toMatchObject({
        gatewayError: { code: 'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN' }
      });
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects a protocol/endpoint mismatch without trying a fallback gateway', async () => {
    const { send } = createClient();
    const network = new NetworkManager({
      transport: { send },
      policies: { alibaba: { allowedOrigins: [] } }
    });
    for (const input of [
      { ...credentials, endpoint: 'https://eco.taobao.com/router/rest' },
      { ...credentials, protocol: 'top' as const }
    ])
      await expect(
        new AlibabaClient(input, network).call('alibaba.icbu.product.list', {})
      ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('never retries IOP and strips credential values from provider errors', async () => {
    const { client, send } = createClient(fixtures.providerRejected, {
      maxAttempts: 3,
      shouldRetry: () => true
    });
    await expect(client.call('alibaba.icbu.product.list', {})).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_API_REJECTED', retryable: false }
    });
    expect(send).toHaveBeenCalledOnce();
    try {
      normalizeIopBusinessResponse(
        {
          code: 'InvalidToken',
          message: `rejected ${credentials.appKey} ${credentials.appSecret} ${credentials.accessToken}`
        },
        'alibaba.icbu.product.list',
        credentials
      );
    } catch (error) {
      expect(String(error)).not.toContain(credentials.appSecret);
      expect(String(error)).not.toContain(credentials.accessToken);
    }
  });
});
