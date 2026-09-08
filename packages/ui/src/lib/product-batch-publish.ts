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
  ProductMutationJob,
  ProductSchemaField,
  ProductSchemaFieldIssue,
  SchemaPublishRequest,
  UiLocale
} from '@one-vegetable/core';
import type { DraftStorage } from './product-editor-drafts';
import { translateUi } from '../i18n';

export const PRODUCT_BATCH_PUBLISH_STORAGE_KEY = 'one-vegetable-product-batch-publish-v2';
const LEGACY_PRODUCT_BATCH_PUBLISH_STORAGE_KEY = 'one-vegetable-product-batch-publish-v1';

const SCHEMA_VERSION = 2;
const MAX_ITEMS = 20;
const MAX_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const TITLE_FIELD_IDS = new Set(['producttitle', 'product_title', 'subject']);

export type ProductBatchPublishTarget = 'draft' | 'publish';
export type ProductBatchPublishStoredStatus =
  'queued' | 'submitting' | 'verifying' | 'attention-required' | 'draft-saved' | 'published';
export type ProductBatchPublishRunStatus = 'succeeded' | 'accepted' | 'failed' | 'blocked' | 'cancelled';

export interface ProductBatchPublishItem {
  schemaVersion: 2;
  id: string;
  title: string;
  categoryId: string;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  xml: string;
  status: ProductBatchPublishStoredStatus;
  platformProductId: string | null;
  target: ProductBatchPublishTarget | null;
  mutationJobId: string | null;
  traceId: string | null;
  lastError: string | null;
  attemptCount: number;
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

export type ProductBatchPublishImportInspection = Omit<ProductBatchPublishImportResult, 'items'>;

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
  job: ProductMutationJob | null;
}

export interface ProductBatchPublishRunnerOptions {
  items: readonly ProductBatchPublishItem[];
  target: ProductBatchPublishTarget;
  submit: (request: SchemaPublishRequest, item: ProductBatchPublishItem) => Promise<ProductMutationResult>;
  shouldStop?: (() => boolean) | undefined;
  onStart?: ((item: ProductBatchPublishItem) => void) | undefined;
  onResult?: ((result: ProductBatchPublishRunResult) => void) | undefined;
  locale?: UiLocale;
}

export function loadProductBatchPublishItems(
  draftStorage: DraftStorage,
  now = Date.now()
): ProductBatchPublishItem[] {
  const raw =
    draftStorage.getItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY) ??
    draftStorage.getItem(LEGACY_PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    draftStorage.removeItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
    return [];
  }

  const valid = Array.isArray(parsed) ? parsed.flatMap(migrateProductBatchPublishItem) : [];
  const retained = valid
    .filter((item) => now - item.updatedAtUtc <= MAX_AGE_MILLISECONDS && item.updatedAtUtc <= now + 60_000)
    .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
    .slice(0, MAX_ITEMS);
  if (
    !Array.isArray(parsed) ||
    retained.length !== parsed.length ||
    draftStorage.getItem(PRODUCT_BATCH_PUBLISH_STORAGE_KEY) === null
  ) {
    writeItems(draftStorage, retained);
  }
  draftStorage.removeItem(LEGACY_PRODUCT_BATCH_PUBLISH_STORAGE_KEY);
  return retained;
}

export function recoverInterruptedProductBatchPublishItems(
  draftStorage: DraftStorage,
  now = Date.now()
): ProductBatchPublishItem[] {
  const items = loadProductBatchPublishItems(draftStorage, now).map((item) =>
    item.status === 'submitting'
      ? {
          ...item,
          status: 'attention-required' as const,
          lastError: translateUi('products.batch.errors.interrupted'),
          updatedAtUtc: now
        }
      : item
  );
  writeItems(draftStorage, items);
  return items;
}

export function beginProductBatchPublishItem(
  draftStorage: DraftStorage,
  id: string,
  target: ProductBatchPublishTarget,
  now = Date.now()
): ProductBatchPublishItem {
  return updateStoredItem(draftStorage, id, now, (item) => ({
    ...item,
    status: 'submitting',
    target,
    mutationJobId: null,
    traceId: null,
    lastError: null,
    attemptCount: item.attemptCount + 1
  }));
}

export function recordProductBatchPublishResult(
  draftStorage: DraftStorage,
  result: ProductBatchPublishRunResult,
  now = Date.now()
): ProductBatchPublishItem {
  return updateStoredItem(draftStorage, result.itemId, now, (item) => {
    if (result.status === 'blocked' || result.status === 'cancelled') return item;
    if (result.status === 'failed') {
      return {
        ...item,
        status: 'attention-required',
        traceId: result.traceId,
        lastError: result.message,
        mutationJobId: result.job?.id ?? item.mutationJobId
      };
    }
    if (result.status === 'accepted' && result.job) {
      return {
        ...item,
        status: 'verifying',
        platformProductId: result.productId,
        target: result.target,
        mutationJobId: result.job.id,
        traceId: result.traceId,
        lastError: null
      };
    }
    return {
      ...item,
      status: result.target === 'draft' ? 'draft-saved' : 'published',
      platformProductId: result.productId,
      target: result.target,
      mutationJobId: result.job?.id ?? null,
      traceId: result.traceId,
      lastError: null
    };
  });
}

