import { isAlibabaLanguage, type AlibabaLanguage } from './preferences';
import { inspectProductSchemaSerialization, parseProductSchemaXml } from './product-schema';

import type { Product } from './types';

export const PRODUCT_TRANSFER_FORMAT = 'one-vegetable-products';
export const PRODUCT_TRANSFER_SCHEMA_VERSION = 1;
export const MAX_PRODUCT_TRANSFER_ITEMS = 20;
export const MAX_PRODUCT_TRANSFER_JSON_BYTES = 10 * 1024 * 1024;
export const MAX_PRODUCT_TRANSFER_SCHEMA_BYTES = 2 * 1024 * 1024;

export interface ProductTransferSourceV1 {
  productId: string;
  subject: string;
  groupName: string;
  status: Product['status'];
  updatedAt: string;
}

export interface ProductTransferItemV1 {
  source: ProductTransferSourceV1;
  categoryId: number;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  schemaXml: string;
}

export interface ProductTransferDocumentV1 {
  format: typeof PRODUCT_TRANSFER_FORMAT;
  schemaVersion: typeof PRODUCT_TRANSFER_SCHEMA_VERSION;
  exportedAtUtc: string;
  products: ProductTransferItemV1[];
}

export interface ProductTransferItemInput {
  source: ProductTransferSourceV1;
  categoryId: number;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  schemaXml: string;
}

export function createProductTransferDocument(
  products: readonly ProductTransferItemInput[],
  exportedAt = new Date()
): ProductTransferDocumentV1 {
  if (Number.isNaN(exportedAt.getTime())) throw new Error('导出时间无效');
  const exportedAtUtc = exportedAt.toISOString();
  return normalizeProductTransferDocument({
    format: PRODUCT_TRANSFER_FORMAT,
    schemaVersion: PRODUCT_TRANSFER_SCHEMA_VERSION,
    exportedAtUtc,
    products
  });
}

export function serializeProductTransferDocument(document: ProductTransferDocumentV1): string {
  const normalized = normalizeProductTransferDocument(document);
  const json = `${JSON.stringify(normalized, null, 2)}\n`;
  if (utf8ByteLength(json) > MAX_PRODUCT_TRANSFER_JSON_BYTES) {
    throw new Error('商品导出文件超过 10 MiB 上限');
  }
  return json;
}

export function parseProductTransferJson(json: string): ProductTransferDocumentV1 {
  if (utf8ByteLength(json) > MAX_PRODUCT_TRANSFER_JSON_BYTES) {
    throw new Error('商品导入文件超过 10 MiB 上限');
  }
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error('商品导入文件不是有效 JSON');
  }
  return normalizeProductTransferDocument(value);
}

export function productTransferQueueItemId(item: ProductTransferItemV1): string {
  return `import:${item.source.productId}:${item.language}`;
}

function normalizeProductTransferDocument(value: unknown): ProductTransferDocumentV1 {
  const record = requireRecord(value, '商品导入文件必须是 JSON 对象');
  if (record.format !== PRODUCT_TRANSFER_FORMAT) {
    throw new Error(`不支持的商品导入格式：${displayValue(record.format)}`);
  }
  if (record.schemaVersion !== PRODUCT_TRANSFER_SCHEMA_VERSION) {
    throw new Error(`不支持的商品导入版本：${displayValue(record.schemaVersion)}`);
  }
  if (!Array.isArray(record.products) || record.products.length === 0) {
    throw new Error('商品导入文件至少需要包含 1 个商品');
  }
  if (record.products.length > MAX_PRODUCT_TRANSFER_ITEMS) {
    throw new Error(`商品导入文件最多包含 ${MAX_PRODUCT_TRANSFER_ITEMS} 个商品`);
  }

  const products = record.products.map((product, index) => normalizeProduct(product, index));
  const identifiers = products.map((product) => productTransferQueueItemId(product));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error('商品导入文件包含重复的来源商品和语言');
  }

  return {
    format: PRODUCT_TRANSFER_FORMAT,
    schemaVersion: PRODUCT_TRANSFER_SCHEMA_VERSION,
    exportedAtUtc: normalizedIsoDate(record.exportedAtUtc, '商品导出时间无效'),
    products
  };
}

function normalizeProduct(value: unknown, index: number): ProductTransferItemV1 {
  const item = requireRecord(value, `第 ${index + 1} 个商品必须是 JSON 对象`);
  const source = normalizeSource(item.source, index);
  const categoryId = requirePositiveInteger(item.categoryId, `第 ${index + 1} 个商品类目无效`);
  if (!isAlibabaLanguage(item.language)) {
    throw new Error(`第 ${index + 1} 个商品语言无效`);
  }
  if (item.market !== 'wholesale' && item.market !== 'sourcing') {
    throw new Error(`第 ${index + 1} 个商品市场无效`);
  }
  const schemaXml = requireString(item.schemaXml, `第 ${index + 1} 个商品缺少 Schema XML`).trim();
  if (utf8ByteLength(schemaXml) > MAX_PRODUCT_TRANSFER_SCHEMA_BYTES) {
    throw new Error(`第 ${index + 1} 个商品 Schema XML 超过 2 MiB 上限`);
  }
  if (schemaXml === '') throw new Error(`第 ${index + 1} 个商品缺少 Schema XML`);
  const inspection = inspectProductSchemaSerialization(parseProductSchemaXml(schemaXml));
  if (!inspection.safe) {
    throw new Error(`第 ${index + 1} 个商品 Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
  }

  return {
    source,
    categoryId,
    language: item.language,
    market: item.market,
    schemaXml: inspection.xml
  };
}

function normalizeSource(value: unknown, index: number): ProductTransferSourceV1 {
  const source = requireRecord(value, `第 ${index + 1} 个商品缺少来源信息`);
  const productId = requireString(source.productId, `第 ${index + 1} 个商品来源 ID 无效`).trim();
  if (!/^[1-9]\d*$/u.test(productId)) throw new Error(`第 ${index + 1} 个商品来源 ID 无效`);
  const subject = requireBoundedString(source.subject, 256, `第 ${index + 1} 个商品标题无效`);
  const groupName = requireBoundedString(source.groupName, 256, `第 ${index + 1} 个商品分组无效`, true);
  if (!isProductStatus(source.status)) throw new Error(`第 ${index + 1} 个商品状态无效`);
  const updatedAt = normalizedIsoDate(source.updatedAt, `第 ${index + 1} 个商品更新时间无效`);
  return { productId, subject, groupName, status: source.status, updatedAt };
}

function isProductStatus(value: unknown): value is Product['status'] {
  return (
    value === 'online' ||
    value === 'offline' ||
    value === 'draft' ||
    value === 'auditing' ||
    value === 'rejected'
  );
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message);
  return value;
}

function requireBoundedString(value: unknown, max: number, message: string, allowEmpty = false): string {
  const normalized = requireString(value, message).trim();
  if ((!allowEmpty && normalized === '') || normalized.length > max) throw new Error(message);
  return normalized;
}

function requirePositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(message);
  return value;
}

function normalizedIsoDate(value: unknown, message: string): string {
  const raw = requireString(value, message);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(message);
  return date.toISOString();
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '未知';
}
