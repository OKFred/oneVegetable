import { describe, expect, it } from 'vitest';

import { MockGatewayClient } from '../src/mock-client';

describe('MockGatewayClient', () => {
  it('serves the typed product workflow without credentials', async () => {
    const client = new MockGatewayClient(0);
    const products = await client.request('listProducts', { page: 1, pageSize: 20 });
    expect(products.items.length).toBeGreaterThan(0);
    const result = await client.request('publishProduct', {
      categoryId: 100003109,
      language: 'en_US',
      schemaXml: '<itemSchema />'
    });
    expect(result.success).toBe(true);
  });

  it('returns PhotoBank metadata for selection, upload and URL transfer mocks', async () => {
    const client = new MockGatewayClient(0);
    const photos = await client.request('listPhotos', { page: 1, pageSize: 24, groupId: '-1' });
    expect(photos.items[0]).toMatchObject({ id: 'ph_001', referenceCount: 4 });
    expect(photos.items[0]?.fileSize).toBeGreaterThan(0);

    const uploaded = await client.request('uploadPhoto', {
      file: 'aGVsbG8=',
      fileName: 'new-product.jpg',
      groupId: '2002'
    });
    expect(uploaded).toMatchObject({ name: 'new-product.jpg', groupId: '2002', referenceCount: 0 });

    const transferred = await client.request('transferPhotoFromUrl', {
      url: 'https://images.example.com/detail.jpg',
      groupId: '2002'
    });
    expect(transferred).toMatchObject({ name: 'detail.jpg', groupId: '2002' });
  });
});