export function reconcileProductBatchPublishJobs(
  draftStorage: DraftStorage,
  jobs: readonly ProductMutationJob[],
  now = Date.now()
): ProductBatchPublishItem[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const items = loadProductBatchPublishItems(draftStorage, now).map((item) => {
    if (item.status !== 'verifying' || !item.mutationJobId || !item.target) return item;
    const job = byId.get(item.mutationJobId);
    if (!job) return item;
    if (job.status === 'verified') {
      return {
        ...item,
        status: item.target === 'draft' ? ('draft-saved' as const) : ('published' as const),
        platformProductId: job.productId,
        traceId: job.traceId,
        lastError: null,
        updatedAtUtc: now
      };
    }
    if (job.status === 'failed' || job.status === 'recovery-required') {
      return {
        ...item,
        status: 'attention-required' as const,
        platformProductId: job.productId,
        traceId: job.traceId,
        lastError: job.message,
        updatedAtUtc: now
      };
    }
    return item;
  });
  writeItems(draftStorage, items);
  return items;
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
    throw new Error(translateUi('products.batch.errors.queueLimit', { maximum: MAX_ITEMS }));
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
  const plan = planProductBatchPublishImport(draftStorage, inputs, now);
  writeItems(draftStorage, plan.merged);
  return importResult(plan);
}

export function inspectProductBatchPublishImport(
  draftStorage: DraftStorage,
  inputs: readonly ProductBatchPublishImportInput[],
  now = Date.now()
): ProductBatchPublishImportInspection {
  const { added, updated, skipped } = importResult(planProductBatchPublishImport(draftStorage, inputs, now));
  return { added, updated, skipped };
}

interface ProductBatchPublishImportPlan {
  imported: ProductBatchPublishItem[];
  merged: ProductBatchPublishItem[];
  existingIds: Set<string>;
  inputCount: number;
}

