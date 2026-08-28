import {
  inspectProductSchemaSerialization,
  isAlibabaLanguage,
  parseProductSchemaXml,
  productSchemaFieldText,
  validateProductSchemaModel,
  validateSchemaPublishInput
} from '@one-vegetable/core';

import type {
  AlibabaLanguage,
  ProductMutationResult,
  ProductSchemaField,
  SchemaPublishRequest
} from '@one-vegetable/core';
import type { DraftStorage } from './product-editor-drafts';

export const PRODUCT_BATCH_PUBLISH_STORAGE_KEY = 'one-vegetable-product-batch-publish-v1';

const SCHEMA_VERSION = 1;
const MAX_ITEMS = 20;
const MAX_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const TITLE_FIELD_IDS = new Set(['producttitle', 'product_title', 'subject']);

export type ProductBatchPublishTarget = 'draft' | 'publish';
export type ProductBatchPublishStoredStatus = 'queued' | 'draft-saved' | 'published';
export type ProductBatchPublishRunStatus = 'succeeded' | 'failed' | 'blocked' | 'cancelled';

export interface ProductBatchPublishItem {
  schemaVersion: 1;
  id: string;
  title: string;
  categoryId: string;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  xml: string;
  status: ProductBatchPublishStoredStatus;
  platformProductId: string | null;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface ProductBatchPublishItemInput {
  title?: string;
  categoryId: string;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  xml: string;
}

export interface ProductBatchPublishPreflight {
  ready: boolean;
  title: string;
  schemaIssueCount: number;
  blockingIssues: string[];
  request: SchemaPublishRequest | null;
}

export interface ProductBatchPublishRunResult {
  itemId: string;
  title: string;
  target: ProductBatchPublishTarget;
  status: ProductBatchPublishRunStatus;
  productId: string | null;
  traceId: string | null;
  message: string | null;
}

export interface ProductBatchPublishRunnerOptions {
  items: readonly ProductBatchPublishItem[];
  target: ProductBatchPublishTarget;
  submit: (request: SchemaPublishRequest, item: ProductBatchPublishItem) => Promise<ProductMutationResult>;
  shouldStop?: (() => boolean) | undefined;
  onResult?: ((result: ProductBatchPublishRunResult) => void) | undefined;
}

export function loadProductBatchPublishItems(
  storage: DraftStorage,
  now = Date.now()
): ProductBatchPublishItem[] {
  const raw = storage.getItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    storage.removeItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
    return [];
  }

  const valid = Array.isArray(parsed) ? parsed.filter(isProductBatchPublishItem) : [];
  const retained = valid
    .filter((item) => now - item.updatedAtUtc <= MAX_AGE_MILLISECONDS && item.updatedAtUtc <= now + 60_000)
    .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
    .slice(0, MAX_ITEMS);
  if (!Array.isArray(parsed) || retained.length !== parsed.length) writeItems(storage, retained);
  return retained;
}

export function upsertProductBatchPublishItem(
  storage: DraftStorage,
  input: ProductBatchPublishItemInput,
  options: { id?: string; now?: number } = {}
): ProductBatchPublishItem {
  const now = options.now ?? Date.now();
  const current = loadProductBatchPublishItems(storage, now);
  const existing = options.id ? current.find((item) => item.id === options.id) : undefined;
  if (!existing && current.length >= MAX_ITEMS) {
    throw new Error(`批量发布队列最多保留 ${MAX_ITEMS} 条商品`);
  }

  const normalizedCategoryId = normalizeCategoryId(input.categoryId);
  const normalizedXml = input.xml.trim();
  if (!normalizedXml) throw new Error('商品 Schema XML 不能为空');
  const derivedTitle = inspectProductBatchPublishXml(normalizedXml).title;
  const item: ProductBatchPublishItem = {
    schemaVersion: SCHEMA_VERSION,
    id: existing?.id ?? options.id ?? globalThis.crypto.randomUUID(),
    title: normalizeTitle(input.title) || derivedTitle,
    categoryId: normalizedCategoryId,
    language: input.language,
    market: input.market,
    xml: normalizedXml,
    status: 'queued',
    platformProductId: null,
    createdAtUtc: existing?.createdAtUtc ?? now,
    updatedAtUtc: now
  };
  writeItems(
    storage,
    [item, ...current.filter((candidate) => candidate.id !== item.id)]
      .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
      .slice(0, MAX_ITEMS)
  );
  return item;
}

export function completeProductBatchPublishItem(
  storage: DraftStorage,
  id: string,
  target: ProductBatchPublishTarget,
  productId: string,
  now = Date.now()
): ProductBatchPublishItem {
  const items = loadProductBatchPublishItems(storage, now);
  const current = items.find((item) => item.id === id);
  if (!current) throw new Error('批量发布商品不存在或已过期');
  const updated: ProductBatchPublishItem = {
    ...current,
    status: target === 'draft' ? 'draft-saved' : 'published',
    platformProductId: productId,
    updatedAtUtc: now
  };
  writeItems(
    storage,
    items.map((item) => (item.id === id ? updated : item))
  );
  return updated;
}

export function removeProductBatchPublishItem(storage: DraftStorage, id: string, now = Date.now()): void {
  writeItems(
    storage,
    loadProductBatchPublishItems(storage, now).filter((item) => item.id !== id)
  );
}

