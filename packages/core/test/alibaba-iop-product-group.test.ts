import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/alibaba-auth/iop-product-group.json';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../src/alibaba-iop';
import { ProductAdapter } from '../src/product-adapter';

const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256' as const
};
const method = 'alibaba.icbu.product.group.add';
describe('native IOP product group creation', () => {
  it('maps the documented parent coordinate without forwarding TOP-only context', async () => {
    const request = await createIopBusinessRequest(credentials, method, {
      group_name: 'Fixture group',
      parent_id: -1,
      extra_context: {}
    });
    expect(request.parameters.parent_group_id).toBe('-1');
    expect(request.parameters).not.toHaveProperty('parent_id');
    expect(request.parameters).not.toHaveProperty('extra_context');
    await expect(
      createIopBusinessRequest(credentials, method, {
        group_name: 'Fixture group',
        parent_id: '9007199254740993'
      })
    ).rejects.toThrow('REQUEST_CONTRACT_INVALID');
    await expect(
      createIopBusinessRequest(credentials, method, {
        group_name: 'Fixture group',
        parent_id: -1,
        extra_context: { unsupported: true }
      })
    ).rejects.toThrow('ALIBABA_IOP_PARAMETER_UNSUPPORTED');
  });
  it('requires an explicit returned group identity and keeps adapter correlation', async () => {
    const data = normalizeIopBusinessResponse(fixture, method, credentials);
    const call = vi.fn().mockResolvedValue({ method, data });
    const adapter = new ProductAdapter({ call });
    expect(await adapter.createGroup({ name: 'Fixture group', parentId: -1 })).toEqual({
      id: 700001,
      name: 'Fixture group',
      children: []
    });
    await expect(adapter.createGroup({ name: 'Different name', parentId: -1 })).rejects.toThrow();
    for (const product_group of [
      {},
      { ...fixture.product_group, group_id: 0 },
      { ...fixture.product_group, parent_id: -2 }
    ])
      expect(() =>
        normalizeIopBusinessResponse({ ...fixture, product_group }, method, credentials)
      ).toThrow();
    expect(() =>
      normalizeIopBusinessResponse({ ...fixture, error_code: 'DENIED' }, method, credentials)
    ).toThrow();
    expect(() => normalizeIopBusinessResponse({ code: '0', result: true }, method, credentials)).toThrow();
  });
});
