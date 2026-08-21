import {
  isAlibabaLanguage,
  type AlibabaLanguage,
  type ProductEditorStepId,
  type ProductSchemaSerializationInspection
} from '@one-vegetable/core';

export const PRODUCT_EDITOR_DRAFT_STORAGE_KEY = 'one-vegetable-product-editor-drafts-v3';
export const PRODUCT_EDITOR_DRAFT_V2_STORAGE_KEY = 'one-vegetable-product-editor-drafts-v2';
export const LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY = 'one-vegetable-product-schema-draft';

const SCHEMA_VERSION = 3;
const MAX_DRAFTS = 10;
const MAX_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export type ProductEditorMode = 'quick' | 'guided' | 'advanced';

export interface ProductEditorDraftV3 {
  schemaVersion: 3;
  draftKey: string;
  kind: 'new' | 'existing';
  productId: string | null;
  categoryId: string;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  xml: string;
  mode: ProductEditorMode;
  step: ProductEditorStepId;
  platformDraftId: string | null;
  updatedAtUtc: number;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function productEditorDraftKey(productId: string, categoryId: string): string {
  return productId.trim() ? `existing:${productId.trim()}` : `new:${categoryId.trim()}`;
}

export function shouldPersistProductEditorDraft(inspection: ProductSchemaSerializationInspection): boolean {
  return inspection.safe && !inspection.noOp;
}

export function loadProductEditorDrafts(
  draftStorage: DraftStorage,
  now = Date.now()
): ProductEditorDraftV3[] {
  const raw = draftStorage.getItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    draftStorage.removeItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
    return [];
  }

  const drafts = Array.isArray(parsed) ? parsed.filter(isProductEditorDraft) : [];
  const retained = drafts
    .filter((draft) => now - draft.updatedAtUtc <= MAX_AGE_MILLISECONDS && draft.updatedAtUtc <= now + 60_000)
    .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
    .slice(0, MAX_DRAFTS);

  if (retained.length !== drafts.length || !Array.isArray(parsed)) writeDrafts(draftStorage, retained);
  return retained;
}

export function findProductEditorDraft(
  draftStorage: DraftStorage,
  productId: string,
  categoryId: string,
  now = Date.now()
): ProductEditorDraftV3 | null {
  const key = productEditorDraftKey(productId, categoryId);
  return loadProductEditorDrafts(draftStorage, now).find((draft) => draft.draftKey === key) ?? null;
}

export function saveProductEditorDraft(
  draftStorage: DraftStorage,
  input: Omit<ProductEditorDraftV3, 'schemaVersion' | 'draftKey' | 'kind' | 'updatedAtUtc'>,
  now = Date.now()
): ProductEditorDraftV3 {
  const normalizedProductId = input.productId?.trim();
  const productId = normalizedProductId?.length ? normalizedProductId : null;
  const categoryId = input.categoryId.trim();
  const draft: ProductEditorDraftV3 = {
    ...input,
    schemaVersion: SCHEMA_VERSION,
    draftKey: productEditorDraftKey(productId ?? '', categoryId),
    kind: productId ? 'existing' : 'new',
    productId,
    categoryId,
    updatedAtUtc: now
  };
  const drafts = loadProductEditorDrafts(draftStorage, now).filter(
    (candidate) => candidate.draftKey !== draft.draftKey
  );
  writeDrafts(
    draftStorage,
    [draft, ...drafts].sort((left, right) => right.updatedAtUtc - left.updatedAtUtc).slice(0, MAX_DRAFTS)
  );
  return draft;
}

export function removeProductEditorDraft(
  draftStorage: DraftStorage,
  draftKey: string,
  now = Date.now()
): void {
  writeDrafts(
    draftStorage,
    loadProductEditorDrafts(draftStorage, now).filter((draft) => draft.draftKey !== draftKey)
  );
}

