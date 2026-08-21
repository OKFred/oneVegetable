// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY,
  PRODUCT_EDITOR_DRAFT_STORAGE_KEY,
  PRODUCT_EDITOR_DRAFT_V2_STORAGE_KEY,
  findProductEditorDraft,
  loadProductEditorDrafts,
  migrateLegacyProductEditorDraft,
  migrateProductEditorDraftsV2,
  productEditorDraftKey,
  removeProductEditorDraft,
  saveProductEditorDraft,
  shouldPersistProductEditorDraft
} from '../src/lib/product-editor-drafts';

const NOW = 1_800_000_000_000;

describe('product editor draft storage', () => {
  it('persists only safe XML patches and ignores initial source or structural errors', () => {
    expect(
      shouldPersistProductEditorDraft({
        xml: '<source/>',
        noOp: true,
        changedFieldKeys: [],
        structuralDiffs: [],
        safe: true
      })
    ).toBe(false);
    expect(
      shouldPersistProductEditorDraft({
        xml: '<patched/>',
        noOp: false,
        changedFieldKeys: ['field:0'],
        structuralDiffs: [],
        safe: true
      })
    ).toBe(true);
    expect(
      shouldPersistProductEditorDraft({
        xml: '<unsafe/>',
        noOp: false,
        changedFieldKeys: ['field:0'],
        structuralDiffs: ['source binding missing'],
        safe: false
      })
    ).toBe(false);
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('isolates existing products and new category drafts', () => {
    saveDraft({ productId: 'p-1', categoryId: '100', xml: '<p-1/>', now: NOW });
    saveDraft({ productId: 'p-2', categoryId: '100', xml: '<p-2/>', now: NOW + 1 });
    saveDraft({ productId: null, categoryId: '100', xml: '<new/>', now: NOW + 2 });

    expect(findProductEditorDraft(localStorage, 'p-1', '100', NOW + 3)?.xml).toBe('<p-1/>');
    expect(findProductEditorDraft(localStorage, 'p-2', '100', NOW + 3)?.xml).toBe('<p-2/>');
    expect(findProductEditorDraft(localStorage, '', '100', NOW + 3)?.xml).toBe('<new/>');

    removeProductEditorDraft(localStorage, productEditorDraftKey('p-1', '100'), NOW + 3);
    expect(findProductEditorDraft(localStorage, 'p-1', '100', NOW + 3)).toBeNull();
    expect(findProductEditorDraft(localStorage, 'p-2', '100', NOW + 3)).not.toBeNull();
  });

  it('keeps only the ten newest drafts and removes drafts older than thirty days', () => {
    for (let index = 0; index < 12; index += 1) {
      saveDraft({ productId: `p-${index}`, categoryId: '100', xml: `<p-${index}/>`, now: NOW + index });
    }
    expect(loadProductEditorDrafts(localStorage, NOW + 12)).toHaveLength(10);
    expect(findProductEditorDraft(localStorage, 'p-0', '100', NOW + 12)).toBeNull();

    expect(loadProductEditorDrafts(localStorage, NOW + 31 * 24 * 60 * 60 * 1000)).toEqual([]);
    expect(localStorage.getItem(PRODUCT_EDITOR_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('migrates the legacy single draft into a confirmed new-product draft', () => {
    localStorage.setItem(
      LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY,
      JSON.stringify({ categoryId: '509', language: 'en_US', market: 'sourcing', xml: '<legacy/>' })
    );

    const migrated = migrateLegacyProductEditorDraft(localStorage, NOW);

    expect(migrated).toMatchObject({
      schemaVersion: 3,
      draftKey: 'new:509',
      kind: 'new',
      categoryId: '509',
      market: 'sourcing',
      xml: '<legacy/>',
      platformDraftId: null
    });
    expect(localStorage.getItem(LEGACY_PRODUCT_EDITOR_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('migrates isolated V2 drafts to V3 without losing mode or XML', () => {
    localStorage.setItem(
      PRODUCT_EDITOR_DRAFT_V2_STORAGE_KEY,
      JSON.stringify([
        {
          schemaVersion: 2,
          draftKey: 'new:509',
          kind: 'new',
          productId: null,
          categoryId: '509',
          language: 'en_US',
          market: 'wholesale',
          xml: '<v2/>',
          mode: 'advanced',
          step: 'description',
          updatedAtUtc: NOW
        }
      ])
    );

    expect(migrateProductEditorDraftsV2(localStorage, NOW)).toMatchObject([
      {
        schemaVersion: 3,
        draftKey: 'new:509',
        xml: '<v2/>',
        mode: 'advanced',
        platformDraftId: null
      }
    ]);
    expect(localStorage.getItem(PRODUCT_EDITOR_DRAFT_V2_STORAGE_KEY)).toBeNull();
  });
});

function saveDraft(input: { productId: string | null; categoryId: string; xml: string; now: number }): void {
  saveProductEditorDraft(
    localStorage,
    {
      productId: input.productId,
      categoryId: input.categoryId,
      language: 'en_US',
      market: 'wholesale',
      xml: input.xml,
      mode: 'guided',
      step: 'basics',
      platformDraftId: null
    },
    input.now
  );
}
