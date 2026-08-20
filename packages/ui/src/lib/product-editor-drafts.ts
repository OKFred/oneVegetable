import type { ProductEditorStepId } from '@one-vegetable/core';

export const PRODUCT_EDITOR_DRAFT_STORAGE_KEY = 'one-vegetable-product-editor-drafts-v2';
export const LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY = 'one-vegetable-product-schema-draft';

const SCHEMA_VERSION = 2;
const MAX_DRAFTS = 10;
const MAX_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export type ProductEditorMode = 'guided' | 'advanced';

export interface ProductEditorDraftV2 {
  schemaVersion: 2;
  draftKey: string;
  kind: 'new' | 'existing';
  productId: string | null;
  categoryId: string;
  language: string;
  market: 'wholesale' | 'sourcing';
  xml: string;
  mode: ProductEditorMode;
  step: ProductEditorStepId;
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

export function loadProductEditorDrafts(storage: DraftStorage, now = Date.now()): ProductEditorDraftV2[] {
  const raw = storage.getItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    storage.removeItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
    return [];
  }

  const drafts = Array.isArray(parsed) ? parsed.filter(isProductEditorDraft) : [];
  const retained = drafts
    .filter((draft) => now - draft.updatedAtUtc <= MAX_AGE_MILLISECONDS && draft.updatedAtUtc <= now + 60_000)
    .sort((left, right) => right.updatedAtUtc - left.updatedAtUtc)
    .slice(0, MAX_DRAFTS);

  if (retained.length !== drafts.length || !Array.isArray(parsed)) writeDrafts(storage, retained);
  return retained;
}

export function findProductEditorDraft(
  storage: DraftStorage,
  productId: string,
  categoryId: string,
  now = Date.now()
): ProductEditorDraftV2 | null {
  const key = productEditorDraftKey(productId, categoryId);
  return loadProductEditorDrafts(storage, now).find((draft) => draft.draftKey === key) ?? null;
}

export function saveProductEditorDraft(
  storage: DraftStorage,
  input: Omit<ProductEditorDraftV2, 'schemaVersion' | 'draftKey' | 'kind' | 'updatedAtUtc'>,
  now = Date.now()
): ProductEditorDraftV2 {
  const normalizedProductId = input.productId?.trim();
  const productId = normalizedProductId?.length ? normalizedProductId : null;
  const categoryId = input.categoryId.trim();
  const draft: ProductEditorDraftV2 = {
    ...input,
    schemaVersion: SCHEMA_VERSION,
    draftKey: productEditorDraftKey(productId ?? '', categoryId),
    kind: productId ? 'existing' : 'new',
    productId,
    categoryId,
    updatedAtUtc: now
  };
  const drafts = loadProductEditorDrafts(storage, now).filter(
    (candidate) => candidate.draftKey !== draft.draftKey
  );
  writeDrafts(
    storage,
    [draft, ...drafts].sort((left, right) => right.updatedAtUtc - left.updatedAtUtc).slice(0, MAX_DRAFTS)
  );
  return draft;
}

export function removeProductEditorDraft(storage: DraftStorage, draftKey: string, now = Date.now()): void {
  writeDrafts(
    storage,
    loadProductEditorDrafts(storage, now).filter((draft) => draft.draftKey !== draftKey)
  );
}

export function migrateLegacyProductEditorDraft(
  storage: DraftStorage,
  now = Date.now()
): ProductEditorDraftV2 | null {
  const raw = storage.getItem(LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || typeof value.xml !== 'string' || typeof value.categoryId !== 'string')
      return null;
    const draft = saveProductEditorDraft(
      storage,
      {
        productId: null,
        categoryId: value.categoryId,
        language: typeof value.language === 'string' ? value.language : 'en_US',
        market: value.market === 'sourcing' ? 'sourcing' : 'wholesale',
        xml: value.xml,
        mode: 'guided',
        step: 'basics'
      },
      now
    );
    storage.removeItem(LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
    return draft;
  } catch {
    return null;
  }
}

function isProductEditorDraft(value: unknown): value is ProductEditorDraftV2 {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === SCHEMA_VERSION &&
    typeof value.draftKey === 'string' &&
    (value.kind === 'new' || value.kind === 'existing') &&
    (value.productId === null || typeof value.productId === 'string') &&
    typeof value.categoryId === 'string' &&
    typeof value.language === 'string' &&
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

function writeDrafts(storage: DraftStorage, drafts: ProductEditorDraftV2[]): void {
  if (drafts.length === 0) {
    storage.removeItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY);
    return;
  }
  storage.setItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}
