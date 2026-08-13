import type { AlibabaClient } from './alibaba-client';
import type {
  InsightsSupplierPage,
  InsightsSupplierProduct,
  InsightsSupplierProductAttribute,
  InsightsSupplierProductPage,
  InsightsSupplierRankTrend,
  RequestOf
} from './types';

export class InsightsAdapter {
  constructor(private readonly client: Pick<AlibabaClient, 'call'>) {}

  async getSupplierRank(): Promise<InsightsSupplierRankTrend> {
    const call = await this.client.call('alibaba.icbu.diagnostic.supplier.rank.getpercent', {});
    const root = unwrap(call.data, call.method);
    const container = findRecordAt(root, 'rank_info_list') ?? root;
    const items = findRecords(container, ['rank_info'])
      .map((item) => ({
        statDate: readString(item, ['stat_date']) ?? '',
        percent: readNumber(item, ['percent']) ?? Number.NaN
      }))
      .filter((item) => item.statDate !== '' && Number.isFinite(item.percent));
    return {
      items,
      latestPercent: items.at(-1)?.percent ?? null
    };
  }

  async listSuppliers(request: RequestOf<'listInsightsSuppliers'>): Promise<InsightsSupplierPage> {
    const page = positiveInteger(request.page, 1);
    const pageSize = Math.min(positiveInteger(request.pageSize, 10), 100);
    const call = await this.client.call('alibaba.procurement.mysupplier.list', {
      current_page: page - 1,
      page_size: pageSize,
      type: 'order'
    });
    const result = findRecordAt(unwrap(call.data, call.method), 'result') ?? {};
    assertSuccess(result, '供应商列表查询失败');
    return {
      supplierIds: readStringArray(result, ['supplier_id_enc_list']),
      page: (readInteger(result, ['curr_page']) ?? page - 1) + 1,
      pageSize: readInteger(result, ['page_size']) ?? pageSize,
      total: readInteger(result, ['total_item']) ?? 0
    };
  }

  async listSupplierProducts(
    request: RequestOf<'listInsightsSupplierProducts'>
  ): Promise<InsightsSupplierProductPage> {
    const supplierId = request.supplierId.trim();
    if (!supplierId) throw new Error('supplierId 不能为空');
    const page = positiveInteger(request.page, 1);
    const pageSize = Math.min(positiveInteger(request.pageSize, 10), 100);
    const dateStart = timestampOf(request.dateStart, 'dateStart');
    const dateEnd = timestampOf(request.dateEnd, 'dateEnd');
    if (dateStart !== undefined && dateEnd !== undefined && dateStart > dateEnd) {
      throw new Error('dateStart 不能晚于 dateEnd');
    }
    const call = await this.client.call('alibaba.procurement.supplier.items.get', {
      product_list_query: {
        page_index: page - 1,
        page_size: pageSize,
        seller_account_id: supplierId,
        type: 'order',
        ...(dateStart !== undefined ? { date_start: dateStart } : {}),
        ...(dateEnd !== undefined ? { date_end: dateEnd } : {})
      }
    });
    const result = findRecordAt(unwrap(call.data, call.method), 'result') ?? {};
    assertSuccess(result, '供应商商品查询失败');
    const items = findRecords(result, ['product_list']).map(normalizeProduct);
    return {
      items,
      page: (readInteger(result, ['curr_page']) ?? page - 1) + 1,
      pageSize: readInteger(result, ['page_size']) ?? pageSize,
      total: readInteger(result, ['total_order_count']) ?? items.length
    };
  }
}

function normalizeProduct(item: Record<string, unknown>): InsightsSupplierProduct {
  const sku = findRecordAt(item, 'sku') ?? {};
  return {
    id: readString(item, ['id']) ?? '',
    subject: readString(item, ['subject']) ?? '未命名商品',
    description: readString(item, ['description']) ?? '',
    categoryId: readString(item, ['category']) ?? '',
    priceRange: readString(item, ['price_range']) ?? null,
    priceUnit: readString(item, ['price_unit']) ?? null,
    productUrl: normalizeHttpUrl(readString(item, ['product_detail_url'])),
    publishedAt: readDate(item, ['publish_time']),
    attributes: findRecords(sku, ['attributes']).map(normalizeAttribute)
  };
}

function normalizeAttribute(item: Record<string, unknown>): InsightsSupplierProductAttribute {
  return {
    attributeId: readString(item, ['attribute_id']) ?? '',
    attributeName: readString(item, ['attribute_name']) ?? '',
    valueId: readString(item, ['value_id']) ?? '',
    valueName: readString(item, ['value_name']) ?? '',
    imageUrl: normalizeHttpUrl(readString(item, ['sku_custom_image_url'])),
    customValueName: nullableNonEmpty(readString(item, ['sku_custom_value_name']))
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? (value ?? fallback) : fallback;
}

function timestampOf(value: string | undefined, field: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`${field} 不是有效日期`);
  return timestamp;
}

function assertSuccess(result: Record<string, unknown>, fallback: string): void {
  if (readBoolean(result, ['success']) !== false) return;
  throw new Error(readString(result, ['error_msg', 'error_code']) ?? fallback);
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(record[`${method.replaceAll('.', '_')}_response`]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findRecordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const direct = record[key];
  if (isRecord(direct)) return direct;
  for (const child of Object.values(record)) {
    if (!isRecord(child)) continue;
    const nested = findRecordAt(child, key);
    if (nested) return nested;
  }
  return null;
}

function findRecords(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  const visit = (value: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > 6) return null;
    if (Array.isArray(value)) return value.filter(isRecord);
    if (!isRecord(value)) return null;
    for (const key of keys) {
      if (!(key in value)) continue;
      const found = visit(value[key], depth + 1);
      if (found) return found;
    }
    for (const child of Object.values(value)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(record, 0) ?? [];
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function readInteger(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readNumber(record, keys);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.flatMap((item) =>
        typeof item === 'string' || typeof item === 'number' ? [String(item)] : []
      );
    }
    if (isRecord(value)) {
      const nested = Object.values(value).find(Array.isArray);
      if (nested) {
        return nested.flatMap((item) =>
          typeof item === 'string' || typeof item === 'number' ? [String(item)] : []
        );
      }
    }
  }
  return [];
}

function normalizeHttpUrl(value: string | undefined): string | null {
  if (!value || value === '0') return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function nullableNonEmpty(value: string | undefined): string | null {
  return value && value.trim() !== '' ? value : null;
}

function readDate(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}
