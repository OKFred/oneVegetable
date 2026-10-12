import { describe, expect, it, vi } from 'vitest';
import { getCapabilityDefinition } from '@one-vegetable/core';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import type { GatewayCredentials, NetworkTransport } from '@one-vegetable/core';
import fixture from '../../../mock/data/alibaba-auth/iop-business-responses.json';
import credentialsFixture from '../../../mock/data/node-gateway-credentials.json';
import { AlibabaReadGatewayClient } from '../src/gateway/alibaba-read-gateway';

const credentials: GatewayCredentials = {
  ...credentialsFixture.manual,
  protocol: 'iop',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256'
};
const request = { productId: '10000001', source: 'product', language: 'en_US' } as const;
function gateway(response: unknown) {
  const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(response));
  return { send, client: new AlibabaReadGatewayClient(credentials, { transport: { send } }) };
}
function parameters(send: ReturnType<typeof gateway>['send']): URLSearchParams {
  const body = send.mock.calls[0]?.[1].body;
  if (!(body instanceof URLSearchParams)) throw new Error('Expected signed form');
  expect(body.get('access_token')).toBe(credentials.accessToken);
  expect(body.has('method')).toBe(false);
  expect(body.has('session')).toBe(false);
  return body;
}
function target(send: ReturnType<typeof gateway>['send']): string {
  const input = send.mock.calls[0]?.[0];
  if (!input) throw new Error('Expected request URL');
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

describe('IOP inventory and product identity gateway integration', () => {
  it('routes dedicated inventory reads through the IOP adapter and real contract', async () => {
    const h = gateway(fixture.inventory);
    const result = await h.client.request('getProductInventory', request);
    expect(result.status).toBe('ready');
    expect(result.records.length).toBeGreaterThan(0);
    expect(parameters(h.send).get('product_id')).toBe(request.productId);
    expect(target(h.send)).toBe(`${IOP_BUSINESS_ENDPOINT}/icbu/product/inventory/get`);
    expect(h.send).toHaveBeenCalledOnce();
  });

  it('shares generic inventory and encryption availability with the method definitions', async () => {
    const h = gateway(fixture.encryptedProduct);
    for (const method of ['alibaba.icbu.product.inventory.get', 'alibaba.icbu.product.id.encrypt']) {
      const definition = getCapabilityDefinition(method);
      expect(await h.client.request('getCapabilityDefinition', { method })).toEqual(definition);
      expect(definition?.realCallEnabled).toBe(true);
    }
    const result = await h.client.request('callCapability', {
      method: 'alibaba.icbu.product.id.encrypt',
      parameters: { product_id: Number(request.productId), language: request.language }
    });
    expect(result.contractValid).toBe(true);
    expect(parameters(h.send).get('product_id')).toBe(request.productId);
    expect(target(h.send)).toBe(`${IOP_BUSINESS_ENDPOINT}/alibaba/icbu/product/id/encrypt`);
    expect(h.send).toHaveBeenCalledOnce();
  });

  it('rejects unsupported SKU reads, malformed requests and inventory writes before networking', async () => {
    const h = gateway(fixture.inventory);
    await expect(
      h.client.request('getProductInventory', { ...request, source: 'sku' })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' } });
    await expect(
      h.client.request('getProductInventory', { ...request, productId: 'invalid' })
    ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
    await expect(
      h.client.request('callCapability', { method: 'alibaba.icbu.product.inventory.update', parameters: {} })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_METHOD_UNSUPPORTED' } });
    expect(h.send).not.toHaveBeenCalled();
  });

  it('never retries a transport failure or interprets a missing list as empty inventory', async () => {
    const h = gateway({ code: 0, result: { success: true } });
    await expect(h.client.request('getProductInventory', request)).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_RESPONSE_INVALID' }
    });
    expect(h.send).toHaveBeenCalledOnce();
    h.send.mockClear().mockRejectedValue(new TypeError('fixture disconnected'));
    await expect(h.client.request('getProductInventory', request)).rejects.toThrow();
    expect(h.send).toHaveBeenCalledOnce();
  });
});
