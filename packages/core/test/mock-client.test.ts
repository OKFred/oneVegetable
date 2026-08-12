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

  it('serves the RFQ search, detail, equity and quotation mock workflow', async () => {
    const client = new MockGatewayClient(0);
    const page = await client.request('listRfqs', {
      page: 1,
      pageSize: 20,
      keywords: 'solar',
      unquotedOnly: true
    });
    expect(page.items[0]?.id).toBe('RFQ-20260812-001');

    const detail = await client.request('getRfq', { rfqId: page.items[0]?.id ?? '' });
    const equity = await client.request('getRfqEquity', undefined);
    const quotation = await client.request('submitRfqQuotation', {
      rfqId: detail.id,
      message: 'Mock quotation',
      paymentTerms: 'T/T',
      expiresAt: '2026-08-31 00:00:00',
      prices: [
        {
          itemName: detail.subject,
          unitPrice: '599',
          currency: 'USD',
          quantity: '50',
          quantityUnit: 'Pieces',
          shippingTerms: 'FOB',
          port: 'Shenzhen',
          remark: ''
        }
      ]
    });

    expect(detail.destinationPort).toBe('Hamburg');
    expect(equity.remainingQuotes).toBeGreaterThan(0);
    expect(quotation.success).toBe(true);
  });
});
