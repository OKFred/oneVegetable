import { canonicalizeProductMaintenanceDraft } from './product-maintenance-api';
import type { ProductInventoryDraft, ProductPriceDraft } from './product-maintenance-api';
import type { ProductReference } from './product-reference';

/** Local-only TOP/IOP-neutral integrity evidence. No authorization, platform calls or mutation. */
export type ProductMaintenanceIntegritySnapshot = Omit<ProductReference, 'images'> & {
  images: readonly string[];
};
export type ProductMaintenanceIntegrityFields = Readonly<Record<string, string>>;
export interface ProductMaintenanceIntegrityComparison {
  status: 'matched' | 'mismatched' | 'unavailable';
  mismatchedFields: string[];
  unavailableFields: string[];
}

const PREFIX = 'integrity/';
const INVALID = 'PRODUCT_MAINTENANCE_INTEGRITY_INPUT_INVALID';
const ABSENT = Symbol('unavailable');
const stable = [
  'title',
  'modelNumber',
  'categoryId',
  'keywords',
  'images',
  'descriptionHtml',
  'language',
  'categoryPath',
  'attributes',
  'shippingTemplateId',
  'weight',
  'dimension',
  'leadTimes',
  'moq',
  'unit',
  'price',
  'inventory',
  'skuIdentity',
  'skuCodes',
  'skuAttributes',
  'skuCurrencies',
  'skuPrices',
  'skuInventories'
] as const;
const ignored = ['status', 'auditStatus', 'createdTimestamp', 'modifiedTimestamp'] as const;
type ObjectValue = Record<string, unknown>;
type Draft = ProductPriceDraft | ProductInventoryDraft;
type Projection = Record<string, unknown>;
function fail(code = INVALID): never {
  throw new Error(code);
}