function planProductBatchPublishImport(
  draftStorage: DraftStorage,
  inputs: readonly ProductBatchPublishImportInput[],
  now: number
): ProductBatchPublishImportPlan {
  if (inputs.length === 0) throw new Error(translateUi('products.batch.errors.emptyImport'));
  if (inputs.length > MAX_ITEMS) {
    throw new Error(translateUi('products.batch.errors.importLimit', { maximum: MAX_ITEMS }));
  }
  const current = loadProductBatchPublishItems(draftStorage, now);
  const inputIds = inputs.map((input) => input.id);
  if (inputIds.some((id) => id.trim() === '')) {
    throw new Error(translateUi('products.batch.errors.invalidId'));
  }
  if (new Set(inputIds).size !== inputIds.length) {
    throw new Error(translateUi('products.batch.errors.duplicate'));
  }

  const completedIds = new Set(current.filter((item) => item.status !== 'queued').map((item) => item.id));
  const importableInputs = inputs.filter((input) => !completedIds.has(input.id));
  const existingIds = new Set(current.map((item) => item.id));
  const newItemCount = importableInputs.filter((input) => !existingIds.has(input.id)).length;
  if (current.length + newItemCount > MAX_ITEMS) {
    throw new Error(translateUi('products.batch.errors.queueLimitCleanup', { maximum: MAX_ITEMS }));
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
  return { imported, merged, existingIds, inputCount: inputs.length };
}

function importResult(plan: ProductBatchPublishImportPlan): ProductBatchPublishImportResult {
  return {
    items: plan.imported,
    added: plan.imported.filter((item) => !plan.existingIds.has(item.id)).length,
    updated: plan.imported.filter((item) => plan.existingIds.has(item.id)).length,
    skipped: plan.inputCount - plan.imported.length
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
  if (!current) throw new Error(translateUi('products.batch.errors.missing'));
  const updated: ProductBatchPublishItem = {
    ...current,
    status: target === 'draft' ? 'draft-saved' : 'published',
    platformProductId: productId,
    target,
    lastError: null,
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
  target: ProductBatchPublishTarget,
  locale: UiLocale = 'zh-CN'
): ProductBatchPublishPreflight {
  if (item.status !== 'queued') {
    return blockedPreflight(item.title, translateUi('products.batch.errors.alreadySubmitted'));
  }

  let inspection: ReturnType<typeof inspectProductBatchPublishXml>;
  try {
    inspection = inspectProductBatchPublishXml(item.xml, locale);
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
    ...(target === 'publish'
      ? inspection.schemaIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.message)
      : [])
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
      const cancelled = resultFor(
        item,
        options.target,
        'cancelled',
        null,
        null,
        translateUi('products.batch.errors.stopped')
      );
      results.push(cancelled);
      options.onResult?.(cancelled);
      continue;
    }
    const preflight = inspectProductBatchPublishItem(item, options.target, options.locale);
    if (!preflight.ready || !preflight.request) {
      const blocked = resultFor(
        item,
        options.target,
        'blocked',
        null,
        null,
        preflight.blockingIssues.join('; ') || translateUi('products.batch.errors.preflight')
      );
      results.push(blocked);
      options.onResult?.(blocked);
      continue;
    }
    options.onStart?.(item);
    try {
      const response = await options.submit(preflight.request, item);
      const jobFailed = response.job?.status === 'failed' || response.job?.status === 'recovery-required';
      const jobPending =
        response.job !== undefined &&
        ['submitted', 'auditing', 'verifying', 'recovering'].includes(response.job.status);
      const result = response.success
        ? resultFor(
            item,
            options.target,
            jobFailed ? 'failed' : jobPending ? 'accepted' : 'succeeded',
            response.productId,
            response.traceId,
            jobFailed ? (response.job?.message ?? translateUi('products.batch.errors.verifyFailed')) : null,
            response.job ?? null
          )
        : resultFor(
            item,
            options.target,
            'failed',
            response.productId,
            response.traceId,
            translateUi('products.batch.errors.platformNotAccepted'),
            response.job ?? null
          );
      results.push(result);
      options.onResult?.(result);
    } catch (error: unknown) {
      const failed = resultFor(item, options.target, 'failed', null, null, errorMessage(error), null);
      results.push(failed);
      options.onResult?.(failed);
    }
  }
  return results;
}

function inspectProductBatchPublishXml(
  xml: string,
  locale: UiLocale = 'zh-CN'
): {
  xml: string;
  title: string;
  structuralDiffs: string[];
  schemaIssues: ProductSchemaFieldIssue[];
} {
  const model = parseProductSchemaXml(xml, undefined, locale);
  const serialization = inspectProductSchemaSerialization(model, locale);
  const title = findTitle(model.fields) || translateUi('products.batch.errors.unnamed');
  return {
    xml: serialization.xml,
    title,
    structuralDiffs: serialization.safe ? [] : serialization.structuralDiffs,
    schemaIssues: validateProductSchemaModel(model, locale)
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
  message: string | null,
  job: ProductMutationJob | null = null
): ProductBatchPublishRunResult {
  return { itemId: item.id, title: item.title, target, status, productId, traceId, message, job };
}

function normalizeCategoryId(value: string): string {
  const normalized = value.trim();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(translateUi('products.batch.errors.categoryPositive'));
  }
  return normalized;
}

function createProductBatchPublishItem(
  input: ProductBatchPublishItemInput,
  options: { id?: string; createdAtUtc?: number; updatedAtUtc: number }
): ProductBatchPublishItem {
  const normalizedCategoryId = normalizeCategoryId(input.categoryId);
  const normalizedXml = input.xml.trim();
  if (!normalizedXml) throw new Error(translateUi('products.batch.errors.xmlRequired'));
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
    target: null,
    mutationJobId: null,
    traceId: null,
    lastError: null,
    attemptCount: 0,
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
    ['queued', 'submitting', 'verifying', 'attention-required', 'draft-saved', 'published'].includes(
      value.status as string
    ) &&
    (value.platformProductId === null || typeof value.platformProductId === 'string') &&
    (value.target === null || value.target === 'draft' || value.target === 'publish') &&
    (value.mutationJobId === null || typeof value.mutationJobId === 'string') &&
    (value.traceId === null || typeof value.traceId === 'string') &&
    (value.lastError === null || typeof value.lastError === 'string') &&
    typeof value.attemptCount === 'number' &&
    Number.isSafeInteger(value.attemptCount) &&
    value.attemptCount >= 0 &&
    isTimestamp(value.createdAtUtc) &&
    isTimestamp(value.updatedAtUtc)
  );
}

function migrateProductBatchPublishItem(value: unknown): ProductBatchPublishItem[] {
  if (isProductBatchPublishItem(value)) return [value];
  if (!isRecord(value) || value.schemaVersion !== 1) return [];
  const migrated = {
    ...value,
    schemaVersion: SCHEMA_VERSION,
    target: null,
    mutationJobId: null,
    traceId: null,
    lastError: null,
    attemptCount: 0
  };
  return isProductBatchPublishItem(migrated) ? [migrated] : [];
}

function updateStoredItem(
  draftStorage: DraftStorage,
  id: string,
  now: number,
  update: (item: ProductBatchPublishItem) => ProductBatchPublishItem
): ProductBatchPublishItem {
  const items = loadProductBatchPublishItems(draftStorage, now);
  const current = items.find((item) => item.id === id);
  if (!current) throw new Error(translateUi('products.batch.errors.missing'));
  const updated = { ...update(current), updatedAtUtc: now };
  writeItems(
    draftStorage,
    items.map((item) => (item.id === id ? updated : item))
  );
  return updated;
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
  return error instanceof Error ? error.message : translateUi('products.batch.errors.requestFailed');
}
