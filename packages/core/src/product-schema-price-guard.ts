import { validateProductPriceDraft, type ProductPriceDraft } from './product-maintenance-api';
import type { ProductMaintenanceBaseline } from './product-maintenance-service';

export interface ProductSchemaPriceGuard {
  version: 1;
  draft: Omit<Extract<ProductPriceDraft, { mode: 'tiered' }>, 'tiers'> & {
    tiers: { quantity: string; price: string }[];
  };
  baseline: ProductMaintenanceBaseline;
  schemaFingerprint: string;
}

const protectedFields = [
  'productId',
  'scope',
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
  'inventory',
  'skuIdentity',
  'skuCodes',
  'skuAttributes',
  'skuCurrencies',
  'skuPrices',
  'skuInventories'
].map((key) => 'integrity/' + key);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function object(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === names.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === 'string' &&
        names.includes(key) &&
        descriptor?.enumerable &&
        Object.hasOwn(descriptor, 'value')
      );
    })
  );
}
export function isProductSchemaPriceDraft(value: unknown): value is ProductSchemaPriceGuard['draft'] {
  if (
    !object(value, ['operation', 'productId', 'mode', 'currency', 'tiers']) ||
    value.mode !== 'tiered' ||
    !Array.isArray(value.tiers)
  )
    return false;
  const rows: unknown[] = value.tiers;
  return (
    Object.getPrototypeOf(rows) === Array.prototype &&
    rows.length > 0 &&
    rows.length <= 10_000 &&
    Reflect.ownKeys(rows).length === rows.length + 1 &&
    Array.from({ length: rows.length }, (_, i) => Object.getOwnPropertyDescriptor(rows, String(i))).every(
      (descriptor) =>
        descriptor?.enumerable &&
        Object.hasOwn(descriptor, 'value') &&
        object(descriptor.value, ['quantity', 'price'])
    ) &&
    validateProductPriceDraft(value)
  );
}

/** Shape validation only; async entry points also verify the baseline digest and fresh evidence. */
export function isProductSchemaPriceGuard(value: unknown): value is ProductSchemaPriceGuard {
  try {
    if (
      !object(value, ['version', 'draft', 'baseline', 'schemaFingerprint']) ||
      value.version !== 1 ||
      !isProductSchemaPriceDraft(value.draft) ||
      !hash(value.schemaFingerprint) ||
      !object(value.baseline, ['productId', 'fields', 'fingerprint'])
    )
      return false;
    const baseline = value.baseline;
    const names = [
      'price/type',
      'price/currency',
      ...value.draft.tiers.map((row) => 'price/tiers/' + row.quantity),
      ...protectedFields
    ];
    if (
      baseline.productId !== value.draft.productId ||
      !hash(baseline.fingerprint) ||
      !object(baseline.fields, names)
    )
      return false;
    const fields = baseline.fields;
    return (
      fields['price/type'] === 'TIERED' &&
      fields['price/currency'] === 'USD' &&
      protectedFields.every((key) => hash(fields[key])) &&
      isProductSchemaPriceDraft({
        ...value.draft,
        tiers: value.draft.tiers.map((row) => ({
          quantity: row.quantity,
          price: fields['price/tiers/' + row.quantity]
        }))
      })
    );
  } catch {
    return false;
  }
}
