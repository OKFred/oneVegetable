import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/iop-business-responses.json';
import { AlibabaClient } from '../src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import {
  createIopBusinessRequest,
  iopOperationReason,
  normalizeIopBusinessResponse
} from '../src/alibaba-iop-business';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { ProductAdapter } from '../src/product-adapter';
import { PhotoAdapter } from '../src/photo-adapter';
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
describe('explicit IOP business compatibility', () => {
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
  it('fails unsupported methods and writes before network; never derives a path from the TOP method', async () => {
    const { client, send } = createClient();
    for (const method of [
      'alibaba.seller.trade.order.list',
      'alibaba.icbu.product.schema.add',
      'alibaba.icbu.product.schema.update',
      'alibaba.icbu.photobank.group.operate'
    ]) {
      await expect(client.call(method, {})).rejects.toMatchObject({
        gatewayError: {
          code: method.includes('schema.')
            ? 'ALIBABA_IOP_MUTATION_UNVERIFIED'
            : 'ALIBABA_IOP_METHOD_UNSUPPORTED'
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
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' } });
    expect(send).not.toHaveBeenCalled();
    expect(iopOperationReason('updateProduct')).toBe('ALIBABA_IOP_MUTATION_UNVERIFIED');
    expect(iopOperationReason('getProductDraft')).toBeNull();
    expect(iopOperationReason('listProductGroups')).toBeNull();
    expect(iopOperationReason('listPhotoGroups')).toBeNull();
    expect(iopOperationReason('callCapability', 'alibaba.icbu.product.list')).toBeNull();
    expect(iopOperationReason('callCapability', 'alibaba.icbu.product.schema.update')).not.toBeNull();
  });
  it('maps documented Schema write shapes without opening unverified production writes', async () => {
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
