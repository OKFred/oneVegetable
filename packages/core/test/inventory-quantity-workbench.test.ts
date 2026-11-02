import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-inventory-readback-diagnostic.json';
import numericFixture from '../../../mock/data/product-get-numeric-fields.json';
import {
  adaptAbsoluteProductInventory,
  adaptProductInventory,
  ProductInventoryAdapter,
  validateProductInventorySnapshot
} from '../src/product-inventory';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';
const productId = fixture.productIds[0];
if (!productId) throw new Error('Synthetic inventory product missing');
const request = { productId, source: 'absolute', language: 'en_US' } as const;
function data() {
  const raw = structuredClone(fixture.product);
  Reflect.set(raw.product_info.basic_info, 'product_id', request.productId);
  Reflect.set(raw.product_info.trade_info, 'sku_info', structuredClone(fixture.absoluteInventorySkus));
  return raw;
}
const adapt = (raw: unknown, issues: string[] = []) =>
  adaptAbsoluteProductInventory(request, raw, issues, 'inventory-read-fixture', 123);
describe('workbench scoped quantity evidence', () => {
  it('accepts observed numeric get/v2 leaves while keeping SPU zero separate from SKU stock', async () => {
    const raw = structuredClone(numericFixture.response);
    const input = { ...request, productId: String(raw.product_info.basic_info.product_id) };
    const call = vi.fn().mockResolvedValue({ data: raw });
    const adapter = new ProductInventoryAdapter(
      { call, protocol: 'iop' },
      validateCapabilityRequest,
      validateCapabilityResponse
    );
    const result = await adapter.get(input);
    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.quantityEvidence).toEqual([
      { scope: 'spu', skuId: null, status: 'available', quantity: '0', reasonCode: null },
      { scope: 'sku', skuId: '990901', status: 'available', quantity: '9', reasonCode: null }
    ]);
    expect(validateProductInventorySnapshot(result)).toBe(true);
  });
  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 1])(
    'never treats invalid numeric get/v2 quantity %s as available evidence',
    async (quantity) => {
      const raw = structuredClone(numericFixture.response);
      raw.product_info.trade_info.inventory = quantity;
      const sku = raw.product_info.trade_info.sku_info[0];
      if (!sku) throw new Error('Missing fixture SKU');
      sku.inventory = quantity;
      const adapter = new ProductInventoryAdapter(
        { call: vi.fn().mockResolvedValue({ data: raw }), protocol: 'iop' },
        validateCapabilityRequest,
        validateCapabilityResponse
      );
      const result = await adapter.get({
        ...request,
        productId: String(raw.product_info.basic_info.product_id)
      });
      expect(result.quantityEvidence?.map((row) => [row.status, row.quantity])).toEqual([
        ['unavailable', null],
        ['unavailable', null]
      ]);
    }
  );

  it('retains exact SPU and SKU quantities without warehouse totals or precision loss', () => {
    const raw = data();
    Reflect.set(raw.product_info.trade_info, 'inventory', '9223372036854775807');
    const snapshot = adapt(raw);
    expect(snapshot).toMatchObject({ protocol: 'iop', source: 'absolute', status: 'ready', records: [] });
    expect(snapshot.quantityEvidence).toEqual([
      { scope: 'spu', skuId: null, status: 'available', quantity: '9223372036854775807', reasonCode: null },
      { scope: 'sku', skuId: '990901', status: 'available', quantity: '3', reasonCode: null },
      { scope: 'sku', skuId: '990902', status: 'available', quantity: '0', reasonCode: null }
    ]);
    expect(validateProductInventorySnapshot(snapshot)).toBe(true);
  });
  it('never substitutes SKU quantities for a missing SPU quantity', () => {
    const raw = data();
    Reflect.deleteProperty(raw.product_info.trade_info, 'inventory');
    expect(adapt(raw).quantityEvidence?.[0]).toMatchObject({
      quantity: null,
      reasonCode: 'QUANTITY_MISSING'
    });
    Reflect.deleteProperty(raw.product_info.trade_info, 'sku_info');
    const snapshot = adapt(raw);
    expect(snapshot.status).toBe('no-data');
    expect(snapshot.quantityEvidence).toEqual([
      { scope: 'spu', skuId: null, status: 'unavailable', quantity: null, reasonCode: 'QUANTITY_MISSING' }
    ]);
  });
  it.each(['product', 'audit', 'platform', 'contract', 'business', 'duplicate'] as const)(
    'does not claim quantity evidence after %s mismatch',
    (kind) => {
      const raw = data();
      if (kind === 'product') Reflect.set(raw.product_info.basic_info, 'product_id', '880999');
      if (kind === 'audit') Reflect.set(raw.product_info.basic_info, 'audit_status', 'pending');
      if (kind === 'platform') Reflect.set(raw.product_info.basic_info, 'status', 'deleted');
      if (kind === 'business') Reflect.set(raw, 'success', false);
      if (kind === 'duplicate')
        Reflect.set(raw.product_info.trade_info, 'sku_info', [
          fixture.absoluteInventorySkus[0],
          fixture.absoluteInventorySkus[0]
        ]);
      const snapshot = adapt(raw, kind === 'contract' ? ['/product_info:required'] : []);
      const evidence = kind === 'duplicate' ? snapshot.quantityEvidence?.slice(1) : snapshot.quantityEvidence;
      expect(evidence?.every((entry) => entry.status === 'unavailable')).toBe(true);
    }
  );
  it.each([1.5, Number.MAX_SAFE_INTEGER + 1, -1])('rejects unsafe warehouse quantity %s', (inventory) => {
    const snapshot = adaptProductInventory(
      { ...request, source: 'product' },
      { result: { success: true, data_list: [{ sku_id: 1, inventory_code: 'FIXTURE', inventory }] } }
    );
    expect(snapshot.status).toBe('drift');
    expect(snapshot.records[0]?.inventory).toBeNull();
  });
  it('requires IOP before any absolute-quantity provider call', async () => {
    const call = vi.fn();
    const adapter = new ProductInventoryAdapter(
      { call, protocol: 'top' },
      validateCapabilityRequest,
      validateCapabilityResponse
    );
    await expect(adapter.get(request)).rejects.toMatchObject({
      gatewayError: { code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED' }
    });
    expect(call).not.toHaveBeenCalled();
    expect(() =>
      selectAlibabaOperationProtocol('getProductInventory', request, {
        top: true,
        iop: false,
        defaultProtocol: 'top',
        bindingConfirmed: false
      })
    ).toThrow();
  });
  it.each(['top', 'iop'] as const)('routes each scope with dual default %s', (defaultProtocol) => {
    const available = { top: true, iop: true, defaultProtocol, bindingConfirmed: false };
    expect(selectAlibabaOperationProtocol('getProductInventory', request, available)).toBe('iop');
    expect(
      selectAlibabaOperationProtocol('getProductInventory', { ...request, source: 'sku' }, available)
    ).toBe('top');
    expect(
      selectAlibabaOperationProtocol('getProductInventory', { ...request, source: 'product' }, available)
    ).toBe('iop');
  });
  it('sends one validated IOP request with no TOP language or fallback', async () => {
    const call = vi.fn().mockResolvedValue({ data: data() });
    const adapter = new ProductInventoryAdapter(
      { call, protocol: 'iop' },
      validateCapabilityRequest,
      validateCapabilityResponse
    );
    const snapshot = await adapter.get(request);
    expect(snapshot.status).toBe('ready');
    expect(call).toHaveBeenCalledExactlyOnceWith('/alibaba/icbu/product/get/v2', {
      product_id: request.productId
    });
  });
});
