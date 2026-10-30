import { GatewayException } from './errors';
import type { GatewayClient } from './types';

/**
 * Coverage: IOP /alibaba/icbu/product/search/v2 (cid 11), read-only.
 * TOP: unsupported here; no store scan or cross-protocol retry.
 * Public parameters/outputParameters verified; synthetic tests only.
 * Account permission and real-provider acceptance are not asserted.
 */
export const IOP_PRODUCT_LOOKUP_METHOD = '/alibaba/icbu/product/search/v2';

export interface ProductLookupQuery {
  modelNumber?: string;
  /** Seller SKU code (barcode/EAN/etc.), NOT Alibaba's numeric SKU ID. */
  skuCode?: string;
  pageIndex?: number;
  pageSize?: number;
}
export interface ProductLookupItem {
  productId: string | null;
  title: string | null;
  modelNumber: string | null;
  status: string | null;
  skus: { id: string | null; code: string | null }[] | null;
}
export interface ProductLookupPage {
  items: ProductLookupItem[];
  /** Requested page, checked against provider metadata when returned. */
  pageIndex: number;
  pageSize: number;
  totalItems: number | null;
  totalPages: number | null;
  /** With unknown totals, a full page permits an explicit next-page request. */
  hasNextPage: boolean;
}

function fail(code = 'ALIBABA_IOP_RESPONSE_INVALID'): never {
  throw new GatewayException({ code, message: code, retryable: false });
}
function record(value: unknown, optional = false): Record<string, unknown> {
  if (optional && (value === undefined || value === null)) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail();
  return value.trim() ? value : null;
}
function id(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    (typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  )
    return String(value);
  return fail();
}
function count(value: unknown, minimum: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)))
    return fail();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) return fail();
  return result;
}
function queryText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') return fail('REQUEST_CONTRACT_INVALID');
  return value.trim();
}
function assertQuery(value: unknown): asserts value is ProductLookupQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('REQUEST_CONTRACT_INVALID');
}
function pageValue(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    return fail('REQUEST_CONTRACT_INVALID');
  return value;
}
function product(value: unknown): ProductLookupItem {
  const item = record(value);
  const basic = record(item.basic_info, true);
  if (item.sku_info !== undefined && item.sku_info !== null && !Array.isArray(item.sku_info)) return fail();
  return {
    productId: id(basic.product_id),
    title: text(basic.title),
    modelNumber: text(basic.model_number),
    status: text(basic.status),
    // search/v2 documents sku_info alongside basic_info, NOT under trade_info.
    skus: Array.isArray(item.sku_info)
      ? item.sku_info.map((value: unknown) => {
          const sku = record(value);
          return { id: id(sku.sku_id), code: text(sku.sku_code) };
        })
      : null
  };
}

/** Explicit, uncached reads. Account/session isolation belongs to the caller. */
export class ProductLookupClient {
  constructor(private readonly gateway: Pick<GatewayClient, 'request'>) {}

  async search(input: ProductLookupQuery): Promise<ProductLookupPage> {
    assertQuery(input);
    const modelNumber = queryText(input.modelNumber);
    const skuCode = queryText(input.skuCode);
    if (Boolean(modelNumber) === Boolean(skuCode)) return fail('REQUEST_CONTRACT_INVALID');
    const pageIndex = pageValue(input.pageIndex, 1);
    const pageSize = pageValue(input.pageSize, 20, 20);
    const result = await this.gateway.request('callCapability', {
      method: IOP_PRODUCT_LOOKUP_METHOD,
      parameters: {
        ...(modelNumber ? { model_number: modelNumber } : { sku_code: skuCode }),
        page_index: pageIndex,
        page_size: pageSize
      }
    });
    if (!result.contractValid || result.method !== IOP_PRODUCT_LOOKUP_METHOD) return fail();
    const data = record(result.data);
    if (data.success === false) return fail('ALIBABA_IOP_BUSINESS_REJECTED');
    if (data.success !== true || !Array.isArray(data.product_info)) return fail();
    const items = data.product_info.map(product);
    if (items.length > pageSize) return fail();
    const page = record(data.page, true);
    const returnedIndex = count(page.page_index, 1);
    const returnedSize = count(page.page_size, 1);
    if (
      (returnedIndex !== null && returnedIndex !== pageIndex) ||
      (returnedSize !== null && returnedSize !== pageSize)
    )
      return fail();
    const totalItems = count(page.total_item, 0);
    const totalPages = count(page.total_page, 0);
    return {
      items,
      pageIndex,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage:
        pageIndex < Number.MAX_SAFE_INTEGER &&
        (totalPages !== null
          ? pageIndex < totalPages
          : totalItems !== null
            ? pageIndex < Math.ceil(totalItems / pageSize)
            : items.length === pageSize)
    };
  }
}
