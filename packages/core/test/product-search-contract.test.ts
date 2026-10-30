import { describe, expect, it } from 'vitest';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-registry';
import { createIopBusinessRequest } from '../src/alibaba-iop-business';
import { IOP_REFERENCE_METHODS } from '../src/product-reference-methods';
import type { GatewayCredentials } from '../src/types';

const method = IOP_REFERENCE_METHODS.searchProducts;
const credentials: GatewayCredentials = {
  protocol: 'iop',
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  endpoint: 'https://openapi-api.alibaba.com/rest',
  signMethod: 'hmac-sha256'
};

describe('native IOP product search public contract', () => {
  it.each([
    {},
    { model_number: '' },
    { model_number: '   ' },
    { model_number: 'A', sku_code: 'B' },
    { sku_code: 'A', page_size: 21 },
    { sku_code: 'A', page_index: 0 },
    { model_number: 'A', session: 'fixture' }
  ])('rejects blank, ambiguous, out-of-range and transport input %j', async (parameters) => {
    expect(await validateCapabilityRequest(method, parameters)).not.toEqual([]);
  });
  it('signs the native path and preserves exact model, page and size', async () => {
    const request = await createIopBusinessRequest(credentials, method, {
      model_number: 'MODEL-001',
      page_index: 2,
      page_size: 20
    });
    expect(request.url).toContain('/rest/alibaba/icbu/product/search/v2');
    expect(request.parameters.model_number).toBe('MODEL-001');
    expect(request.parameters.page_index).toBe('2');
    expect(request.parameters.page_size).toBe('20');
    expect(request.parameters).not.toHaveProperty('session');
  });
  it('requires successful payload and real pagination structure', async () => {
    expect(await validateCapabilityResponse(method, { success: true })).not.toEqual([]);
    expect(
      await validateCapabilityResponse(method, {
        success: true,
        product_info: [],
        page: { page_index: 1, page_size: 20, total_item: 0, total_page: 0 }
      })
    ).toEqual([]);
  });
});
