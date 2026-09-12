import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-inventory.json';
import {
  adaptProductInventory,
  ProductInventoryAdapter,
  validateProductInventorySnapshot
} from '../src/product-inventory';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import type { ProductInventoryRequest } from '../src/types';

const input: ProductInventoryRequest = { productId: '10000001', source: 'product', language: 'en_US' };
const adapt = (result: unknown) => adaptProductInventory(input, { result }, [], 123);
describe('read-only inventory evidence', () => {
  it('maps documented rows and preserves zero without inventing totals', () => {
    const raw = structuredClone(fixture.response);
    const row = raw.result.data_list[0];
    if (!row) throw new Error('Missing inventory fixture');
    row.inventory = 0;
    const result = adapt(raw.result);
    expect(result.status).toBe('ready');
    expect(result.records[0]?.inventory).toBe(0);
    expect(result.records[0]?.skuId).toBe('33323');
    expect(result).not.toHaveProperty('total');
    expect(validateProductInventorySnapshot(result)).toBe(true);
  });
  it('distinguishes no-data from absent data and requires explicit business success', () => {
    expect(adapt({ success: true, data_list: [] }).status).toBe('no-data');
    expect(adapt({ success: true }).status).toBe('drift');
    expect(adapt({ data_list: [] }).status).toBe('drift');
    expect(adapt({ success: false, data_list: [] }).status).toBe('failed');
    expect(adapt({ success: true, msg_code: 'DENIED', data_list: [] }).status).toBe('failed');
  });
  it('rejects precision loss, duplicates and missing quantities instead of repairing data', () => {
    const result = adapt({
      success: true,
      data_list: [
        { sku_id: Number.MAX_SAFE_INTEGER + 1, inventory_code: 'X' },
        { sku_id: 1, inventory_code: 'X', inventory: 2 },
        { sku_id: 1, inventory_code: 'X', inventory: 3 }
      ]
    });
    expect(result.status).toBe('drift');
    expect(result.records[0]).toMatchObject({ skuId: null, inventory: null });
    expect(result.issues.join()).toContain('duplicate-key');
  });
  it('accepts wrapped responses and surfaces validator drift without dropping useful rows', () => {
    const result = adaptProductInventory(
      input,
      { alibaba_icbu_product_inventory_get_response: fixture.response },
      ['result:additionalProperties']
    );
    expect(result.status).toBe('drift');
    expect(result.records).toHaveLength(1);
  });
  it('validates before networking and requests exactly one selected source', async () => {
    const call = vi.fn().mockResolvedValue({ data: fixture.response });
    const adapter = new ProductInventoryAdapter(
      { call },
      validateCapabilityRequest,
      validateCapabilityResponse
    );
    await expect(adapter.get({ ...input, productId: 'invalid' })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    expect((await adapter.get(input)).status).toBe('ready');
    expect(call).toHaveBeenCalledExactlyOnceWith('alibaba.icbu.product.inventory.get', {
      product_id: input.productId,
      language: 'en_US'
    });
  });
});
