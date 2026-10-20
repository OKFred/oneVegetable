import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/iop-order-detail.json';
import { AlibabaClient } from '../src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { GatewayException } from '../src/errors';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { TradeAdapter } from '../src/trade-adapter';
import type { GatewayCredentials, TradeOrderSummary } from '../src/types';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import contract from '../../../openapi/one-vegetable.json';

const credentials: GatewayCredentials = {
  protocol: 'iop',
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256'
};
const order: TradeOrderSummary = {
  id: fixture.value.trade_id,
  status: 'unknown',
  buyerLoginId: null,
  amount: null,
  currency: null,
  createdAt: null,
  modifiedAt: null
};
function transportUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
function client(detail: unknown = fixture, logisticsFailure = false) {
  const send = vi.fn<NetworkTransport['send']>().mockImplementation((url) => {
    const path = transportUrl(url);
    if (path.endsWith('/alibaba/order/get')) return Promise.resolve(Response.json(detail));
    if (path.endsWith('/order/logistics/query'))
      return Promise.resolve(
        Response.json(
          logisticsFailure
            ? { code: 'IllegalAccess', message: 'Permission denied', request_id: 'fixture-logistics-denied' }
            : { code: '0', value: { logistic_status: 'WAIT_SHIP', shipping_order_list: [] } }
        )
      );
    throw new Error('Unexpected platform request');
  });
  const network = new NetworkManager({
    transport: { send },
    policies: { alibaba: { allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin] } }
  });
  return { send, client: new AlibabaClient(credentials, network) };
}
describe('native public IOP order detail', () => {
  it('signs only the documented native path and preserves opaque IDs and interface language', async () => {
    const input = { e_trade_id: order.id, language: 'zh_CN' };
    const request = await createIopBusinessRequest(credentials, '/alibaba/order/get', input, 1800000000000);
    expect(request.url).toBe(`${IOP_BUSINESS_ENDPOINT}/alibaba/order/get`);
    expect(request.parameters).toMatchObject(input);
    expect(request.parameters.sign).toBe(
      await signIopRequest('/alibaba/order/get', request.parameters, credentials.appSecret)
    );
    expect(request.parameters).not.toHaveProperty('session');
    expect(request.parameters).not.toHaveProperty('method');
    for (const bad of [
      { ...input, e_trade_id: 123 },
      { ...input, language: 'zh-CN' },
      { ...input, data_select: 'private' }
    ])
      await expect(createIopBusinessRequest(credentials, '/alibaba/order/get', bad)).rejects.toBeInstanceOf(
        GatewayException
      );
  });
  it('rejects missing success evidence and mismatched IDs before exposing native data', () => {
    for (const raw of [
      { value: fixture.value },
      { code: '0' },
      { ...fixture, value: { ...fixture.value, trade_id: 'other' } }
    ])
      expect(() =>
        normalizeIopBusinessResponse(raw, '/alibaba/order/get', credentials, { e_trade_id: order.id })
      ).toThrow();
  });
  it('aggregates public detail and logistics without calling TOP funds or inventing payment values', async () => {
    const current = client();
    const snapshot = structuredClone(order);
    const aggregate = await new TradeAdapter(current.client).getAggregate(order, 'zh_CN');
    expect(aggregate.publicDetail).toEqual({
      source: 'iop-public',
      orderId: order.id,
      status: 'WAIT_SELLER_SEND',
      buyerName: 'Example Buyer',
      totalAmount: { amount: '120.50', currency: 'USD' },
      products: [
        {
          lineId: 'line-1',
          productId: '123456789',
          name: 'Example unbranded item',
          quantity: '2.500',
          unit: 'piece',
          unitPrice: { amount: '48.20', currency: 'USD' }
        }
      ]
    });
    expect(aggregate.fund).toBeNull();
    expect(aggregate.availability).toMatchObject({
      fund: 'unavailable',
      logistics: 'available',
      fullDetail: 'jushita-only'
    });
    expect(aggregate.order).toEqual(snapshot);
    expect(order).toEqual(snapshot);
    expect(current.send).toHaveBeenCalledTimes(2);
    expect(
      current.send.mock.calls.every(([url]) => transportUrl(url).startsWith(IOP_BUSINESS_ENDPOINT))
    ).toBe(true);
    const body = current.send.mock.calls.find(([url]) =>
      transportUrl(url).endsWith('/alibaba/order/get')
    )?.[1].body as URLSearchParams;
    expect(body.get('language')).toBe('zh_CN');
    expect(JSON.stringify(aggregate)).not.toMatch(/never-export|advance_amount|email/);
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile({
      $ref: '#/components/schemas/TradeOrderAggregate',
      components: contract.components
    });
    expect(validate(aggregate)).toBe(true);
  });
  it('does not confuse missing fields with zero or an empty product list', async () => {
    const current = client({ code: '0', value: { trade_id: order.id } });
    const result = await new TradeAdapter(current.client).getAggregate(order);
    expect(result.publicDetail).toEqual({
      source: 'iop-public',
      orderId: order.id,
      status: null,
      buyerName: null,
      totalAmount: null,
      products: null
    });
    const empty = client({ code: '0', value: { trade_id: order.id, order_products: [] } });
    expect((await new TradeAdapter(empty.client).getAggregate(order)).publicDetail?.products).toEqual([]);
  });
  it.each([
    { total_amount: { amount: 12, currency: 'USD' } },
    { total_amount: { amount: '12' } },
    { buyer: 'not-an-object' },
    { order_products: {} },
    { order_products: [null] },
    { order_products: [{ product_id: Number.MAX_SAFE_INTEGER + 1 }] },
    { order_products: [{ quantity: 2 }] },
    { order_products: [{ unit_price: { amount: 'NaN', currency: 'USD' } }] }
  ])('keeps malformed public detail isolated from valid logistics: %j', async (fields) => {
    const current = client({ code: '0', value: { ...fixture.value, ...fields } });
    const result = await new TradeAdapter(current.client).getAggregate(order);
    expect(result.publicDetail).toBeNull();
    expect(result.publicDetailError).toMatchObject({ retryable: false });
    expect(result.logistics).toMatchObject({ status: 'WAIT_SHIP' });
    expect(current.send).toHaveBeenCalledTimes(2);
  });
  it('keeps valid detail when logistics is denied, with no fallback or retries', async () => {
    const current = client(fixture, true);
    const result = await new TradeAdapter(current.client).getAggregate(order);
    expect(result.publicDetail?.orderId).toBe(order.id);
    expect(result.logistics).toBeNull();
    expect(current.send).toHaveBeenCalledTimes(2);
  });
  it('does not send native paths through historical TOP credentials', async () => {
    const current = client();
    const network = new NetworkManager({
      transport: { send: current.send },
      policies: { alibaba: { allowedOrigins: ['https://eco.taobao.com'] } }
    });
    const historical = { ...credentials, endpoint: 'https://eco.taobao.com/router/rest' };
    delete historical.protocol;
    const top = new AlibabaClient(historical, network);
    await expect(top.call('/alibaba/order/get', { e_trade_id: order.id })).rejects.toBeInstanceOf(
      GatewayException
    );
    expect(current.send).not.toHaveBeenCalled();
  });
});