export function inspectProductBatchPublishItem(
  item: ProductBatchPublishItem,
  target: ProductBatchPublishTarget
): ProductBatchPublishPreflight {
  if (item.status !== 'queued') {
    return blockedPreflight(item.title, '该商品已经提交到平台，不能重复发布');
  }

  let inspection: ReturnType<typeof inspectProductBatchPublishXml>;
  try {
    inspection = inspectProductBatchPublishXml(item.xml);
  } catch (error: unknown) {
    return blockedPreflight(item.title, errorMessage(error));
  }
  const validation = validateSchemaPublishInput({
    categoryId: Number(item.categoryId),
    language: item.language,
    schemaXml: inspection.xml
  });
  const blockingIssues = [
    ...inspection.structuralDiffs,
    ...(!validation.valid ? validation.errors : []),
    ...(target === 'publish' ? inspection.schemaIssues : [])
  ];
  return {
    ready: blockingIssues.length === 0 && validation.data !== undefined,
    title: inspection.title,
    schemaIssueCount: inspection.schemaIssues.length,
    blockingIssues,
    request: blockingIssues.length === 0 && validation.data ? validation.data : null
  };
}

export async function runProductBatchPublish(
  options: ProductBatchPublishRunnerOptions
): Promise<ProductBatchPublishRunResult[]> {
  const results: ProductBatchPublishRunResult[] = [];
  for (const item of options.items) {
    if (options.shouldStop?.()) {
      const cancelled = resultFor(item, options.target, 'cancelled', null, null, '已停止后续任务');
      results.push(cancelled);
      options.onResult?.(cancelled);
      continue;
    }
    const preflight = inspectProductBatchPublishItem(item, options.target);
    if (!preflight.ready || !preflight.request) {
      const blocked = resultFor(
        item,
        options.target,
        'blocked',
        null,
        null,
        preflight.blockingIssues.join('；') || '商品未通过提交前检查'
      );
      results.push(blocked);
      options.onResult?.(blocked);
      continue;
    }
    try {
      const response = await options.submit(preflight.request, item);
      const result = response.success
        ? resultFor(item, options.target, 'succeeded', response.productId, response.traceId, null)
        : resultFor(
            item,
            options.target,
            'failed',
            response.productId,
            response.traceId,
            '平台未明确接受请求'
          );
      results.push(result);
      options.onResult?.(result);
    } catch (error: unknown) {
      const failed = resultFor(item, options.target, 'failed', null, null, errorMessage(error));
      results.push(failed);
      options.onResult?.(failed);
    }
  }
  return results;
}

function inspectProductBatchPublishXml(xml: string): {
  xml: string;
  title: string;
  structuralDiffs: string[];
  schemaIssues: string[];
} {
  const model = parseProductSchemaXml(xml);
  const serialization = inspectProductSchemaSerialization(model);
  const title = findTitle(model.fields) || '未命名商品';
  return {
    xml: serialization.xml,
    title,
    structuralDiffs: serialization.safe ? [] : serialization.structuralDiffs,
    schemaIssues: validateProductSchemaModel(model)
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message)
  };
}

function findTitle(fields: readonly ProductSchemaField[]): string {
  for (const field of fields) {
    if (TITLE_FIELD_IDS.has(field.id.toLocaleLowerCase())) {
      const value = productSchemaFieldText(field).trim();
      if (value) return value;
    }
    const nested = findTitle([...field.children, ...field.instances.flatMap((instance) => instance.fields)]);
    if (nested) return nested;
  }
  return '';
}

function blockedPreflight(title: string, message: string): ProductBatchPublishPreflight {
  return { ready: false, title, schemaIssueCount: 0, blockingIssues: [message], request: null };
}

function resultFor(
  item: ProductBatchPublishItem,
  target: ProductBatchPublishTarget,
  status: ProductBatchPublishRunStatus,
  productId: string | null,
  traceId: string | null,
  message: string | null
): ProductBatchPublishRunResult {
  return { itemId: item.id, title: item.title, target, status, productId, traceId, message };
}

function normalizeCategoryId(value: string): string {
  const normalized = value.trim();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('商品类目必须是正整数');
  return normalized;
}

function normalizeTitle(value: string | undefined): string {
  return value?.trim().slice(0, 256) ?? '';
}

function isProductBatchPublishItem(value: unknown): value is ProductBatchPublishItem {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === SCHEMA_VERSION &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.categoryId === 'string' &&
    isAlibabaLanguage(value.language) &&
    (value.market === 'wholesale' || value.market === 'sourcing') &&
    typeof value.xml === 'string' &&
    (value.status === 'queued' || value.status === 'draft-saved' || value.status === 'published') &&
    (value.platformProductId === null || typeof value.platformProductId === 'string') &&
    isTimestamp(value.createdAtUtc) &&
    isTimestamp(value.updatedAtUtc)
  );
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeItems(storage: DraftStorage, items: readonly ProductBatchPublishItem[]): void {
  if (items.length === 0) {
    storage.removeItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
    return;
  }
  storage.setItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY, JSON.stringify(items));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '批量发布请求失败';
}
