import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/iop-inventory-update.json';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../src/alibaba-iop';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-registry';

const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256' as const
};
const method = 'alibaba.icbu.product.inventory.update';
const cell = { operate: 'plus', inventory_code: 'FIXTURE_WH', inventory: 1, sku_id: 700002 };
const request = { request_param: { product_id: 700001, inventory_list: [cell] } };

describe('IOP inventory delta adaptation', () => {
  it('flattens only the native parameters, preserves delta and warehouse identity', async () => {
    expect(await validateCapabilityRequest(method, request)).toEqual([]);
    const signed = await createIopBusinessRequest(credentials, method, request);
    expect(signed.url).toBe(IOP_BUSINESS_ENDPOINT + '/icbu/product/inventory/update');
    expect(signed.parameters).not.toHaveProperty('request_param');
    expect(signed.parameters.product_id).toBe('700001');
    expect(JSON.parse(signed.parameters.inventory_list ?? 'null') as unknown).toEqual([cell]);
    const sub = await createIopBusinessRequest(credentials, method, {
      request_param: { product_id: '700001', inventory_list: [{ ...cell, operate: 'sub', sku_id: '700002' }] }
    });
    expect(JSON.parse(sub.parameters.inventory_list ?? 'null') as unknown).toMatchObject([
      {
        operate: 'sub',
        inventory: 1,
        sku_id: 700002
      }
    ]);
  });
  it.each([
    {},
    { request_param: { ...request.request_param, extra: true } },
    { request_param: { ...request.request_param, inventory_list: [] } },
    { request_param: { ...request.request_param, inventory_list: [cell, cell] } },
    ...[
      { inventory: 0 },
      { inventory: -1 },
      { inventory: 1.5 },
      { sku_id: '9007199254740993' },
      { operate: 'set' },
      { inventory_code: ' ' },
      { inventory_code: 'a\nb' },
      { extra: true }
    ].map((patch) => ({
      request_param: { ...request.request_param, inventory_list: [{ ...cell, ...patch }] }
    }))
  ])('rejects unsupported or unsafe mutations before dispatch %#', async (input) => {
    await expect(createIopBusinessRequest(credentials, method, input)).rejects.toThrow();
  });
  it('requires both explicit acknowledgement flags and produces a valid shared response', async () => {
    const normalized = normalizeIopBusinessResponse(fixture, method, credentials) as Record<string, unknown>;
    expect(
      await validateCapabilityResponse(method, normalized.alibaba_icbu_product_inventory_update_response)
    ).toEqual([]);
    expect(normalized).toMatchObject({
      alibaba_icbu_product_inventory_update_response: { result: { success: true, data: 'true' } }
    });
    for (const result of [
      {},
      { success: true },
      { data: 'true' },
      { success: true, data: '' },
      { success: true, data: 'false' },
      { success: false, data: 'true' },
      { ...fixture.result, msg_code: 'DENIED' },
      { ...fixture.result, error_code: 'DENIED' }
    ])
      expect(() => normalizeIopBusinessResponse({ ...fixture, result }, method, credentials)).toThrow();
    expect(() =>
      normalizeIopBusinessResponse({ ...fixture, code: '10000002' }, method, credentials)
    ).toThrow();
  });
});
