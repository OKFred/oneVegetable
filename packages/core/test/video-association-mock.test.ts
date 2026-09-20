import { describe, expect, it } from 'vitest';
import { MockGatewayClient } from '../src/mock-client';
import { VIDEO_MOCK_DATA, PRODUCT_MOCK_DATA } from '../src/generated/mock-data';

describe('video association simulation', () => {
  it('keeps main and detail separate and readback does not write', async () => {
    const gateway = new MockGatewayClient(0);
    const video = VIDEO_MOCK_DATA.responses.listVideos.items[1];
    const product = PRODUCT_MOCK_DATA.responses.listProducts.items[0];
    if (!video?.id || !video.encryptedId || !product) throw new Error('Missing fixtures');
    const request = {
      productId: product.id,
      videoId: video.id,
      encryptedVideoId: video.encryptedId,
      type: 'main' as const,
      language: 'en_US' as const
    };
    expect((await gateway.request('verifyProductVideoAssociation', request)).outcome).toBe('unconfirmed');
    expect((await gateway.request('associateProductVideo', { ...request, confirmed: true })).outcome).toBe(
      'confirmed'
    );
    expect((await gateway.request('verifyProductVideoAssociation', request)).outcome).toBe('confirmed');
    expect(
      (await gateway.request('verifyProductVideoAssociation', { ...request, type: 'detail' })).outcome
    ).toBe('unconfirmed');
    const relation = await gateway.request('listVideoRelatedProducts', {
      videoId: video.encryptedId,
      type: 'main'
    });
    expect(relation.encryptedProductIds).toHaveLength(1);
    const encryptedProductId = relation.encryptedProductIds[0];
    if (!encryptedProductId) throw new Error('Missing relation');
    expect(
      await gateway.request('resolveVideoRelatedProduct', { encryptedProductId, language: 'en_US' })
    ).toMatchObject({ productId: product.id, product: { id: product.id } });
  });
});
