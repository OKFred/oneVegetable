import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/product-country-list.json';
import {
  findCapability,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import { createAlibabaRequest } from '../src/signing';

const method = 'alibaba.icbu.product.country.getcountrylist';
describe('product country list', () => {
  it('requires authorization and serializes the object once', () => {
    expect(findCapability(method)).toMatchObject({ auth: 'required', risk: 'read', enabled: true });
    const signed = createAlibabaRequest(
      {
        appKey: 'key',
        appSecret: 'secret',
        accessToken: 'token',
        endpoint: 'https://eco.taobao.com/router/rest',
        signMethod: 'hmac'
      },
      method,
      fixture.request
    );
    expect(signed.session).toBe('token');
    expect(signed.country_request).toBe(JSON.stringify(fixture.request.country_request));
  });
  it('accepts optional language but rejects the misleading curl placeholder', async () => {
    expect(await validateCapabilityRequest(method, fixture.request)).toEqual([]);
    expect(await validateCapabilityRequest(method, { country_request: {} })).toEqual([]);
    for (const parameters of [{}, { country_request: '-' }, { country_request: { language: 123 } }]) {
      expect(await validateCapabilityRequest(method, parameters)).not.toEqual([]);
    }
  });
  it('preserves nested DTO wrappers and business failures without inventing countries', async () => {
    expect(await validateCapabilityResponse(method, fixture.response)).toEqual([]);
    expect(await validateCapabilityResponse(method, fixture.failure)).toEqual([]);
    expect(await validateCapabilityResponse(method, { ...fixture.response, data: [] })).toEqual([]);
    expect(
      await validateCapabilityResponse(method, { ...fixture.response, data: [{ country_list: 123 }] })
    ).not.toEqual([]);
    expect(await validateCapabilityResponse(method, { data: fixture.response.data })).not.toEqual([]);
  });
});
