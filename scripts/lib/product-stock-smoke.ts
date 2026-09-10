import type { AccountVerificationStatus } from './account-verification';

export const STOCK_SHOWCASE_METHODS = [
  'alibaba.icbu.product.type.available.get',
  'alibaba.icbu.product.inventory.get',
  'alibaba.icbu.product.sku.inventory.get',
  'alibaba.scbp.showcase.list',
  'alibaba.scbp.showcase.status'
] as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function assessStockRead(
  method: string,
  data: unknown,
  contractValid: boolean
): {
  status: AccountVerificationStatus;
  reasonCode: string | null;
  recordCount: number | null;
} {
  if (!contractValid)
    return { status: 'contract-drift', reasonCode: 'RESPONSE_CONTRACT_INVALID', recordCount: null };
  const root = isRecord(data) ? data : {};
  let records: unknown;
  let success = false;
  let reasonCode: string | null = null;
  if (method.endsWith('inventory.get')) {
    const result = isRecord(root.result) ? root.result : {};
    success = result.success === true && Array.isArray(result.data_list);
    reasonCode =
      typeof result.msg_code === 'string' && result.msg_code ? result.msg_code.slice(0, 100) : null;
    records = result.data_list;
  } else if (method.endsWith('type.available.get')) {
    success =
      root.biz_success === true &&
      isRecord(root.data) &&
      typeof root.data.support_post_sourcing === 'boolean' &&
      typeof root.data.support_post_whole_sale === 'boolean';
    reasonCode = typeof root.msg_code === 'string' && root.msg_code ? root.msg_code.slice(0, 100) : null;
  } else if (method.endsWith('showcase.list')) {
    records = root.results;
    success = Array.isArray(records);
  } else if (method.endsWith('showcase.status')) {
    success = typeof root.total_count === 'number' && typeof root.current_count === 'number';
  }
  return {
    status:
      !success || reasonCode !== null
        ? 'provider-error'
        : Array.isArray(records) && records.length === 0
          ? 'no-data'
          : 'passed',
    reasonCode: success && reasonCode === null ? null : (reasonCode ?? 'MISSING_SUCCESS_EVIDENCE'),
    recordCount: Array.isArray(records) ? records.length : null
  };
}

// Values are never included; inspect only one array element to bound diagnostic size.
export function responseShape(value: unknown, depth = 0): unknown {
  if (depth > 5) return 'truncated';
  if (Array.isArray(value))
    return {
      type: 'array',
      length: value.length,
      item: value.length ? responseShape(value[0], depth + 1) : null
    };
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, child]) => [
          /^[a-z_]{1,64}$/iu.test(key) ? key : '<dynamic-key>',
          responseShape(child, depth + 1)
        ])
    );
  return value === null ? 'null' : typeof value;
}
