import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/iop-order-roles/transport.json';
import { AlibabaClient } from '../src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT } from '../src/alibaba-iop';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { TradeAdapter } from '../src/trade-adapter';
import { validateTradeOrderListQuery } from '../src/generated/validators-core';

const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256' as const
};

function client() {
  const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(fixture.list));
  const adapter = new TradeAdapter(
    new AlibabaClient(
      credentials,
      new NetworkManager({
        transport: { send },
        policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
      }),
      { maxAttempts: 1 }
    )
  );
  return { send, adapter };
}

describe('trade order role compatibility', () => {
  it('accepts an optional role without changing the historical query object', () => {
    const legacy = { page: 1, pageSize: 20 };
    expect(validateTradeOrderListQuery(legacy)).toBe(true);
    expect(legacy).toEqual({ page: 1, pageSize: 20 });
    expect(validateTradeOrderListQuery({ ...legacy, role: 'buyer' })).toBe(true);
    expect(validateTradeOrderListQuery({ ...legacy, role: 'seller' })).toBe(true);
    expect(validateTradeOrderListQuery({ ...legacy, role: 'admin' })).toBe(false);
  });
  it.each(['seller', 'buyer'] as const)(
    'sends %s through the public IOP path and retains perspective',
    async (role) => {
      const { adapter, send } = client();
      const result = await adapter.list({ page: 2, pageSize: 20, role });
      expect(result.items[0]).toMatchObject({ id: '900001', role });
      expect(result.items[0]?.buyerLoginId).toBe(role === 'buyer' ? null : 'fixture-seller');
      expect(result.items[0]?.amount).toBeNull();
      expect(result.items[0]?.currency).toBeNull();
      expect(send).toHaveBeenCalledTimes(1);
      const invocation = send.mock.calls[0];
      if (!invocation) throw new Error('Expected exactly one request');
      const [url, init] = invocation;
      expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toBe(
        IOP_BUSINESS_ENDPOINT + '/alibaba/order/list'
      );
      const body = init.body as URLSearchParams;
      expect(body.get('role')).toBe(role);
      expect(body.get('start_page')).toBe('1');
      expect(body.has('param_trade_ecology_order_list_query')).toBe(false);
      expect(body.has('session')).toBe(false);
    }
  );
  it('keeps omitted role as seller and preserves TOP query envelope', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ data: { value: fixture.list.value }, method: 'alibaba.seller.order.list' });
    const adapter = new TradeAdapter({ call });
    const result = await adapter.list({ page: 1 });
    expect(call).toHaveBeenCalledWith('alibaba.seller.order.list', {
      param_trade_ecology_order_list_query: { role: 'seller', start_page: 0, page_size: 20 }
    });
    expect(result.items[0]).not.toHaveProperty('role');
    await adapter.list({ role: 'buyer' });
    expect(call.mock.lastCall?.[1]).toMatchObject({
      param_trade_ecology_order_list_query: { role: 'buyer' }
    });
  });
  it('rejects a buyer-only search under purchase perspective before dispatch', async () => {
    const { adapter, send } = client();
    await expect(adapter.list({ role: 'buyer', buyerLoginId: 'fixture-buyer' })).rejects.toMatchObject({
      gatewayError: { code: 'REQUEST_CONTRACT_INVALID' }
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('does not retry or switch protocol after a purchase permission denial', async () => {
    const { adapter, send } = client();
    send
      .mockReset()
      .mockResolvedValue(Response.json({ code: 'InsufficientPermission', message: 'Permission denied' }));
    await expect(adapter.list({ role: 'buyer' })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps an explicit empty purchase response empty without fabricating totals', async () => {
    const { adapter, send } = client();
    send.mockReset().mockResolvedValue(Response.json(fixture.empty));
    expect(await adapter.list({ role: 'buyer' })).toMatchObject({ items: [], total: 0, page: 1 });
  });
});
