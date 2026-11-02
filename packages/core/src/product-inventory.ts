import type { AlibabaClient } from './alibaba-client';
import type { ProductInventoryRequest, ProductInventorySnapshot } from './types';
import { GatewayException } from './errors';
import { findCapability } from './capability-registry';
import { validateProductInventoryRequest } from './generated/validators-inventory';
import { IOP_REFERENCE_METHODS } from './product-reference-methods';
import {
  assessAbsoluteInventoryEvidence,
  inventoryFieldEvidence,
  type AbsoluteInventoryEvidenceRow
} from './inventory-quantity-evidence';
export { validateProductInventorySnapshot } from './generated/validators-inventory';
export type { ProductInventoryRequest, ProductInventorySnapshot } from './types';

export const inventoryMethods = {
  product: 'alibaba.icbu.product.inventory.get',
  sku: 'alibaba.icbu.product.sku.inventory.get',
  absolute: IOP_REFERENCE_METHODS.getProduct
} as const;
type Validator = (
  method: string,
  value: unknown
) => Promise<readonly { instancePath: string; keyword: string }[]>;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value.length ? value : null);

/** Never adds quantities across inventory codes or silently turns an empty response into zero. */
export function adaptProductInventory(
  request: ProductInventoryRequest,
  raw: unknown,
  contractIssues: readonly string[] = [],
  now = Date.now()
): ProductInventorySnapshot {
  const envelope = record(raw);
  const data =
    record(envelope?.[`${inventoryMethods[request.source].replaceAll('.', '_')}_response`]) ?? envelope;
  const result = record(data?.result);
  const issues = [...contractIssues];
  const code = text(result?.msg_code);
  const snapshot: ProductInventorySnapshot = {
    productId: request.productId,
    source: request.source,
    queriedAt: now,
    traceId: text(result?.trace_id) ?? text(data?.request_id) ?? '',
    status: 'drift',
    records: [],
    issues,
    reasonCode: code
  };
  if (result?.success === false || code) return { ...snapshot, status: 'failed' };
  if (result?.success !== true || !Array.isArray(result.data_list)) {
    issues.push('result:explicit-success-and-list-required');
    return snapshot;
  }
  const seen = new Set<string>();
  snapshot.records = result.data_list.map((rawRow: unknown, index: number) => {
    const row = record(rawRow);
    const sku = row?.sku_id;
    const quantity = row?.inventory;
    const validId = typeof sku === 'number' && Number.isSafeInteger(sku) && sku > 0;
    if (sku != null && !validId) issues.push(`records/${index}/skuId:unsafe-or-invalid-id`);
    if (quantity != null && (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0))
      issues.push(`records/${index}/inventory:invalid-quantity`);
    const entry = {
      skuId: validId ? String(sku) : null,
      skuOuterId: text(row?.sku_outer_id),
      inventoryCode: text(row?.inventory_code),
      inventory:
        typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null
    };
    if (!row || entry.skuId === null || entry.inventoryCode === null || entry.inventory === null)
      issues.push(`records/${index}:missing-fields`);
    const key = JSON.stringify([entry.skuId, entry.inventoryCode]);
    if (seen.has(key)) issues.push(`records/${index}:duplicate-key`);
    seen.add(key);
    return entry;
  });
  snapshot.status = issues.length ? 'drift' : snapshot.records.length ? 'ready' : 'no-data';
  return snapshot;
}

