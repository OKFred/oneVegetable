import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildProductMaintenanceIntegrityFields as build,
  compareProductMaintenanceIntegrityFields as compare
} from '../src/product-maintenance-integrity';
import type { ProductMaintenanceIntegritySnapshot } from '../src/product-maintenance-integrity';

interface Fixture {
  orderedPrecisionTiers: { quantity: string; price: string }[];
  precisionSkuIds: string[];
  values: {
    changedInventory: string;
    selectedInventory: string;
    unrelatedInventory: string;
    otherProductId: string;
    normalizedWeight: string;
    normalizedSkuPrice: string;
    normalizedSpuPrice: string;
  };
  snapshot: ProductMaintenanceIntegritySnapshot;
  drafts: Record<string, unknown>;
  changes: [string, unknown, string][];
  changedPrice: ProductMaintenanceIntegritySnapshot['price'];
  rangePrice: ProductMaintenanceIntegritySnapshot['price'];
}
const fixture = JSON.parse(
  await readFile(new URL('../../../mock/data/product-maintenance-integrity.json', import.meta.url), 'utf8')
) as Fixture;
function snapshot(): ProductMaintenanceIntegritySnapshot {
  return structuredClone(fixture.snapshot);
}
function set(value: unknown, path: string, next: unknown): void {
  const parts = path.split('.');
  let current = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1) ?? ''] = next;
}
function remove(value: unknown, path: string): void {
  const parts = path.split('.');
  let current = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  Reflect.deleteProperty(current, parts.at(-1) ?? '');
}
const tiered = fixture.drafts.tiered;

