import { describe, expect, it } from 'vitest';

import { MockGatewayClient } from '../src/mock-client';

describe('MockGatewayClient', () => {
  it('serves the typed product workflow without credentials', async () => {
    const client = new MockGatewayClient(0);
    const firstPage = await client.request('listProducts', { page: 1, pageSize: 2 });
    const secondPage = await client.request('listProducts', { page: 2, pageSize: 2 });
    expect(firstPage).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([...firstPage.items, ...secondPage.items].map((product) => product.id))).toHaveProperty(
      'size',
      3
    );

    const filtered = await client.request('listProducts', { subject: 'canvas tote' });
    expect(filtered).toMatchObject({ total: 1 });
    expect(filtered.items[0]?.id).toBe('10000002');

    const grouped = await client.request('listProducts', { groupId: 1001 });
    expect(grouped).toMatchObject({ total: 1 });
    expect(grouped.items[0]?.groupName).toBe('Energy storage');

    const dashboard = await client.request('getDashboard', undefined);
    expect(dashboard).toMatchObject({ productCount: 3, photoCount: 3 });

    const result = await client.request('publishProduct', {
      categoryId: 100003109,
      language: 'en_US',
      schemaXml: '<itemSchema />'
    });
    expect(result.success).toBe(true);
  });

  it('returns PhotoBank metadata for selection, upload and URL transfer mocks', async () => {
    const client = new MockGatewayClient(0);
    const firstPage = await client.request('listPhotos', { page: 1, pageSize: 2, groupId: '-1' });
    const secondPage = await client.request('listPhotos', { page: 2, pageSize: 2, groupId: '-1' });
    expect(firstPage).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([...firstPage.items, ...secondPage.items].map((photo) => photo.id))).toHaveProperty(
      'size',
      3
    );
    expect(firstPage.items[0]).toMatchObject({ id: 'ph_001', referenceCount: 4 });
    expect(firstPage.items[0]?.fileSize).toBeGreaterThan(0);
    expect(firstPage.items[0]?.url).toMatch(/^https:\/\/sc04\.alicdn\.com\//u);
    expect(firstPage.items[0]?.previewUrl).toMatch(/^data:image\/svg\+xml;base64,/u);

    const groupPage = await client.request('listPhotos', { page: 1, pageSize: 24, groupId: '2001' });
    expect(groupPage).toMatchObject({ total: 2 });
    expect(groupPage.items.every((photo) => photo.groupId === '2001')).toBe(true);

    const uploaded = await client.request('uploadPhoto', {
      fileName: 'new-product.jpg',
      contentBase64: '/9j/2Q==',
      contentType: 'image/jpeg',
      byteLength: 4,
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