export function adaptAbsoluteProductInventory(
  request: ProductInventoryRequest,
  raw: unknown,
  issues: readonly string[],
  localReadId: string,
  now = Date.now()
): ProductInventorySnapshot {
  const data = record(raw) ?? {},
    info = record(data.product_info);
  const basic = record(info?.basic_info),
    trade = record(info?.trade_info);
  const rawSkus = trade?.sku_info;
  const skus = Array.isArray(rawSkus) ? (rawSkus.slice(0, 500) as unknown[]) : [];
  const codeField = (key: string) => ({
    ...inventoryFieldEvidence(basic, key),
    ...(typeof basic?.[key] === 'string' ? { code: basic[key] } : {})
  });
  const row: AbsoluteInventoryEvidenceRow = {
    protocol: 'iop',
    productId: request.productId,
    route: 'product',
    path: IOP_REFERENCE_METHODS.getProduct,
    requestId: localReadId,
    status: issues.length ? 'contract-drift' : 'accepted',
    contractValid: issues.length === 0,
    businessSuccess: data.success === true && (data.code === 0 || data.code === '0'),
    evidence: {
      productId: inventoryFieldEvidence(basic, 'product_id', true),
      auditStatus: codeField('audit_status'),
      platformStatus: codeField('status'),
      inventory: inventoryFieldEvidence(trade, 'inventory', true),
      skuInfo: inventoryFieldEvidence(trade, 'sku_info'),
      skuRows: skus.map((sku) => ({
        skuId: inventoryFieldEvidence(sku, 'sku_id', true, true),
        inventory: inventoryFieldEvidence(sku, 'inventory', true)
      }))
    }
  };
  const evaluate = (
    scope: 'spu' | 'sku',
    skuId: string | null
  ): NonNullable<ProductInventorySnapshot['quantityEvidence']>[number] => {
    const result = assessAbsoluteInventoryEvidence(
      scope === 'spu'
        ? { productId: request.productId, scope }
        : { productId: request.productId, scope, skuId },
      row
    );
    return result.status === 'available'
      ? { scope, skuId, status: 'available', quantity: result.quantity, reasonCode: null }
      : { scope, skuId, status: 'unavailable', quantity: null, reasonCode: result.reason };
  };
  const quantityEvidence = [
    evaluate('spu', null),
    ...skus.map((sku) => {
      const id = inventoryFieldEvidence(sku, 'sku_id', true, true).integerString;
      return evaluate('sku', typeof id === 'string' ? id : null);
    })
  ];
  return {
    productId: request.productId,
    source: 'absolute',
    protocol: 'iop',
    queriedAt: now,
    traceId: text(data.request_id) ?? '',
    status: issues.length
      ? 'drift'
      : !row.businessSuccess
        ? 'failed'
        : quantityEvidence.some((item) => item.status === 'available')
          ? 'ready'
          : 'no-data',
    records: [],
    issues: [...issues],
    reasonCode: issues.length || !row.businessSuccess ? 'INVENTORY_RESPONSE_INVALID' : null,
    quantityEvidence
  };
}

export class ProductInventoryAdapter {
  constructor(
    private readonly client: Pick<AlibabaClient, 'call'> & Partial<Pick<AlibabaClient, 'protocol'>>,
    private readonly validateRequest: Validator,
    private readonly validateResponse: Validator
  ) {}

  async get(request: ProductInventoryRequest): Promise<ProductInventorySnapshot> {
    if (!validateProductInventoryRequest(request))
      throw new GatewayException({
        code: 'REQUEST_CONTRACT_INVALID',
        message: 'REQUEST_CONTRACT_INVALID',
        retryable: false
      });
    const method = inventoryMethods[request.source];
    if (request.source === 'absolute' && this.client.protocol !== 'iop')
      throw new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        retryable: false
      });
    const capability = findCapability(method);
    if (
      !capability?.enabled ||
      capability.lifecycle !== 'active' ||
      capability.restricted ||
      !capability.realCallEnabled ||
      capability.risk !== 'read'
    ) {
      throw new GatewayException({
        code: 'CAPABILITY_RESTRICTED',
        message: 'CAPABILITY_RESTRICTED',
        retryable: false
      });
    }
    const parameters =
      request.source === 'absolute'
        ? { product_id: request.productId }
        : { product_id: request.productId, language: request.language };
    if ((await this.validateRequest(method, parameters)).length)
      throw new GatewayException({
        code: 'REQUEST_CONTRACT_INVALID',
        message: 'REQUEST_CONTRACT_INVALID',
        retryable: false
      });
    const localReadId = crypto.randomUUID();
    const response = await this.client.call(method, parameters);
    const envelope = record(response.data);
    const data = envelope?.[`${method.replaceAll('.', '_')}_response`] ?? response.data;
    const issues = await this.validateResponse(method, data);
    if (request.source === 'absolute')
      return adaptAbsoluteProductInventory(
        request,
        data,
        issues.map((issue) => issue.instancePath + ':' + issue.keyword),
        localReadId
      );
    return {
      ...adaptProductInventory(
        request,
        data,
        issues.map((issue) => `${issue.instancePath}:${issue.keyword}`)
      ),
      protocol: this.client.protocol ?? 'top'
    };
  }
}
