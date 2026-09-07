import { describe, expect, it } from 'vitest';

import {
  defaultGalleryImportRuleSet,
  GALLERY_IMPORT_RULES_STORAGE_KEY,
  loadGalleryImportRuleSet,
  saveGalleryImportRuleSet
} from '../src/lib/gallery-import-rules-storage';

describe('gallery import rule storage', () => {
  it('loads defaults when local state is absent or damaged', () => {
    expect(loadGalleryImportRuleSet({ getItem: () => null })).toEqual(defaultGalleryImportRuleSet());
    expect(loadGalleryImportRuleSet({ getItem: () => '{broken' })).toEqual(defaultGalleryImportRuleSet());
  });

  it('validates before persisting rules', () => {
    const values = new Map<string, string>();
    const saved = saveGalleryImportRuleSet(defaultGalleryImportRuleSet(), {
      setItem: (key, value) => values.set(key, value)
    });
    expect(saved.rules).toHaveLength(1);
    expect(values.get(GALLERY_IMPORT_RULES_STORAGE_KEY)).toContain('default-images');
  });
});
