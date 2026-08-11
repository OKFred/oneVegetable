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
});