export function migrateLegacyProductEditorDraft(
  draftStorage: DraftStorage,
  now = Date.now()
): ProductEditorDraftV3 | null {
  const raw = draftStorage.getItem(LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || typeof value.xml !== 'string' || typeof value.categoryId !== 'string')
      return null;
    const draft = saveProductEditorDraft(
      draftStorage,
      {
        productId: null,
        categoryId: value.categoryId,
        language: isAlibabaLanguage(value.language) ? value.language : 'en_US',
        market: value.market === 'sourcing' ? 'sourcing' : 'wholesale',
        xml: value.xml,
        mode: 'guided',
        step: 'basics',
        platformDraftId: null
      },
      now
    );
    draftStorage.removeItem(LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
    return draft;
  } catch {
    return null;
  }
}

export function migrateProductEditorDraftsV2(
  draftStorage: DraftStorage,
  now = Date.now()
): ProductEditorDraftV3[] {
  const raw = draftStorage.getItem(PRODUCT_EDITOR_DRAFT_V2_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.filter(isProductEditorDraftV2).map((draft) => ({
      productId: draft.productId,
      categoryId: draft.categoryId,
      language: draft.language,
      market: draft.market,
      xml: draft.xml,
      mode: draft.mode,
      step: draft.step,
      platformDraftId: null
    }));
    const results = migrated.map((draft, index) => saveProductEditorDraft(draftStorage, draft, now + index));
    draftStorage.removeItem(PRODUCT_EDITOR_DRAFT_V2_STORAGE_KEY);
    return results;
  } catch {
    return [];
  }
}

function isProductEditorDraft(value: unknown): value is ProductEditorDraftV3 {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === SCHEMA_VERSION &&
    typeof value.draftKey === 'string' &&
    (value.kind === 'new' || value.kind === 'existing') &&
    (value.productId === null || typeof value.productId === 'string') &&
    typeof value.categoryId === 'string' &&
    isAlibabaLanguage(value.language) &&
    (value.market === 'wholesale' || value.market === 'sourcing') &&
    typeof value.xml === 'string' &&
    (value.mode === 'quick' || value.mode === 'guided' || value.mode === 'advanced') &&
    isProductEditorStep(value.step) &&
    (value.platformDraftId === null || typeof value.platformDraftId === 'string') &&
    typeof value.updatedAtUtc === 'number' &&
    Number.isSafeInteger(value.updatedAtUtc)
  );
}

interface ProductEditorDraftV2 {
  schemaVersion: 2;
  draftKey: string;
  kind: 'new' | 'existing';
  productId: string | null;
  categoryId: string;
  language: AlibabaLanguage;
  market: 'wholesale' | 'sourcing';
  xml: string;
  mode: 'guided' | 'advanced';
  step: ProductEditorStepId;
  updatedAtUtc: number;
}

function isProductEditorDraftV2(value: unknown): value is ProductEditorDraftV2 {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 2 &&
    typeof value.draftKey === 'string' &&
    (value.kind === 'new' || value.kind === 'existing') &&
    (value.productId === null || typeof value.productId === 'string') &&
    typeof value.categoryId === 'string' &&
    isAlibabaLanguage(value.language) &&
    (value.market === 'wholesale' || value.market === 'sourcing') &&
    typeof value.xml === 'string' &&
    (value.mode === 'guided' || value.mode === 'advanced') &&
    isProductEditorStep(value.step) &&
    typeof value.updatedAtUtc === 'number' &&
    Number.isSafeInteger(value.updatedAtUtc)
  );
}

function isProductEditorStep(value: unknown): value is ProductEditorStepId {
  return (
    value === 'basics' ||
    value === 'attributes' ||
    value === 'media' ||
    value === 'description' ||
    value === 'trade' ||
    value === 'review'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function writeDrafts(draftStorage: DraftStorage, drafts: ProductEditorDraftV3[]): void {
  if (drafts.length === 0) {
    draftStorage.removeItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
    return;
  }
  draftStorage.setItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}
