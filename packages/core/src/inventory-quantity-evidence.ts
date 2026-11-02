import { IOP_REFERENCE_METHODS } from './product-reference-methods';
type RecordValue = Record<string, unknown>;

export type AbsoluteInventoryEvidence =
  | { status: 'available'; quantity: string }
  | {
      status: 'unavailable';
      reason:
        | 'TARGET_INVALID'
        | 'SOURCE_NOT_APPLICABLE'
        | 'SOURCE_PATH_MISMATCH'
        | 'REQUEST_INVALID'
        | 'REQUEST_NOT_ACCEPTED'
        | 'CONTRACT_INVALID'
        | 'BUSINESS_UNSUCCESSFUL'
        | 'PRODUCT_ID_MISMATCH'
        | 'AUDIT_NOT_APPROVED'
        | 'PLATFORM_STATUS_UNSUPPORTED'
        | 'SKU_LIST_INVALID'
        | 'SKU_LIST_INCOMPLETE'
        | 'SKU_ID_INVALID'
        | 'SKU_ID_DUPLICATE'
        | 'SKU_NOT_FOUND'
        | 'QUANTITY_MISSING'
        | 'QUANTITY_INVALID';
    };
export interface AbsoluteInventoryEvidenceRow {
  protocol: 'top' | 'iop';
  productId: string;
  route: string;
  path: string;
  requestId: string;
  status: string;
  contractValid?: boolean;
  businessSuccess?: boolean | null;
  evidence: Record<string, unknown>;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function type(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
export function inventoryFieldEvidence(
  owner: unknown,
  key: string,
  numeric = false,
  signed = false
): RecordValue {
  const object = record(owner),
    present = Object.hasOwn(object, key),
    value = object[key];
  const evidence: RecordValue = { present, type: present ? type(value) : 'missing' };
  if (Array.isArray(value)) evidence.count = value.length;
  if (!numeric) return evidence;
  if (typeof value === 'number') evidence.safeInteger = Number.isSafeInteger(value);
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : null;
  if (
    text !== null &&
    text.length <= 20 &&
    (signed ? /^-?(0|[1-9][0-9]*)$/u : /^(0|[1-9][0-9]*)$/u).test(text)
  ) {
    const integer = BigInt(text);
    if (integer >= (signed ? -9223372036854775808n : 0n) && integer <= 9223372036854775807n)
      evidence.integerString = text;
  }
  return evidence;
}
function evidenceInteger(value: unknown): string | undefined {
  const field = record(value),
    text = field.integerString;
  if (
    field.present !== true ||
    (field.type !== 'string' && field.type !== 'number') ||
    (field.type === 'number' && field.safeInteger !== true) ||
    typeof text !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/u.test(text) ||
    BigInt(text) > 9223372036854775807n ||
    (field.type === 'number' && BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    return undefined;
  return text;
}
function positiveInventoryId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n
  );
}
/** Quantity evidence for one explicit scope only; never write, restore or task-verification authority. */
export function assessAbsoluteInventoryEvidence(
  target: unknown,
  row: Readonly<AbsoluteInventoryEvidenceRow>
): AbsoluteInventoryEvidence {
  const scope = record(target);
  const unavailable = (
    reason: Extract<AbsoluteInventoryEvidence, { status: 'unavailable' }>['reason']
  ): AbsoluteInventoryEvidence => ({ status: 'unavailable', reason });
  if (
    !positiveInventoryId(scope.productId) ||
    BigInt(scope.productId) > BigInt(Number.MAX_SAFE_INTEGER) ||
    (scope.scope !== 'spu' && scope.scope !== 'sku') ||
    (scope.scope === 'spu' ? Object.hasOwn(scope, 'skuId') : !positiveInventoryId(scope.skuId))
  )
    return unavailable('TARGET_INVALID');
  if (row.protocol !== 'iop' || row.route !== 'product') return unavailable('SOURCE_NOT_APPLICABLE');
  if (row.path !== IOP_REFERENCE_METHODS.getProduct) return unavailable('SOURCE_PATH_MISMATCH');
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/u.test(row.requestId))
    return unavailable('REQUEST_INVALID');
  if (row.status !== 'accepted') return unavailable('REQUEST_NOT_ACCEPTED');
  if (row.contractValid !== true) return unavailable('CONTRACT_INVALID');
  if (row.businessSuccess !== true) return unavailable('BUSINESS_UNSUCCESSFUL');
  const evidence = record(row.evidence);
  if (row.productId !== scope.productId || evidenceInteger(evidence.productId) !== scope.productId)
    return unavailable('PRODUCT_ID_MISMATCH');
  const audit = record(evidence.auditStatus),
    platform = record(evidence.platformStatus);
  if (audit.present !== true || audit.type !== 'string' || audit.code !== 'approved')
    return unavailable('AUDIT_NOT_APPROVED');
  if (
    platform.present !== true ||
    platform.type !== 'string' ||
    (platform.code !== 'online' && platform.code !== 'offline')
  )
    return unavailable('PLATFORM_STATUS_UNSUPPORTED');
  let quantityField = evidence.inventory;
  if (scope.scope === 'sku') {
    const list = record(evidence.skuInfo),
      rows = evidence.skuRows;
    if (list.present !== true || list.type !== 'array' || !Array.isArray(rows))
      return unavailable('SKU_LIST_INVALID');
    if (
      typeof list.count !== 'number' ||
      !Number.isSafeInteger(list.count) ||
      list.count < 0 ||
      list.count !== rows.length
    )
      return unavailable('SKU_LIST_INCOMPLETE');
    const ids = new Set<string>();
    let found = false;
    for (const item of rows) {
      const sku = record(item),
        id = evidenceInteger(sku.skuId);
      if (!positiveInventoryId(id)) return unavailable('SKU_ID_INVALID');
      if (ids.has(id)) return unavailable('SKU_ID_DUPLICATE');
      ids.add(id);
      if (id === scope.skuId) {
        found = true;
        quantityField = sku.inventory;
      }
    }
    if (!found) return unavailable('SKU_NOT_FOUND');
  }
  const quantity = evidenceInteger(quantityField);
  if (quantity === undefined)
    return unavailable(
      record(quantityField).present === false || quantityField === undefined
        ? 'QUANTITY_MISSING'
        : 'QUANTITY_INVALID'
    );
  return { status: 'available', quantity };
}
