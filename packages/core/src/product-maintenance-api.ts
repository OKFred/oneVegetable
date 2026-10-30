import type { AlibabaClient } from './alibaba-client';
import type { ProductReference } from './product-reference';

import { PRODUCT_MAINTENANCE_METHODS } from './product-workbench-methods';
export { PRODUCT_MAINTENANCE_METHODS } from './product-workbench-methods';

export type ProductMaintenanceOperation = keyof typeof PRODUCT_MAINTENANCE_METHODS;
export type ProductPriceDraft = { operation: 'setPrice'; productId: string } & (
  | { mode: 'tiered'; currency: 'USD'; tiers: readonly { quantity: string; price: string }[] }
  | { mode: 'range'; currency: 'USD'; minPrice: string; maxPrice: string }
  | { mode: 'sku'; currency: string; skus: readonly { skuId: string; price: string }[] }
);
export type ProductInventoryDraft = { operation: 'setInventory'; productId: string } & (
  { mode: 'spu'; inventory: string } | { mode: 'sku'; skus: readonly { skuId: string; inventory: string }[] }
);
/** Only account-scoped draft-list/create evidence; never derive this from a formal product. */
export interface KnownProductDraft {
  kind: 'draft';
  draftId: string;
  source: 'draft-list' | 'draft-create';
}
export interface ProductDraftDeleteDraft {
  operation: 'deleteDraft';
  draftIds: readonly string[];
  knownDrafts: readonly KnownProductDraft[];
  allowBatch?: true;
}
export type ProductMaintenanceDraft = ProductPriceDraft | ProductInventoryDraft | ProductDraftDeleteDraft;
export interface ProductMaintenanceRequest {
  operation: ProductMaintenanceOperation;
  protocol: 'iop';
  method: (typeof PRODUCT_MAINTENANCE_METHODS)[ProductMaintenanceOperation];
  parameters: Readonly<Record<string, unknown>>;
}
export interface ProductMaintenanceIntent extends ProductMaintenanceRequest {
  version: 1;
  draft: ProductMaintenanceDraft;
  fingerprint: string;
}
export interface ProductMaintenanceResult {
  operation: ProductMaintenanceOperation;
  protocol: 'iop';
  status: 'accepted' | 'rejected' | 'partial' | 'ambiguous';
  reason: 'explicit-success' | 'explicit-rejection' | 'incomplete-evidence' | 'unknown-outcome';
  readbackRequired: true;
  /** Sanitized stable provider/gateway atoms only; never raw messages or request parameters. */
  errorCode?: string;
  subCode?: string;
  traceId?: string;
  items?: readonly {
    draftId: string;
    status: 'reported-deleted' | 'rejected' | 'ambiguous';
  }[];
}
export type ProductMaintenanceSnapshot = Pick<
  ProductReference,
  'productId' | 'price' | 'inventory' | 'skus'
> &
  Partial<Pick<ProductReference, 'status' | 'auditStatus'>>;
export interface ProductMaintenanceReadback {
  status: 'matched' | 'mismatched' | 'unavailable';
  mismatchedFields: string[];
  unavailableFields: string[];
}
export interface ProductMaintenancePermit {
  protocol: 'iop';
  persistedIntentId: string;
  fingerprint: string;
  /** Required for SKU prices: the current account-scoped get/v2 snapshot, not a guessed currency. */
  reference?: ProductMaintenanceSnapshot;
}
export interface ProductMaintenanceCoordinator {
  /**
   * Atomically persist/claim before sendOnce; bind actual operation, account, credential profile,
   * permissions and fingerprint. Never replay a sent/unknown intent. Persist the result afterwards.
   * A fingerprint is not an idempotency key supplied to Alibaba.
   */
  run(
    intent: ProductMaintenanceIntent,
    sendOnce: (permit: ProductMaintenancePermit) => Promise<ProductMaintenanceResult>
  ): Promise<ProductMaintenanceResult>;
}