describe('hash-only non-target integrity (synthetic data, no platform calls)', () => {
  it('returns stable prefixed hashes only and accepts a JSON-persisted mixed baseline', async () => {
    const original = snapshot();
    const serialized = JSON.stringify(original);
    const fields = await build(tiered, original);
    expect(Object.isFrozen(fields)).toBe(true);
    expect(Object.keys(fields).every((key) => /^integrity\/[A-Za-z]+$/u.test(key))).toBe(true);
    expect(Object.values(fields).every((value) => /^[a-f0-9]{64}$/u.test(value))).toBe(true);
    expect(fields).not.toHaveProperty('integrity/price');
    const stored = JSON.stringify(fields);
    for (const value of [
      original.title,
      original.modelNumber,
      original.descriptionHtml,
      original.productId,
      original.skus[0]?.id
    ]) {
      expect(stored).not.toContain(value);
    }
    const mixed: unknown = JSON.parse(
      JSON.stringify({ ...fields, 'price.currency': original.price.currency })
    );
    expect(await compare(mixed, tiered, snapshot())).toEqual({
      status: 'matched',
      mismatchedFields: [],
      unavailableFields: []
    });
    expect(JSON.stringify(original)).toBe(serialized);
    expect(await build(tiered, snapshot())).toEqual(fields);
  });

  it.each(fixture.changes)('detects protected %s without returning raw values', async (path, next, field) => {
    const fields = await build(tiered, snapshot());
    const changed = snapshot();
    set(changed, path, next);
    const result = await compare(fields, tiered, changed);
    expect(result.status).toBe('mismatched');
    expect(result.mismatchedFields).toContain('integrity/' + field);
    expect(result.unavailableFields).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(fixture.snapshot.productId);
    expect(JSON.stringify(result)).not.toContain(fixture.snapshot.modelNumber);
  });

  it.each(['status', 'auditStatus', 'createdTimestamp', 'modifiedTimestamp'])(
    'ignores normal %s changes and absence',
    async (key) => {
      const fields = await build(tiered, snapshot());
      const changed = snapshot();
      set(changed, key, null);
      expect((await compare(fields, tiered, changed)).status).toBe('matched');
      remove(changed, key);
      expect((await compare(fields, tiered, changed)).status).toBe('matched');
    }
  );

  it.each([
    'title',
    'modelNumber',
    'categoryId',
    'keywords',
    'images',
    'descriptionHtml',
    'inventory',
    'skus',
    'dimension',
    'price.currency'
  ])('does not equate missing/undefined %s to existing evidence', async (path) => {
    // Inventory scope protects SPU price as well as all mandatory metadata.
    const draft = fixture.drafts.skuInventory;
    const fields = await build(draft, snapshot());
    for (const missing of [true, false]) {
      const changed = snapshot();
      if (missing) remove(changed, path);
      else set(changed, path, undefined);
      const result = await compare(fields, draft, changed);
      expect(result.status).toBe('unavailable');
      expect(result.unavailableFields.length).toBeGreaterThan(0);
      await expect(build(draft, changed)).rejects.toThrow(
        'PRODUCT_MAINTENANCE_INTEGRITY_SNAPSHOT_UNAVAILABLE'
      );
    }
  });

  it.each(['tiered', 'range', 'skuPrice', 'spuInventory', 'skuInventory'])(
    'excludes only intended target values: %s',
    async (name) => {
      const draft = fixture.drafts[name];
      const fields = await build(draft, snapshot());
      const changed = snapshot();
      if (name === 'tiered') changed.price = fixture.changedPrice;
      if (name === 'range') changed.price = fixture.rangePrice;
      if (name === 'skuPrice') set(changed, 'skus.0.price', fixture.changedPrice.tiers[0]?.price);
      if (name === 'spuInventory') changed.inventory = fixture.values.changedInventory;
      if (name === 'skuInventory') set(changed, 'skus.0.inventory', fixture.values.selectedInventory);
      expect((await compare(fields, draft, changed)).status).toBe('matched');
    }
  );

  it.each(['skuPrice', 'spuInventory', 'skuInventory'])('protects SPU prices for %s', async (name) => {
    const fields = await build(fixture.drafts[name], snapshot());
    const changed = snapshot();
    changed.price = fixture.changedPrice;
    expect((await compare(fields, fixture.drafts[name], changed)).mismatchedFields).toContain(
      'integrity/price'
    );
  });

  it.each([
    ['skuPrice', 'price', 'skuPrices'],
    ['skuInventory', 'inventory', 'skuInventories']
  ])('protects unselected SKU values for %s', async (name, key, group) => {
    const fields = await build(fixture.drafts[name], snapshot());
    const changed = snapshot();
    set(changed, 'skus.1.' + key, fixture.values.unrelatedInventory);
    expect((await compare(fields, fixture.drafts[name], changed)).mismatchedFields).toContain(
      'integrity/' + group
    );
  });

  it('protects SPU inventory even when selected SKU inventory is targeted', async () => {
    const fields = await build(fixture.drafts.skuInventory, snapshot());
    const changed = snapshot();
    changed.inventory = fixture.values.unrelatedInventory;
    expect((await compare(fields, fixture.drafts.skuInventory, changed)).mismatchedFields).toContain(
      'integrity/inventory'
    );
  });

  it('canonicalizes SKU order and exact decimal spelling, not image order or business text', async () => {
    const fields = await build(fixture.drafts.spuInventory, snapshot());
    const changed = snapshot();
    changed.skus.reverse();
    changed.weight = fixture.values.normalizedWeight;
    set(changed, 'skus.0.price', fixture.values.normalizedSkuPrice);
    set(changed, 'price.tiers.0.price', fixture.values.normalizedSpuPrice);
    expect((await compare(fields, fixture.drafts.spuInventory, changed)).status).toBe('matched');
    changed.images = [...changed.images].reverse();
    expect((await compare(fields, fixture.drafts.spuInventory, changed)).mismatchedFields).toContain(
      'integrity/images'
    );
  });

  it('accepts unordered platform tiers and produces the same non-target price hash', async () => {
    const original = snapshot();
    const fields = await build(fixture.drafts.spuInventory, original);
    const reversed = snapshot();
    reversed.price.tiers.reverse();
    expect(await build(fixture.drafts.spuInventory, reversed)).toEqual(fields);
    expect((await compare(fields, fixture.drafts.spuInventory, reversed)).status).toBe('matched');
    expect(original.price.tiers).toEqual(fixture.snapshot.price.tiers);
  });

  it('sorts quantity canonically without losing precision above Number.MAX_SAFE_INTEGER', async () => {
    const original = snapshot();
    original.price.tiers = structuredClone(fixture.orderedPrecisionTiers);
    const shuffled = structuredClone(original);
    shuffled.price.tiers.reverse();
    const fields = await build(fixture.drafts.spuInventory, shuffled);
    const value = {
      type: original.price.type,
      currency: original.price.currency,
      min: original.price.min,
      max: original.price.max,
      tiers: fixture.orderedPrecisionTiers
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify(['product-maintenance-integrity-v1', 'price', value])
    );
    const expected = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(fields['integrity/price']).toBe(expected);
    expect((await compare(fields, fixture.drafts.spuInventory, original)).status).toBe('matched');
    expect(shuffled.price.tiers[0]?.quantity).toBe(fixture.orderedPrecisionTiers.at(-1)?.quantity);
  });

  it.each([0, 3])('rejects duplicate quantity at ordinary/large tier index %s', async (index) => {
    const changed = snapshot();
    changed.price.tiers = structuredClone(fixture.orderedPrecisionTiers);
    const repeated = changed.price.tiers[index];
    if (!repeated) throw new Error('Synthetic tier missing');
    changed.price.tiers.push({ ...repeated });
    await expect(build(fixture.drafts.spuInventory, changed)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID'
    );
    await expect(
      compare(await build(fixture.drafts.spuInventory, snapshot()), fixture.drafts.spuInventory, changed)
    ).rejects.toThrow('PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID');
  });

  it('keeps large SKU identities distinct and normalizes their platform row order', async () => {
    const original = snapshot();
    for (const [index, id] of fixture.precisionSkuIds.entries())
      set(original, 'skus.' + String(index) + '.id', id);
    const fields = await build(tiered, original);
    const reversed = structuredClone(original);
    reversed.skus.reverse();
    expect(await build(tiered, reversed)).toEqual(fields);
    expect((await compare(fields, tiered, reversed)).status).toBe('matched');
    set(reversed, 'skus.1.id', reversed.skus[0]?.id);
    await expect(build(tiered, reversed)).rejects.toThrow('PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID');
  });

  it('detects missing target SKU identity and refuses to build it', async () => {
    const fields = await build(fixture.drafts.skuPrice, snapshot());
    const changed = snapshot();
    changed.skus.shift();
    const result = await compare(fields, fixture.drafts.skuPrice, changed);
    expect(result.status).toBe('unavailable');
    expect(result.unavailableFields).toContain('integrity/skuIdentity');
    await expect(build(fixture.drafts.skuPrice, changed)).rejects.toThrow('SNAPSHOT_UNAVAILABLE');
  });

  it('supports an explicit empty SKU list for SPU scope, never an absent SKU list', async () => {
    const changed = snapshot();
    changed.skus = [];
    const fields = await build(tiered, changed);
    expect((await compare(fields, tiered, changed)).status).toBe('matched');
    remove(changed, 'skus');
    expect((await compare(fields, tiered, changed)).status).toBe('unavailable');
  });

  it('binds product identity and exact draft scope by hashes', async () => {
    const fields = await build(tiered, snapshot());
    const changed = snapshot();
    changed.productId = fixture.values.otherProductId;
    expect((await compare(fields, tiered, changed)).mismatchedFields).toContain('integrity/productId');
    await expect(build(tiered, changed)).rejects.toThrow('PRODUCT_MISMATCH');
    expect((await compare(fields, fixture.drafts.range, snapshot())).mismatchedFields).toContain(
      'integrity/scope'
    );
  });

  it('cannot certify a partial baseline and rejects corrupted or unknown integrity hashes', async () => {
    const fields = await build(tiered, snapshot());
    const partial = { ...fields };
    Reflect.deleteProperty(partial, 'integrity/modelNumber');
    expect((await compare(partial, tiered, snapshot())).unavailableFields).toEqual(['integrity/modelNumber']);
    for (const bad of [
      null,
      [],
      { ...fields, 'integrity/modelNumber': null },
      { ...fields, 'integrity/modelNumber': 'bad' },
      { ...fields, 'integrity/unknown': 'a'.repeat(64) }
    ]) {
      await expect(compare(bad, tiered, snapshot())).rejects.toThrow(
        'PRODUCT_MAINTENANCE_INTEGRITY_BASELINE_INVALID'
      );
    }
  });

  it.each([
    ['modelNumber', {}],
    ['inventory', '-1'],
    ['productId', 880123],
    ['productId', '9223372036854775808'],
    ['price.tiers.0.price', '1e2'],
    ['price.tiers.0.quantity', '0'],
    ['skus.0.inventory', '1.2'],
    ['skus.0.currency', 'currency'],
    ['skus.0.id', '0'],
    ['dimension.length', false],
    ['images', {}],
    ['attributes.0.unknown', 'value'],
    ['unknown', 'value']
  ])('fails closed with static errors on corrupt %s', async (path, bad) => {
    const changed = snapshot();
    set(changed, path, bad);
    await expect(build(tiered, changed)).rejects.toThrow('PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID');
    await expect(compare(await build(tiered, snapshot()), tiered, changed)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID'
    );
  });

  it('rejects duplicate IDs, holes, prototypes, accessors and cyclic input without invoking getters', async () => {
    const duplicate = snapshot();
    set(duplicate, 'skus.1.id', duplicate.skus[0]?.id);
    const sparse = snapshot();
    sparse.images = Array<string>(1);
    const proto: unknown = Object.create(fixture.snapshot);
    const cyclic = snapshot();
    set(cyclic, 'title', cyclic);
    let accessed = false;
    const accessor = snapshot();
    Object.defineProperty(accessor, 'title', {
      get: () => {
        accessed = true;
        return fixture.snapshot.title;
      },
      enumerable: true
    });
    for (const value of [duplicate, sparse, proto, cyclic, accessor]) {
      await expect(build(tiered, value)).rejects.toThrow('PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID');
    }
    expect(accessed).toBe(false);
  });

  it('rejects unsupported operations, unknown draft keys and malformed scope before evidence', async () => {
    for (const value of [
      null,
      {},
      { operation: 'deleteDraft' },
      { ...(tiered as object), unexpected: true }
    ]) {
      await expect(build(value, snapshot())).rejects.toThrow('PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID');
    }
  });

  it.each([
    'title',
    'modelNumber',
    'categoryId',
    'keywords',
    'descriptionHtml',
    'shippingTemplateId',
    'inventory',
    'weight',
    'dimension.length',
    'price.currency',
    'skus.0.code',
    'skus.0.price',
    'skus.1.inventory',
    'skus.0.attributes.0.imageUrl'
  ])('hashes observed null %s and protects both transition directions', async (path) => {
    const draft = fixture.drafts.skuInventory;
    const original = snapshot();
    const nullValue = snapshot();
    set(nullValue, path, null);
    const fields = await build(draft, nullValue);
    expect((await compare(fields, draft, nullValue)).status).toBe('matched');
    expect((await compare(fields, draft, original)).status).toBe('mismatched');
    expect((await compare(await build(draft, original), draft, nullValue)).status).toBe('mismatched');
    remove(nullValue, path);
    expect((await compare(fields, draft, nullValue)).status).toBe('unavailable');
  });

  it('accepts a read-empty legacy model/description/logistics baseline without persisting null text', async () => {
    const empty = snapshot();
    empty.modelNumber = null;
    empty.keywords = null;
    empty.descriptionHtml = null;
    empty.shippingTemplateId = null;
    empty.inventory = null;
    const fields = await build(tiered, empty);
    expect((await compare(fields, tiered, empty)).status).toBe('matched');
    expect(Object.values(fields).every((value) => /^[a-f0-9]{64}$/u.test(value))).toBe(true);
    empty.modelNumber = fixture.snapshot.modelNumber;
    expect((await compare(fields, tiered, empty)).mismatchedFields).toEqual(['integrity/modelNumber']);
  });

  it('distinguishes observed empty strings from null and absent metadata', async () => {
    const empty = snapshot();
    empty.modelNumber = '';
    const fields = await build(tiered, empty);
    expect((await compare(fields, tiered, empty)).status).toBe('matched');
    empty.modelNumber = null;
    expect((await compare(fields, tiered, empty)).mismatchedFields).toEqual(['integrity/modelNumber']);
  });

  it('reports both missing evidence and observed differences without collapsing either to equality', async () => {
    const fields = await build(tiered, snapshot());
    const changed = snapshot();
    remove(changed, 'modelNumber');
    changed.title = fixture.snapshot.keywords;
    expect(await compare(fields, tiered, changed)).toEqual({
      status: 'unavailable',
      mismatchedFields: ['integrity/title'],
      unavailableFields: ['integrity/modelNumber']
    });
  });
});
