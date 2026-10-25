import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductReferenceClient, IOP_REFERENCE_METHODS } from '../../../packages/core/src/product-reference';
import { createDocumentationReplayGateway } from '../src/gateway/documentation-replay';

afterEach(() => vi.restoreAllMocks());
describe('workerd native product reference replay', () => {
  it('executes all five contracts/signatures without calling the real network', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(new Error('REAL_PROVIDER_MUST_NOT_BE_CONTACTED')));
    const gateway = createDocumentationReplayGateway();
    const client = new ProductReferenceClient(gateway);
    expect((await client.getProduct('880001')).productId).toBe('880001');
    expect((await client.listCategories()).length).toBe(2);
    expect((await client.predictCategory({ title: 'Glass cup' })).categoryId).toBe('220001');
    expect((await client.getAttributes('220001')).saleAttributes[0]?.name).toBe('Color');
    expect((await client.listShippingTemplates()).length).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    const capabilities = await gateway.request('listCapabilities', undefined);
    for (const method of Object.values(IOP_REFERENCE_METHODS))
      expect(capabilities.find((entry) => entry.method === method)?.realCallEnabled).toBe(true);
  });
  it('keeps native contexts distinct and refuses a stale TOP context without a request', async () => {
    const gateway = createDocumentationReplayGateway();
    const payload = {
      method: IOP_REFERENCE_METHODS.getProduct,
      parameters: { product_id: '880001' }
    };
    const top = await gateway.galleryGatewayContextId();
    const native = await gateway.operationGatewayContextId('callCapability', payload);
    expect(native).not.toBe(top);
    expect(await gateway.operationProtocol('callCapability', payload)).toBe('iop');
    await expect(
      gateway.request('callCapability', payload, {
        requestId: crypto.randomUUID(),
        galleryContext: { identity: 'owner', gateway: top, storage: null }
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'GALLERY_CONTEXT_CHANGED' } });
  });
});