const LONG_MAX = 9223372036854775807n;
function invalid(code = 'PRODUCT_MAINTENANCE_INPUT_INVALID'): never {
  // Static codes only: do not copy payloads, provider messages or credentials into errors.
  throw new Error(code);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const item = record(value);
  if (
    !item ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(item) as object | null) ||
    Object.keys(item).some((key) => !allowed.includes(key))
  )
    return invalid();
  return item;
}
function integer(value: unknown, positive = false): string {
  if (
    typeof value !== 'string' ||
    value.length > 19 ||
    !/^(0|[1-9][0-9]*)$/u.test(value) ||
    BigInt(value) > LONG_MAX ||
    (positive && value === '0')
  )
    return invalid();
  return value;
}
function decimal(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value))
    return invalid();
  return value;
}
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/u.test(value)) return invalid();
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0) return invalid();
  return value as unknown[];
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}
function normalizedDecimal(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value)) return null;
  return value.includes('.') ? value.replace(/0+$/u, '').replace(/\.$/u, '') : value;
}
/** Exact comparison: never convert decimal prices to Number. */
function compareDecimal(left: string, right: string): number {
  const [li = '', lf = ''] = (normalizedDecimal(left) ?? invalid()).split('.');
  const [ri = '', rf = ''] = (normalizedDecimal(right) ?? invalid()).split('.');
  if (li.length !== ri.length) return li.length < ri.length ? -1 : 1;
  if (li !== ri) return li < ri ? -1 : 1;
  const width = Math.max(lf.length, rf.length);
  return lf.padEnd(width, '0') === rf.padEnd(width, '0')
    ? 0
    : lf.padEnd(width, '0') < rf.padEnd(width, '0')
      ? -1
      : 1;
}
function priceDraft(value: unknown): ProductPriceDraft {
  const header = record(value);
  if (header?.operation !== 'setPrice') return invalid();
  const common = ['operation', 'productId', 'mode', 'currency'];
  if (header.mode === 'tiered') {
    const input = object(value, [...common, 'tiers']);
    const tiers = list(input.tiers).map((item) => {
      const row = object(item, ['quantity', 'price']);
      return { quantity: integer(row.quantity, true), price: decimal(row.price) };
    });
    if (tiers.some((tier, i) => i > 0 && BigInt(tier.quantity) <= BigInt(tiers[i - 1]?.quantity ?? '0')))
      return invalid();
    if (input.currency !== 'USD') return invalid();
    return {
      operation: 'setPrice',
      productId: integer(input.productId, true),
      mode: 'tiered',
      currency: 'USD',
      tiers
    };
  }
  if (header.mode === 'range') {
    const input = object(value, [...common, 'minPrice', 'maxPrice']);
    const minPrice = decimal(input.minPrice);
    const maxPrice = decimal(input.maxPrice);
    if (input.currency !== 'USD' || compareDecimal(minPrice, maxPrice) > 0) return invalid();
    return {
      operation: 'setPrice',
      productId: integer(input.productId, true),
      mode: 'range',
      currency: 'USD',
      minPrice,
      maxPrice
    };
  }
  if (header.mode === 'sku') {
    const input = object(value, [...common, 'skus']);
    const skus = list(input.skus).map((item) => {
      const row = object(item, ['skuId', 'price']);
      return { skuId: integer(row.skuId, true), price: decimal(row.price) };
    });
    unique(skus.map((row) => row.skuId));
    return {
      operation: 'setPrice',
      productId: integer(input.productId, true),
      mode: 'sku',
      currency: currency(input.currency),
      skus
    };
  }
  return invalid();
}
function inventoryDraft(value: unknown): ProductInventoryDraft {
  const header = record(value);
  if (header?.operation !== 'setInventory') return invalid();
  const common = ['operation', 'productId', 'mode'];
  if (header.mode === 'spu') {
    const input = object(value, [...common, 'inventory']);
    return {
      operation: 'setInventory',
      productId: integer(input.productId, true),
      mode: 'spu',
      inventory: integer(input.inventory)
    };
  }
  if (header.mode === 'sku') {
    const input = object(value, [...common, 'skus']);
    const skus = list(input.skus).map((item) => {
      const row = object(item, ['skuId', 'inventory']);
      return { skuId: integer(row.skuId, true), inventory: integer(row.inventory) };
    });
    unique(skus.map((row) => row.skuId));
    return { operation: 'setInventory', productId: integer(input.productId, true), mode: 'sku', skus };
  }
  return invalid();
}
function deleteDraft(value: unknown): ProductDraftDeleteDraft {
  const input = object(value, ['operation', 'draftIds', 'knownDrafts', 'allowBatch']);
  if (input.operation !== 'deleteDraft' || (input.allowBatch !== undefined && input.allowBatch !== true))
    return invalid();
  const draftIds = list(input.draftIds).map((id) => integer(id, true));
  unique(draftIds);
  if (draftIds.length > 1 && input.allowBatch !== true) return invalid();
  const knownDrafts = list(input.knownDrafts).map((item): KnownProductDraft => {
    const row = object(item, ['kind', 'draftId', 'source']);
    if (row.kind !== 'draft' || (row.source !== 'draft-list' && row.source !== 'draft-create'))
      return invalid();
    return { kind: 'draft' as const, draftId: integer(row.draftId, true), source: row.source };
  });
  unique(knownDrafts.map((row) => row.draftId));
  if (draftIds.some((id) => !knownDrafts.some((row) => row.draftId === id))) return invalid();
  return {
    operation: 'deleteDraft',
    draftIds,
    knownDrafts: knownDrafts.filter((row) => draftIds.includes(row.draftId)),
    ...(input.allowBatch === true ? { allowBatch: true as const } : {})
  };
}
export function validateProductPriceDraft(value: unknown): value is ProductPriceDraft {
  try {
    priceDraft(value);
    return true;
  } catch {
    return false;
  }
}
export function validateProductInventoryDraft(value: unknown): value is ProductInventoryDraft {
  try {
    inventoryDraft(value);
    return true;
  } catch {
    return false;
  }
}
export function validateProductDraftDeleteDraft(value: unknown): value is ProductDraftDeleteDraft {
  try {
    deleteDraft(value);
    return true;
  } catch {
    return false;
  }
}
function request(
  operation: ProductMaintenanceOperation,
  parameters: Record<string, unknown>
): ProductMaintenanceRequest {
  return { operation, protocol: 'iop', method: PRODUCT_MAINTENANCE_METHODS[operation], parameters };
}
export function buildProductPriceRequest(value: unknown): ProductMaintenanceRequest {
  const draft = priceDraft(value);
  return request('setPrice', {
    product_id: draft.productId,
    ...(draft.mode === 'sku'
      ? { sku_price: draft.skus.map((row) => ({ sku_id: row.skuId, price: row.price })) }
      : {
          price: {
            price_type: draft.mode === 'tiered' ? 'TIERED' : 'RANGE',
            currency: draft.currency,
            ...(draft.mode === 'tiered'
              ? { tiered_price: draft.tiers.map((row) => ({ quantity: row.quantity, price: row.price })) }
              : { range_price: { min_price: draft.minPrice, max_price: draft.maxPrice } })
          }
        })
  });
}
export function buildProductInventoryRequest(value: unknown): ProductMaintenanceRequest {
  const draft = inventoryDraft(value);
  return request('setInventory', {
    product_id: draft.productId,
    ...(draft.mode === 'spu'
      ? { inventory: draft.inventory }
      : { sku_inventory: draft.skus.map((row) => ({ sku_id: row.skuId, inventory: row.inventory })) })
  });
}
export function buildProductDraftDeleteRequest(value: unknown): ProductMaintenanceRequest {
  return request('deleteDraft', { product_id_list: [...deleteDraft(value).draftIds] });
}
function parseDraft(value: unknown): ProductMaintenanceDraft {
  const operation = record(value)?.operation;
  if (operation === 'setPrice') return priceDraft(value);
  if (operation === 'setInventory') return inventoryDraft(value);
  if (operation === 'deleteDraft') return deleteDraft(value);
  return invalid();
}
function buildRequest(draft: ProductMaintenanceDraft): ProductMaintenanceRequest {
  if (draft.operation === 'setPrice') return buildProductPriceRequest(draft);
  if (draft.operation === 'setInventory') return buildProductInventoryRequest(draft);
  return buildProductDraftDeleteRequest(draft);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + (value as unknown[]).map(canonical).join(',') + ']';
  const item = record(value);
  if (item)
    return (
      '{' +
      Object.keys(item)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(item[key]))
        .join(',') +
      '}'
    );
  const encoded: unknown = JSON.stringify(value);
  return typeof encoded === 'string' ? encoded : invalid();
}
export function canonicalizeProductMaintenanceDraft(value: unknown): string {
  return canonical(parseDraft(value));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => {
      freeze(item);
    });
    Object.freeze(value);
  }
  return value;
}
export async function createProductMaintenanceIntent(value: unknown): Promise<ProductMaintenanceIntent> {
  const draft = parseDraft(value);
  const base = { version: 1 as const, ...buildRequest(draft), draft };
  const bytes = new TextEncoder().encode(canonical(base));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const fingerprint = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return freeze({ ...base, fingerprint });
}
function bool(value: unknown): boolean | null {
  return value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
}
function result(
  operation: ProductMaintenanceOperation,
  status: ProductMaintenanceResult['status'],
  reason: ProductMaintenanceResult['reason']
): ProductMaintenanceResult {
  return { operation, protocol: 'iop', status, reason, readbackRequired: true };
}
type ProductMaintenanceDiagnostics = Pick<ProductMaintenanceResult, 'errorCode' | 'subCode' | 'traceId'>;
function diagnosticCode(value: unknown): string | undefined {
  const code = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : value;
  return typeof code === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u.test(code) && !noErrorCode(code)
    ? code
    : undefined;
}
function diagnosticTrace(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value) && !noErrorCode(value)
    ? value
    : undefined;
}
/** Strict optional scalar metadata only. Never trim/truncate or inspect messages, bodies, parameters or causes. */
export function validateProductMaintenanceDiagnostics(value: unknown): boolean {
  const item = record(value);
  if (!item) return false;
  return (
    (!Object.hasOwn(item, 'errorCode') ||
      (typeof item.errorCode === 'string' && diagnosticCode(item.errorCode) !== undefined)) &&
    (!Object.hasOwn(item, 'subCode') ||
      (typeof item.subCode === 'string' && diagnosticCode(item.subCode) !== undefined)) &&
    (!Object.hasOwn(item, 'traceId') || diagnosticTrace(item.traceId) !== undefined)
  );
}
function diagnostics(errorCode: unknown, subCode: unknown, traceId: unknown): ProductMaintenanceDiagnostics {
  const code = diagnosticCode(errorCode);
  const sub = diagnosticCode(subCode);
  const trace = diagnosticTrace(traceId);
  return {
    ...(code ? { errorCode: code } : {}),
    ...(sub ? { subCode: sub } : {}),
    ...(trace ? { traceId: trace } : {})
  };
}
function firstCode(values: readonly unknown[]): string | undefined {
  return values.map(diagnosticCode).find((value) => value !== undefined);
}
function firstTrace(values: readonly unknown[]): string | undefined {
  return values.map(diagnosticTrace).find((value) => value !== undefined);
}
function responseDiagnostics(root: Record<string, unknown> | null): ProductMaintenanceDiagnostics {
  const business = record(root?.result);
  const provider = record(root?.error_response);
  return diagnostics(
    firstCode([provider?.code, business?.msg_code, root?.msg_code, root?.code]),
    firstCode([provider?.sub_code, business?.sub_code, root?.sub_code]),
    firstTrace([root?.request_id, business?.trace_id, provider?.request_id, root?.trace_id])
  );
}
function errorDiagnostics(error: unknown): ProductMaintenanceDiagnostics {
  const item = record(record(error)?.gatewayError) ?? record(error);
  return diagnostics(
    item?.code,
    item?.subCode ?? item?.sub_code,
    item?.traceId ?? item?.trace_id ?? item?.request_id
  );
}