/** Reject accessors, non-JSON values, prototypes, cycles, sparse arrays and unbounded input without logging it. */
function safeJson(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 16) return fail();
  if (value === undefined || value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (value.length > 2_000_000) return fail();
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail();
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) return fail();
  const proto: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    return fail();
  const names = Reflect.ownKeys(value);
  if (names.length > 10_001) return fail();
  if (
    Array.isArray(value) &&
    (names.length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, i) => i).some((i) => !Object.hasOwn(value, i)))
  )
    return fail();
  seen.add(value);
  for (const name of names) {
    if (typeof name !== 'string') return fail();
    if (Array.isArray(value) && name === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail();
    safeJson(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}
function object(value: unknown, allowed: readonly string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const out = value as ObjectValue;
  if (Object.keys(out).some((key) => !allowed.includes(key))) return fail();
  return out;
}
function text(value: unknown): string | null | typeof ABSENT {
  if (value === undefined) return ABSENT;
  if (value === null) return null;
  if (typeof value !== 'string') return fail();
  return value;
}
function id(value: unknown): string | null | typeof ABSENT {
  const out = text(value);
  if (out === ABSENT || out === null) return out;
  if (!/^[1-9][0-9]{0,18}$/u.test(out) || BigInt(out) > 9223372036854775807n) return fail();
  return out;
}
function decimal(value: unknown, integer = false): string | null | typeof ABSENT {
  const out = text(value);
  if (out === ABSENT || out === null) return out;
  if (!(integer ? /^(0|[1-9][0-9]*)$/u : /^[0-9]+(?:\.[0-9]+)?$/u).test(out)) return fail();
  if (integer) {
    if (out.length > 19 || BigInt(out) > 9223372036854775807n) return fail();
    return out;
  }
  if (out.length > 200) return fail();
  const [whole = '', fraction = ''] = out.split('.');
  const normalized = whole.replace(/^0+(?=[0-9])/u, '');
  const tail = fraction.replace(/0+$/u, '');
  return tail ? normalized + '.' + tail : normalized;
}
function array(value: unknown): unknown[] | null | typeof ABSENT {
  if (value === undefined) return ABSENT;
  if (value === null) return null;
  if (!Array.isArray(value)) return fail();
  return value as unknown[];
}
function mapArray(value: unknown, map: (row: unknown) => unknown): unknown {
  const rows = array(value);
  if (rows === ABSENT || rows === null) return rows;
  const out = rows.map(map);
  return out.some(hasAbsent) ? ABSENT : out;
}
function hasAbsent(value: unknown): boolean {
  if (value === ABSENT) return true;
  if (Array.isArray(value)) return value.some(hasAbsent);
  return value !== null && typeof value === 'object' && Object.values(value).some(hasAbsent);
}
function namedValues(value: unknown, image = false): unknown {
  return mapArray(value, (row) => {
    const item = object(row, image ? ['name', 'value', 'imageUrl'] : ['name', 'value']);
    return image
      ? { name: text(item.name), value: text(item.value), imageUrl: text(item.imageUrl) }
      : { name: text(item.name), value: text(item.value) };
  });
}
function price(value: unknown): unknown {
  if (value === undefined) return ABSENT;
  if (value === null) return null;
  const row = object(value, ['type', 'currency', 'min', 'max', 'tiers']);
  const type = text(row.type),
    currency = text(row.currency);
  if (typeof type === 'string' && type !== 'TIERED' && type !== 'RANGE') return fail();
  if (typeof currency === 'string' && !/^[A-Z]{3}$/u.test(currency)) return fail();
  const min = decimal(row.min),
    max = decimal(row.max);
  const tiers = mapArray(row.tiers, (value) => {
    const tier = object(value, ['quantity', 'price']);
    const quantity = decimal(tier.quantity, true);
    if (quantity === '0') return fail();
    return { quantity, price: decimal(tier.price) };
  });
  if (type === 'TIERED' && min !== ABSENT && max !== ABSENT && (min !== null || max !== null)) return fail();
  if (Array.isArray(tiers)) {
    const rows = tiers as { quantity: string | null; price: string | null }[];
    // The platform does not promise readback order. Sort exact integers, never Number/float.
    if (new Set(rows.map((row) => row.quantity)).size !== rows.length) return fail();
    rows.sort((a, b) => {
      if (a.quantity === b.quantity) return 0;
      if (a.quantity === null) return -1;
      if (b.quantity === null) return 1;
      return BigInt(a.quantity) < BigInt(b.quantity) ? -1 : 1;
    });
    if (type === 'RANGE' && tiers.length) return fail();
  }
  if (typeof min === 'string' && typeof max === 'string') {
    const [a = '', af = ''] = min.split('.'),
      [b = '', bf = ''] = max.split('.');
    const scale = Math.max(af.length, bf.length);
    if (BigInt(a + af.padEnd(scale, '0')) > BigInt(b + bf.padEnd(scale, '0'))) return fail();
  }
  return { type, currency, min, max, tiers };
}
function draft(value: unknown): { value: Draft; canonical: string; selected: Set<string> } {
  safeJson(value);
  let canonical: string;
  try {
    canonical = canonicalizeProductMaintenanceDraft(value);
  } catch {
    return fail();
  }
  const parsed = JSON.parse(canonical) as Draft;
  if (!['setPrice', 'setInventory'].includes(parsed.operation)) return fail();
  return {
    value: parsed,
    canonical,
    selected: new Set(parsed.mode === 'sku' ? parsed.skus.map((row) => row.skuId) : [])
  };
}
function projection(snapshot: unknown, scope: ReturnType<typeof draft>): Projection {
  safeJson(snapshot);
  const row = object(snapshot, [
    'productId',
    ...stable.filter((key) => !key.startsWith('sku')),
    'skus',
    ...ignored
  ]);
  for (const key of ignored) if (Object.hasOwn(row, key)) text(row[key]);
  const out: Projection = {
    productId: id(row.productId),
    scope: scope.canonical,
    title: text(row.title),
    modelNumber: text(row.modelNumber),
    categoryId: id(row.categoryId),
    keywords: text(row.keywords),
    images: mapArray(row.images, text),
    descriptionHtml: text(row.descriptionHtml),
    language: text(row.language),
    categoryPath: text(row.categoryPath),
    attributes: namedValues(row.attributes),
    shippingTemplateId: id(row.shippingTemplateId),
    weight: decimal(row.weight),
    moq: decimal(row.moq, true),
    unit: text(row.unit),
    dimension:
      row.dimension === undefined || row.dimension === null
        ? row.dimension === null
          ? null
          : ABSENT
        : (() => {
            const item = object(row.dimension, ['length', 'width', 'height']);
            return { length: decimal(item.length), width: decimal(item.width), height: decimal(item.height) };
          })(),
    leadTimes: mapArray(row.leadTimes, (value) => {
      const item = object(value, ['quantity', 'days']);
      return { quantity: decimal(item.quantity, true), days: decimal(item.days, true) };
    }),
    price: price(row.price),
    inventory: decimal(row.inventory, true)
  };
  const input = array(row.skus);
  if (input === ABSENT || input === null) {
    for (const key of stable.filter((key) => key.startsWith('sku'))) out[key] = ABSENT;
  } else {
    const rows = input.map((value) => {
      const item = object(value, ['id', 'code', 'price', 'currency', 'inventory', 'attributes']);
      return {
        id: id(item.id),
        code: text(item.code),
        price: decimal(item.price),
        currency: text(item.currency),
        inventory: decimal(item.inventory, true),
        attributes: namedValues(item.attributes, true)
      };
    });
    if (rows.some((item) => typeof item.currency === 'string' && !/^[A-Z]{3}$/u.test(item.currency)))
      return fail();
    const ids = rows.map((item) => item.id);
    if (ids.some((value) => value === ABSENT || value === null)) {
      for (const key of stable.filter((key) => key.startsWith('sku'))) out[key] = ABSENT;
    } else {
      if (new Set(ids).size !== ids.length) return fail();
      rows.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
      out.skuIdentity = rows.map((item) => item.id);
      out.skuCodes = rows.map((item) => [item.id, item.code]);
      out.skuAttributes = rows.map((item) => [item.id, item.attributes]);
      out.skuCurrencies = rows.map((item) => [item.id, item.currency]);
      out.skuPrices = rows
        .filter(
          (item) =>
            !(
              scope.value.operation === 'setPrice' &&
              scope.value.mode === 'sku' &&
              scope.selected.has(String(item.id))
            )
        )
        .map((item) => [item.id, item.price]);
      out.skuInventories = rows
        .filter(
          (item) =>
            !(
              scope.value.operation === 'setInventory' &&
              scope.value.mode === 'sku' &&
              scope.selected.has(String(item.id))
            )
        )
        .map((item) => [item.id, item.inventory]);
      if ([...scope.selected].some((selected) => !ids.includes(selected))) out.skuIdentity = ABSENT;
    }
  }
  if (scope.value.operation === 'setPrice' && scope.value.mode !== 'sku') delete out.price;
  if (scope.value.operation === 'setInventory' && scope.value.mode === 'spu') delete out.inventory;
  return out;
}
async function hash(key: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(['product-maintenance-integrity-v1', key, value]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
/**
 * Merge these hashes into baseline.fields; the parent hashes the complete field map.
 * Explicit null is observed empty data and is hashed; absent keys/undefined cannot establish equality.
 * images must be supplied explicitly from complete metadata, never inferred from HTML or absence.
 * No account binding, tamper authentication, causation proof or write permission is supplied by hashes.
 */
export async function buildProductMaintenanceIntegrityFields(
  draftValue: unknown,
  snapshot: unknown
): Promise<ProductMaintenanceIntegrityFields> {
  const scope = draft(draftValue);
  const values = projection(snapshot, scope);
  if (values.productId !== scope.value.productId)
    return fail('PRODUCT_MAINTENANCE_INTEGRITY_PRODUCT_MISMATCH');
  if (Object.values(values).some(hasAbsent))
    return fail('PRODUCT_MAINTENANCE_INTEGRITY_SNAPSHOT_UNAVAILABLE');
  const fields: Record<string, string> = {};
  for (const key of Object.keys(values).sort()) fields[PREFIX + key] = await hash(key, values[key]);
  return Object.freeze(fields);
}
/** Use the same original draft scope. Mixed baseline fields are accepted; every integrity key must be complete and known. */
export async function compareProductMaintenanceIntegrityFields(
  expectedFields: unknown,
  draftValue: unknown,
  snapshot: unknown
): Promise<ProductMaintenanceIntegrityComparison> {
  const scope = draft(draftValue);
  const values = projection(snapshot, scope);
  safeJson(expectedFields);
  if (!expectedFields || typeof expectedFields !== 'object' || Array.isArray(expectedFields))
    return fail('PRODUCT_MAINTENANCE_INTEGRITY_BASELINE_INVALID');
  const expected = expectedFields as ObjectValue;
  const paths = Object.keys(values)
    .sort()
    .map((key) => PREFIX + key);
  if (
    Object.entries(expected).some(
      ([key, value]) =>
        typeof value !== 'string' ||
        (key.startsWith(PREFIX) && (!paths.includes(key) || !/^[a-f0-9]{64}$/u.test(value)))
    )
  )
    return fail('PRODUCT_MAINTENANCE_INTEGRITY_BASELINE_INVALID');
  const mismatchedFields: string[] = [],
    unavailableFields: string[] = [];
  for (const path of paths) {
    const key = path.slice(PREFIX.length);
    if (!Object.hasOwn(expected, path) || hasAbsent(values[key])) unavailableFields.push(path);
    else if (expected[path] !== (await hash(key, values[key]))) mismatchedFields.push(path);
  }
  return {
    status: unavailableFields.length ? 'unavailable' : mismatchedFields.length ? 'mismatched' : 'matched',
    mismatchedFields,
    unavailableFields
  };
}
