import { describe, expect, it } from 'vitest';
import typeFixture from '../../../mock/data/product-type-available.json';
import inventoryFixture from '../../../mock/data/product-inventory.json';
import skuFixture from '../../../mock/data/product-sku-inventory.json';
import listFixture from '../../../mock/data/showcase-list.json';
import statusFixture from '../../../mock/data/showcase-status.json';
import {
  findCapability,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import { createAlibabaRequest } from '../src/signing';

const fixtures = [typeFixture, inventoryFixture, skuFixture, listFixture, statusFixture];

describe('product stock and showcase read contracts', () => {
  it.each(fixtures)('$method is an authorized read with valid examples', async (fixture) => {
    expect(findCapability(fixture.method)).toMatchObject({
      auth: 'required',
      risk: 'read',
      enabled: true,
      jushitaOnly: false
    });
    expect(await validateCapabilityRequest(fixture.method, fixture.request)).toEqual([]);
    expect(await validateCapabilityResponse(fixture.method, fixture.response)).toEqual([]);
    const signed = createAlibabaRequest(
      {
        appKey: 'key',
        appSecret: 'secret',
        accessToken: 'token',
        endpoint: 'https://eco.taobao.com/router/rest',
        signMethod: 'hmac'
      },
      fixture.method,
      fixture.request
    );
    expect(signed.session).toBe('token');
    expect(signed.simplify).toBe('true');
  });

  it.each([inventoryFixture, skuFixture])('validates $method IDs losslessly', async ({ method }) => {
    expect(
      await validateCapabilityRequest(method, { product_id: '9223372036854775807', language: 'en_US' })
    ).toEqual([]);
    for (const product_id of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '', '1x']) {
      expect(await validateCapabilityRequest(method, { product_id, language: 'en_US' })).not.toEqual([]);
    }
    expect(await validateCapabilityRequest(method, { language: 'en_US' })).not.toEqual([]);
    expect(
      await validateCapabilityResponse(method, { result: { success: false, msg_code: 'NO_INVENTORY' } })
    ).toEqual([]);
    expect(await validateCapabilityResponse(method, { result: { success: true, data_list: [] } })).toEqual(
      []
    );
    expect(
      await validateCapabilityResponse(method, { result: { data_list: [{ inventory: 'invalid' }] } })
    ).not.toEqual([]);
  });

  it('validates optional pagination and nested type request', async () => {
    expect(await validateCapabilityRequest(typeFixture.method, { type_request: {} })).toEqual([]);
    expect(await validateCapabilityRequest(typeFixture.method, { type_request: '-' })).not.toEqual([]);
    expect(await validateCapabilityRequest(listFixture.method, {})).toEqual([]);
    expect(await validateCapabilityRequest(listFixture.method, { to_page: 0 })).not.toEqual([]);
    expect(await validateCapabilityResponse(listFixture.method, { results: [] })).toEqual([]);
    expect(
      await validateCapabilityResponse(statusFixture.method, { total_count: 0, current_count: 0 })
    ).toEqual([]);
    expect(await validateCapabilityResponse(statusFixture.method, { total_count: 'unknown' })).not.toEqual(
      []
    );
    expect(await validateCapabilityRequest(statusFixture.method, { unexpected: true })).not.toEqual([]);
  });
});