function responseId(value: unknown): string | null {
  try {
    return integer(typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value, true);
  } catch {
    return null;
  }
}
function noErrorCode(value: unknown): boolean {
  return (
    value === undefined || value === null || value === '' || value === 'null' || value === 0 || value === '0'
  );
}
/** Native payload only, not a TOP wrapper or an HTTP status. No raw data is returned. */
export function classifyProductMaintenanceResponse(
  draftValue: unknown,
  raw: unknown
): ProductMaintenanceResult {
  const draft = parseDraft(draftValue);
  const root = record(raw);
  const metadata = responseDiagnostics(root);
  const responseResult = (
    status: ProductMaintenanceResult['status'],
    reason: ProductMaintenanceResult['reason']
  ): ProductMaintenanceResult => ({ ...result(draft.operation, status, reason), ...metadata });
  const ambiguous = () => responseResult('ambiguous', 'incomplete-evidence');
  if (!root) return ambiguous();
  // A nonzero transport/API envelope is insufficient to infer a mutation's final business outcome.
  if (
    !noErrorCode(root.code) ||
    root.error_response !== undefined ||
    (draft.operation !== 'deleteDraft' && bool(root.success) === false)
  )
    return ambiguous();
  if (draft.operation !== 'deleteDraft') {
    const business = record(root.result);
    if (!business) return ambiguous();
    if (bool(business.success) === false) return responseResult('rejected', 'explicit-rejection');
    if (
      bool(business.success) !== true ||
      !noErrorCode(business.msg_code) ||
      (business.data !== undefined && business.data !== null)
    )
      return ambiguous();
    return responseResult('accepted', 'explicit-success');
  }
  if (!Array.isArray(root.deleted_draft_ids)) return ambiguous();
  const deleted = (root.deleted_draft_ids as unknown[]).map(responseId);
  if (
    deleted.some((id) => id === null || !draft.draftIds.includes(id)) ||
    new Set(deleted).size !== deleted.length
  )
    return ambiguous();
  const success = bool(root.success);
  const errors = root.errors ?? [];
  if (!Array.isArray(errors)) return ambiguous();
  const rejectedIds = new Set<string>();
  for (const rawError of errors as unknown[]) {
    const row = record(rawError);
    const id = responseId(row?.draft_id);
    if (!id || !draft.draftIds.includes(id) || !Array.isArray(row?.errors) || row.errors.length === 0)
      continue;
    // docs type draft_id as Object. An opaque object is uncorrelatable, never a guessed ID.
    if (
      (row.errors as unknown[]).every((item) => {
        const detail = record(item);
        return (
          detail &&
          (!noErrorCode(detail.msg_code) || (typeof detail.message === 'string' && detail.message.length > 0))
        );
      })
    )
      rejectedIds.add(id);
  }
  const items = draft.draftIds.map((draftId) => ({
    draftId,
    status: deleted.includes(draftId)
      ? rejectedIds.has(draftId)
        ? ('ambiguous' as const)
        : ('reported-deleted' as const)
      : rejectedIds.has(draftId) || (success === false && draft.draftIds.length === 1)
        ? ('rejected' as const)
        : ('ambiguous' as const)
  }));
  const count = items.filter((item) => item.status === 'reported-deleted').length;
  const status =
    count === items.length && success === true && noErrorCode(root.msg_code) && errors.length === 0
      ? 'accepted'
      : count > 0 && count < items.length
        ? 'partial'
        : items.every((item) => item.status === 'rejected')
          ? 'rejected'
          : 'ambiguous';
  return {
    ...responseResult(
      status,
      status === 'accepted'
        ? 'explicit-success'
        : status === 'rejected'
          ? 'explicit-rejection'
          : 'incomplete-evidence'
    ),
    items
  };
}
export function classifyProductMaintenanceError(
  operation: ProductMaintenanceOperation,
  error: unknown
): ProductMaintenanceResult {
  const code = record(record(error)?.gatewayError)?.code;
  // Only known pre-dispatch/auth/policy rejection codes. Timeouts, 5xx and arbitrary exceptions remain unknown.
  const rejected =
    typeof code === 'string' &&
    [
      'REQUEST_CONTRACT_INVALID',
      'CAPABILITY_RESTRICTED',
      'AUTHENTICATION_FAILED',
      'PERMISSION_DENIED',
      'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
      'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
      'ALIBABA_IOP_PARAMETER_UNSUPPORTED',
      'ALIBABA_IOP_METHOD_UNSUPPORTED'
    ].includes(code);
  return {
    ...result(
      operation,
      rejected ? 'rejected' : 'ambiguous',
      rejected ? 'explicit-rejection' : 'unknown-outcome'
    ),
    ...errorDiagnostics(error)
  };
}
function comparison(): ProductMaintenanceReadback {
  return { status: 'matched', mismatchedFields: [], unavailableFields: [] };
}
function finish(value: ProductMaintenanceReadback): ProductMaintenanceReadback {
  return {
    ...value,
    status: value.mismatchedFields.length
      ? 'mismatched'
      : value.unavailableFields.length
        ? 'unavailable'
        : 'matched'
  };
}
function compareField(
  out: ProductMaintenanceReadback,
  path: string,
  expected: string,
  actual: unknown,
  numeric = false
): void {
  const left = numeric ? normalizedDecimal(expected) : expected;
  const right = numeric ? normalizedDecimal(actual) : typeof actual === 'string' && actual ? actual : null;
  if (right === null) out.unavailableFields.push(path);
  else if (left !== right) out.mismatchedFields.push(path);
}
function sku(snapshot: ProductMaintenanceSnapshot, id: string): ProductReference['skus'][number] | null {
  const rows = snapshot.skus.filter((row) => row.id === id);
  return rows.length === 1 ? (rows[0] ?? null) : null;
}
export function comparePriceReadback(
  value: unknown,
  snapshot: ProductMaintenanceSnapshot
): ProductMaintenanceReadback {
  const draft = priceDraft(value);
  const out = comparison();
  compareField(out, 'productId', draft.productId, snapshot.productId);
  if (snapshot.productId !== draft.productId) return finish(out);
  if (draft.mode === 'sku') {
    for (const row of draft.skus) {
      const actual = sku(snapshot, row.skuId);
      compareField(out, 'skus/' + row.skuId + '/price', row.price, actual?.price, true);
      compareField(out, 'skus/' + row.skuId + '/currency', draft.currency, actual?.currency);
    }
  } else {
    compareField(out, 'price/type', draft.mode === 'tiered' ? 'TIERED' : 'RANGE', snapshot.price.type);
    compareField(out, 'price/currency', draft.currency, snapshot.price.currency);
    if (draft.mode === 'range') {
      compareField(out, 'price/min', draft.minPrice, snapshot.price.min, true);
      compareField(out, 'price/max', draft.maxPrice, snapshot.price.max, true);
    } else {
      const tiers = snapshot.price.tiers;
      const quantities = tiers.map((row) => row.quantity);
      if (
        quantities.some((q) => q === null || !/^[1-9][0-9]*$/u.test(q)) ||
        new Set(quantities).size !== quantities.length
      )
        out.unavailableFields.push('price/tiers');
      else {
        if (tiers.length !== draft.tiers.length) out.mismatchedFields.push('price/tiers');
        for (const row of draft.tiers) {
          const actual = tiers.find((tier) => tier.quantity === row.quantity);
          compareField(out, 'price/tiers/' + row.quantity, row.price, actual?.price, true);
        }
      }
    }
  }
  return finish(out);
}
export function compareInventoryReadback(
  value: unknown,
  snapshot: ProductMaintenanceSnapshot
): ProductMaintenanceReadback {
  const draft = inventoryDraft(value);
  const out = comparison();
  compareField(out, 'productId', draft.productId, snapshot.productId);
  if (snapshot.productId !== draft.productId) return finish(out);
  if (draft.mode === 'spu') compareField(out, 'inventory', draft.inventory, snapshot.inventory, true);
  else
    for (const row of draft.skus)
      compareField(
        out,
        'skus/' + row.skuId + '/inventory',
        row.inventory,
        sku(snapshot, row.skuId)?.inventory,
        true
      );
  return finish(out);
}
/** No public generic call, persistence, retries, protocol fallback, logging or readback side effects. */
export class ProductMaintenanceAdapter {
  constructor(
    private readonly client: Pick<AlibabaClient, 'call'>,
    private readonly coordinator: ProductMaintenanceCoordinator
  ) {}
  async execute(intent: ProductMaintenanceIntent): Promise<ProductMaintenanceResult> {
    if (typeof record(this.coordinator)?.run !== 'function')
      return invalid('PRODUCT_MAINTENANCE_COORDINATOR_REQUIRED');
    const frozen = await createProductMaintenanceIntent(intent.draft);
    if (canonical(frozen) !== canonical(intent)) return invalid('PRODUCT_MAINTENANCE_INTENT_MISMATCH');
    const dispatch: { sent: boolean; result?: ProductMaintenanceResult } = { sent: false };
    const returned = await this.coordinator.run(frozen, async (permit) => {
      if (dispatch.sent) return invalid('PRODUCT_MAINTENANCE_ALREADY_DISPATCHED');
      if (
        record(permit)?.protocol !== 'iop' ||
        permit.fingerprint !== frozen.fingerprint ||
        !/^[A-Za-z0-9_.:-]{1,128}$/u.test(permit.persistedIntentId)
      )
        return invalid('PRODUCT_MAINTENANCE_PERMIT_INVALID');
      if (frozen.draft.operation === 'setPrice' && frozen.draft.mode === 'sku') {
        const draft = frozen.draft;
        const snapshot = permit.reference;
        if (
          snapshot?.productId !== draft.productId ||
          draft.skus.some((row) => sku(snapshot, row.skuId)?.currency !== draft.currency)
        )
          return invalid('PRODUCT_MAINTENANCE_SKU_CURRENCY_UNCONFIRMED');
      }
      dispatch.sent = true;
      try {
        const response = await this.client.call(frozen.method, frozen.parameters);
        dispatch.result =
          response.method === frozen.method
            ? classifyProductMaintenanceResponse(frozen.draft, response.data)
            : result(frozen.operation, 'ambiguous', 'incomplete-evidence');
        const traceId = diagnosticTrace(response.traceId);
        if (response.method === frozen.method && !dispatch.result.traceId && traceId)
          dispatch.result.traceId = traceId;
      } catch (error: unknown) {
        dispatch.result = classifyProductMaintenanceError(frozen.operation, error);
      }
      dispatch.result = freeze(dispatch.result);
      return dispatch.result;
    });
    if (!dispatch.sent || !dispatch.result || returned !== dispatch.result)
      return invalid('PRODUCT_MAINTENANCE_COORDINATOR_INVALID');
    return dispatch.result;
  }
}
