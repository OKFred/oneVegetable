import * as fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../mock/data/product-inventory-readback-diagnostic.json';
import { NativeFetchTransport } from '../../packages/core/src/network';
vi.mock('node:fs/promises', { spy: true });
import {
  assessAbsoluteInventoryEvidence,
  inventoryFieldEvidence,
  productInventoryEvidence,
  INVENTORY_DIAGNOSTIC_PATHS,
  type InventoryDiagnosticRow
} from '../diagnose-product-inventory-readonly';

const productId = fixture.productIds[0] ?? '';
const skuId = fixture.absoluteInventorySkus[0]?.sku_id ?? '';
const spu = { productId, scope: 'spu' };
const sku = { productId, scope: 'sku', skuId };
const unavailable = (reason: string) => ({ status: 'unavailable', reason });
function row(skus: unknown = fixture.absoluteInventorySkus): InventoryDiagnosticRow {
  const data = structuredClone(fixture.product);
  data.product_info.basic_info.product_id = productId;
  Reflect.set(data.product_info.trade_info, 'sku_info', skus);
  return {
    protocol: 'iop',
    productId,
    route: 'product',
    path: INVENTORY_DIAGNOSTIC_PATHS.product,
    requestId: 'synthetic-inventory-evidence',
    status: 'accepted',
    networkAttempts: 1,
    contractValid: true,
    businessSuccess: true,
    evidence: productInventoryEvidence(data, productId).evidence
  };
}
function freeze(value: object): void {
  for (const child of Object.values(value as Record<string, unknown>))
    if (typeof child === 'object' && child !== null) freeze(child);
  Object.freeze(value);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('absolute inventory evidence, synthetic metadata only', () => {
  for (const [scope, target] of [
    ['spu', spu],
    ['sku', sku]
  ] as const) {
    it.each(fixture.numericCases)(scope + ' quantity: $name', (sample) => {
      const owner =
        'missing' in sample && sample.missing
          ? {}
          : { inventory: 'value' in sample ? sample.value : undefined };
      const field = inventoryFieldEvidence(owner, 'inventory', true);
      const source = row();
      source.evidence.inventory = field;
      source.evidence.skuRows = [
        { skuId: inventoryFieldEvidence({ id: skuId }, 'id', true), inventory: field }
      ];
      source.evidence.skuInfo = { present: true, type: 'array', count: 1 };
      const expected =
        'integerString' in sample.expected
          ? { status: 'available', quantity: sample.expected.integerString }
          : unavailable('missing' in sample && sample.missing ? 'QUANTITY_MISSING' : 'QUANTITY_INVALID');
      expect(assessAbsoluteInventoryEvidence(target, source)).toEqual(expected);
    });
  }
  it.each([
    null,
    {},
    { productId },
    { productId, scope: 'warehouse' },
    { productId, scope: 'spu', skuId },
    { productId, scope: 'sku' },
    ...['', '0', '-1', '01', '1.5', '9223372036854775808', 123, null].map((id) => ({ ...sku, skuId: id })),
    ...['', '0', '-1', '01', '9007199254740992', '9223372036854775808', 123].map((id) => ({
      ...spu,
      productId: id
    }))
  ])('rejects invalid or ambiguous target %j without throwing', (target) => {
    expect(assessAbsoluteInventoryEvidence(target, row())).toEqual(unavailable('TARGET_INVALID'));
  });
  it.each(['online', 'offline'])('accepts approved %s product evidence', (code) => {
    const source = row();
    source.evidence.platformStatus = { present: true, type: 'string', code };
    expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual({ status: 'available', quantity: '0' });
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual({ status: 'available', quantity: '3' });
  });
  it('keeps SPU, target SKU, other SKU and warehouse/Schema quantities separate', () => {
    const source = row();
    source.evidence.inventory = inventoryFieldEvidence({}, 'inventory', true);
    source.evidence.rows = [{ inventory: inventoryFieldEvidence({ inventory: 99 }, 'inventory', true) }];
    source.evidence.inventoryFields = [{ values: [{ inventory: { integerString: '99' } }] }];
    expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(unavailable('QUANTITY_MISSING'));
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual({ status: 'available', quantity: '3' });
    const missingSku = row([{ sku_id: skuId }, fixture.absoluteInventorySkus[1]]);
    expect(assessAbsoluteInventoryEvidence(sku, missingSku)).toEqual(unavailable('QUANTITY_MISSING'));
    expect(assessAbsoluteInventoryEvidence(spu, missingSku)).toEqual({ status: 'available', quantity: '0' });
  });
  it('does not require an SKU list for SPU or a SPU quantity for SKU', () => {
    expect(assessAbsoluteInventoryEvidence(spu, row(null))).toEqual({ status: 'available', quantity: '0' });
    const source = row();
    delete source.evidence.inventory;
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual({ status: 'available', quantity: '3' });
  });
  it.each(['top', undefined])('does not infer IOP from a path for protocol %s', (protocol) => {
    const source = row();
    Reflect.set(source, 'protocol', protocol);
    expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(unavailable('SOURCE_NOT_APPLICABLE'));
  });
  it.each(['inventory', 'schema'] as const)('never uses the %s route as absolute evidence', (route) => {
    expect(
      assessAbsoluteInventoryEvidence(spu, { ...row(), route, path: INVENTORY_DIAGNOSTIC_PATHS[route] })
    ).toEqual(unavailable('SOURCE_NOT_APPLICABLE'));
  });
  it.each([
    '/icbu/product/get/v2',
    '/alibaba/icbu/product/get',
    '/rest/alibaba/icbu/product/get/v2',
    '/alibaba/icbu/product/get/v2/',
    '/alibaba/icbu/product/get/v2?product_id=1',
    '/alibaba/icbu/product/get/v2#fragment',
    INVENTORY_DIAGNOSTIC_PATHS.inventory
  ])('rejects nonexact get/v2 path %s', (path) => {
    expect(assessAbsoluteInventoryEvidence(spu, { ...row(), path })).toEqual(
      unavailable('SOURCE_PATH_MISMATCH')
    );
  });
  it.each(['', ' ', 'bad\nrequest', 'x'.repeat(101)])('rejects invalid request metadata %j', (requestId) => {
    expect(assessAbsoluteInventoryEvidence(spu, { ...row(), requestId })).toEqual(
      unavailable('REQUEST_INVALID')
    );
  });
  it.each(['contract-drift', 'business-rejected', 'failed', 'missing-prerequisite'] as const)(
    'requires accepted, not %s',
    (status) => {
      expect(assessAbsoluteInventoryEvidence(spu, { ...row(), status })).toEqual(
        unavailable('REQUEST_NOT_ACCEPTED')
      );
    }
  );
  it.each([false, undefined, null, 'true', 1])('requires literal contract/business true, not %j', (value) => {
    const source = row();
    Reflect.set(source, 'contractValid', value);
    expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(unavailable('CONTRACT_INVALID'));
    source.contractValid = true;
    Reflect.set(source, 'businessSuccess', value);
    expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(unavailable('BUSINESS_UNSUCCESSFUL'));
  });
  it('requires exact product ID in both request metadata and response metadata', () => {
    expect(assessAbsoluteInventoryEvidence(spu, { ...row(), productId: fixture.otherProductId })).toEqual(
      unavailable('PRODUCT_ID_MISMATCH')
    );
    for (const id of [fixture.otherProductId, null, 9007199254740992]) {
      const source = row();
      source.evidence.productId = inventoryFieldEvidence({ id }, 'id', true);
      expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(unavailable('PRODUCT_ID_MISMATCH'));
    }
  });
  it.each(['pending', 'rejected', 'APPROVED', '', undefined])('requires approved audit, not %s', (code) => {
    const source = row();
    source.evidence.auditStatus = { present: code !== undefined, type: 'string', code };
    expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(unavailable('AUDIT_NOT_APPROVED'));
  });
  it.each(['deleted', 'draft', 'pending', 'ONLINE', '', undefined])(
    'rejects unsupported platform status %s',
    (code) => {
      const source = row();
      source.evidence.platformStatus = { present: code !== undefined, type: 'string', code };
      expect(assessAbsoluteInventoryEvidence(spu, source)).toEqual(
        unavailable('PLATFORM_STATUS_UNSUPPORTED')
      );
    }
  );
  it.each([null, {}, ''])('requires a present SKU array, not %j', (list) => {
    expect(assessAbsoluteInventoryEvidence(sku, row(list))).toEqual(unavailable('SKU_LIST_INVALID'));
  });
  it('rejects missing SKU list metadata', () => {
    const source = row();
    delete source.evidence.skuInfo;
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual(unavailable('SKU_LIST_INVALID'));
  });
  it.each([-1, 0, 1, 3, 1.5, '2', undefined, 9007199254740992])(
    'rejects mismatched or invalid SKU count %s',
    (count) => {
      const source = row();
      source.evidence.skuInfo = { present: true, type: 'array', count };
      expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual(unavailable('SKU_LIST_INCOMPLETE'));
    }
  );
  it('rejects the actual 500-row metadata cap even when the target is retained', () => {
    const source = row(
      Array.from({ length: 501 }, (_, index) => ({ sku_id: String(990901 + index), inventory: '0' }))
    );
    expect(source.evidence.skuRows).toHaveLength(500);
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual(unavailable('SKU_LIST_INCOMPLETE'));
  });
  it.each([-1, '-1', 0, '0', '01', 'bad', null, 9007199254740992, '9223372036854775808'])(
    'rejects invalid SKU ID %s anywhere after the matched SKU',
    (id) => {
      expect(
        assessAbsoluteInventoryEvidence(
          sku,
          row([fixture.absoluteInventorySkus[0], { sku_id: id, inventory: '9' }])
        )
      ).toEqual(unavailable('SKU_ID_INVALID'));
    }
  );
  it('rejects duplicates even with mixed numeric/string IDs or after a match', () => {
    expect(
      assessAbsoluteInventoryEvidence(
        sku,
        row([fixture.absoluteInventorySkus[0], { sku_id: Number(skuId), inventory: '99' }])
      )
    ).toEqual(unavailable('SKU_ID_DUPLICATE'));
  });
  it('rejects missing, sparse or malformed SKU identity/list metadata', () => {
    expect(assessAbsoluteInventoryEvidence(sku, row([{}]))).toEqual(unavailable('SKU_ID_INVALID'));
    const source = row();
    source.evidence.skuRows = new Array(2);
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual(unavailable('SKU_ID_INVALID'));
    source.evidence.skuRows = {};
    expect(assessAbsoluteInventoryEvidence(sku, source)).toEqual(unavailable('SKU_LIST_INVALID'));
  });
  it('never replaces an empty list or absent target SKU with SPU zero', () => {
    expect(assessAbsoluteInventoryEvidence(sku, row([]))).toEqual(unavailable('SKU_NOT_FOUND'));
    expect(assessAbsoluteInventoryEvidence({ ...sku, skuId: '990999' }, row())).toEqual(
      unavailable('SKU_NOT_FOUND')
    );
  });
  it('preserves exact Long SKU identity and quantity strings', () => {
    const maximum = '9223372036854775807';
    expect(
      assessAbsoluteInventoryEvidence(
        { ...sku, skuId: maximum },
        row([{ sku_id: maximum, inventory: maximum }])
      )
    ).toEqual({ status: 'available', quantity: maximum });
  });
  it('accepts the existing exact product-ID boundary without widening it', () => {
    const source = row();
    source.productId = fixture.maximumExactId;
    source.evidence.productId = inventoryFieldEvidence({ id: fixture.maximumExactId }, 'id', true);
    expect(assessAbsoluteInventoryEvidence({ ...spu, productId: fixture.maximumExactId }, source)).toEqual({
      status: 'available',
      quantity: '0'
    });
  });
  it.each([
    { present: false, type: 'string', integerString: '0' },
    { present: true, type: 'number', safeInteger: false, integerString: '0' },
    { present: true, type: 'number', safeInteger: true, integerString: '9007199254740992' },
    { present: true, type: 'boolean', integerString: '0' },
    { present: true, type: 'string', integerString: '00' },
    { present: true, type: 'string', integerString: '9'.repeat(100) },
    { present: true, type: 'string', integerString: null }
  ])('does not trust inconsistent quantity metadata %j', (field) => {
    const source = row();
    source.evidence.inventory = field;
    expect(assessAbsoluteInventoryEvidence(spu, source).status).toBe('unavailable');
  });
  it('is deterministic with frozen input and makes no network, file or clock calls', () => {
    const source = row(),
      target = { ...sku };
    const before = JSON.stringify({ source, target });
    freeze(source);
    freeze(target);
    const unexpected = () => {
      throw new Error('Unexpected external call');
    };
    const fetch = vi.fn(unexpected);
    vi.stubGlobal('fetch', fetch);
    const send = vi.spyOn(NativeFetchTransport.prototype, 'send').mockImplementation(unexpected);
    const read = vi.spyOn(fs, 'readFile').mockImplementation(unexpected);
    const open = vi.spyOn(fs, 'open').mockImplementation(unexpected);
    const now = vi.spyOn(Date, 'now').mockImplementation(unexpected);
    expect(assessAbsoluteInventoryEvidence(target, source)).toEqual({ status: 'available', quantity: '3' });
    expect(assessAbsoluteInventoryEvidence(target, source)).toEqual({ status: 'available', quantity: '3' });
    expect(JSON.stringify({ source, target })).toBe(before);
    for (const spy of [fetch, send, read, open, now]) expect(spy).not.toHaveBeenCalled();
  });
});
