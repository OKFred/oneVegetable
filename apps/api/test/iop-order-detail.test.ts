import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/iop-order-detail.json';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import type { GatewayCredentials, NetworkTransport, TradeOrderSummary } from '@one-vegetable/core';
import { AlibabaReadGatewayClient } from '../src/gateway/alibaba-read-gateway';

const credentials: GatewayCredentials = {
  protocol: 'iop',
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256'
};
const order: TradeOrderSummary = {
  id: fixture.value.trade_id,
  buyerLoginId: null,
  status: 'unknown',
  amount: null,
  currency: null,
  createdAt: null,
  modifiedAt: null
};
describe('BFF native IOP aggregate dispatch', () => {
  it('passes interface language to native detail, keeps payments unavailable and never calls TOP', async () => {
    const send = vi.fn<NetworkTransport['send']>().mockImplementation((input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      expect(url.origin).toBe(new URL(IOP_BUSINESS_ENDPOINT).origin);
      if (url.pathname.endsWith('/alibaba/order/get')) return Promise.resolve(Response.json(fixture));
      if (url.pathname.endsWith('/order/logistics/query'))
        return Promise.resolve(Response.json({ code: '0', value: { logistic_status: 'WAIT_SHIP' } }));
      throw new Error('UNEXPECTED_IOP_PATH');
    });
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });
    const requestId = '57d9fc1f-af53-49f0-a226-21ea737f3ca6';
    const result = await gateway.request(
      'getTradeOrderAggregate',
      { order, language: 'zh_CN' },
      { requestId }
    );
    expect(result.publicDetail).toMatchObject({ source: 'iop-public', orderId: order.id });
    expect(result.fund).toBeNull();
    expect(result.logistics).toMatchObject({ status: 'WAIT_SHIP' });
    expect(send).toHaveBeenCalledTimes(2);
    const detailRequest = send.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(
        '/alibaba/order/get'
      )
    );
    expect((detailRequest?.[1].body as URLSearchParams).get('language')).toBe('zh_CN');
    expect(new Headers(detailRequest?.[1].headers).get('X-Request-ID')).toBe(requestId);
  });
});
