import type { AlibabaClient } from './alibaba-client';
import type { ProductInventoryRequest, ProductInventorySnapshot } from './types';
import { GatewayException } from './errors';
import { findCapability } from './capability-registry';
import { validateProductInventoryRequest } from './generated/validators-inventory';
export { validateProductInventorySnapshot } from './generated/validators-inventory';
export type { ProductInventoryRequest, ProductInventorySnapshot } from './types';

export const inventoryMethods = {
  product: 'alibaba.icbu.product.inventory.get',
  sku: 'alibaba.icbu.product.sku.inventory.get'
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
    if (quantity != null && (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0))
      issues.push(`records/${index}/inventory:invalid-quantity`);
    const entry = {
      skuId: validId ? String(sku) : null,
      skuOuterId: text(row?.sku_outer_id),
      inventoryCode: text(row?.inventory_code),
      inventory: typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0 ? quantity : null
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

export class ProductInventoryAdapter {
  constructor(
    private readonly client: Pick<AlibabaClient, 'call'>,
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
    const parameters = { product_id: request.productId, language: request.language };
    if ((await this.validateRequest(method, parameters)).length)
      throw new GatewayException({
        code: 'REQUEST_CONTRACT_INVALID',
        message: 'REQUEST_CONTRACT_INVALID',
        retryable: false
      });
    const response = await this.client.call(method, parameters);
    const envelope = record(response.data);
    const data = envelope?.[`${method.replaceAll('.', '_')}_response`] ?? response.data;
    const issues = await this.validateResponse(method, data);
    return adaptProductInventory(
      request,
      data,
      issues.map((issue) => `${issue.instancePath}:${issue.keyword}`)
    );
  }
}
