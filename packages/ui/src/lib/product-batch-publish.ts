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

export interface ProductBatchPublishImportInput extends ProductBatchPublishItemInput {
  id: string;
}

export interface ProductBatchPublishImportResult {
  items: ProductBatchPublishItem[];
  added: number;
  updated: number;
  skipped: number;
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
  onStart?: ((item: ProductBatchPublishItem) => void) | undefined;
  onResult?: ((result: ProductBatchPublishRunResult) => void) | undefined;
}

export function loadProductBatchPublishItems(
  draftStorage: DraftStorage,
  now = Date.now()
): ProductBatchPublishItem[] {
  const raw = draftStorage.getItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    draftStorage.removeItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
    return [];
  }

  const valid = Array.isArray(parsed) ? parsed.filter(isProductBatchPublishItem) : [];
  const retained = valid
    .filter((item) => now - item.updatedAtUtc <= MAX_AGE_MILLISECONDS && item.updatedAtUtc <= now + 60_000)
    .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
    .slice(0, MAX_ITEMS);
  if (!Array.isArray(parsed) || retained.length !== parsed.length) writeItems(draftStorage, retained);
  return retained;
}

export function upsertProductBatchPublishItem(
  draftStorage: DraftStorage,
  input: ProductBatchPublishItemInput,
  options: { id?: string; now?: number } = {}
): ProductBatchPublishItem {
  const now = options.now ?? Date.now();
  const current = loadProductBatchPublishItems(draftStorage, now);
  const existing = options.id ? current.find((item) => item.id === options.id) : undefined;
  if (!existing && current.length >= MAX_ITEMS) {
    throw new Error(`批量发布队列最多保留 ${MAX_ITEMS} 条商品`);
  }

  const id = existing?.id ?? options.id;
  const item = createProductBatchPublishItem(input, {
    ...(id ? { id } : {}),
    ...(existing ? { createdAtUtc: existing.createdAtUtc } : {}),
    updatedAtUtc: now
  });
  writeItems(
    draftStorage,
    [item, ...current.filter((candidate) => candidate.id !== item.id)]
      .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
      .slice(0, MAX_ITEMS)
  );
  return item;
}

export function importProductBatchPublishItems(
  draftStorage: DraftStorage,
  inputs: readonly ProductBatchPublishImportInput[],
  now = Date.now()
): ProductBatchPublishImportResult {
  if (inputs.length === 0) throw new Error('商品导入文件没有可导入商品');
  if (inputs.length > MAX_ITEMS) throw new Error(`单次最多导入 ${MAX_ITEMS} 条商品`);
  const current = loadProductBatchPublishItems(draftStorage, now);
  const inputIds = inputs.map((input) => input.id);
  if (inputIds.some((id) => id.trim() === '')) throw new Error('商品导入文件包含无效商品 ID');
  if (new Set(inputIds).size !== inputIds.length) throw new Error('商品导入文件包含重复商品');

  const completedIds = new Set(current.filter((item) => item.status !== 'queued').map((item) => item.id));
  const importableInputs = inputs.filter((input) => !completedIds.has(input.id));
  const existingIds = new Set(current.map((item) => item.id));
  const newItemCount = importableInputs.filter((input) => !existingIds.has(input.id)).length;
  if (current.length + newItemCount > MAX_ITEMS) {
    throw new Error(`批量发布队列最多保留 ${MAX_ITEMS} 条商品，请先移除不需要的队列项`);
  }

  const imported = importableInputs.map((input, index) => {
    const existing = current.find((item) => item.id === input.id);
    return createProductBatchPublishItem(input, {
      id: input.id,
      ...(existing ? { createdAtUtc: existing.createdAtUtc } : {}),
      updatedAtUtc: Math.max(0, now - index)
    });
  });
  const importedIds = new Set(imported.map((item) => item.id));
  const merged = [...imported, ...current.filter((item) => !importedIds.has(item.id))]
    .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
    .slice(0, MAX_ITEMS);
  writeItems(draftStorage, merged);
  return {
    items: imported,
    added: imported.filter((item) => !existingIds.has(item.id)).length,
    updated: imported.filter((item) => existingIds.has(item.id)).length,
    skipped: inputs.length - importableInputs.length
  };
}

export function completeProductBatchPublishItem(
  draftStorage: DraftStorage,
  id: string,
  target: ProductBatchPublishTarget,
  productId: string,
  now = Date.now()
): ProductBatchPublishItem {
  const items = loadProductBatchPublishItems(draftStorage, now);
  const current = items.find((item) => item.id === id);
  if (!current) throw new Error('批量发布商品不存在或已过期');
  const updated: ProductBatchPublishItem = {
    ...current,
    status: target === 'draft' ? 'draft-saved' : 'published',
    platformProductId: productId,
    updatedAtUtc: now
  };
  writeItems(
    draftStorage,
    items.map((item) => (item.id === id ? updated : item))
  );
  return updated;
}

export function removeProductBatchPublishItem(
  draftStorage: DraftStorage,
  id: string,
  now = Date.now()
): void {
  writeItems(
    draftStorage,
    loadProductBatchPublishItems(draftStorage, now).filter((item) => item.id !== id)
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
    options.onStart?.(item);
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

function createProductBatchPublishItem(
  input: ProductBatchPublishItemInput,
  options: { id?: string; createdAtUtc?: number; updatedAtUtc: number }
): ProductBatchPublishItem {
  const normalizedCategoryId = normalizeCategoryId(input.categoryId);
  const normalizedXml = input.xml.trim();
  if (!normalizedXml) throw new Error('商品 Schema XML 不能为空');
  const derivedTitle = inspectProductBatchPublishXml(normalizedXml).title;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: options.id ?? globalThis.crypto.randomUUID(),
    title: normalizeTitle(input.title) || derivedTitle,
    categoryId: normalizedCategoryId,
    language: input.language,
    market: input.market,
    xml: normalizedXml,
    status: 'queued',
    platformProductId: null,
    createdAtUtc: options.createdAtUtc ?? options.updatedAtUtc,
    updatedAtUtc: options.updatedAtUtc
  };
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

function writeItems(draftStorage: DraftStorage, items: readonly ProductBatchPublishItem[]): void {
  if (items.length === 0) {
    draftStorage.removeItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
    return;
  }
  draftStorage.setItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY, JSON.stringify(items));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '批量发布请求失败';
}
