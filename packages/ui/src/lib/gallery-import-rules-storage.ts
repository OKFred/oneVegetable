import { validateGalleryImportRuleSet, type GalleryImportRuleSet } from '@one-vegetable/core';

export const GALLERY_IMPORT_RULES_STORAGE_KEY = 'one-vegetable:gallery-import-rules:v1';

export function defaultGalleryImportRuleSet(): GalleryImportRuleSet {
  return {
    schemaVersion: 1,
    conflictPolicy: 'rename',
    rules: [
      {
        id: 'default-images',
        name: 'Images',
        enabled: true,
        sourcePrefix: '',
        includeGlob: '**',
        excludeGlobs: [],
        targetGroupPath: 'Imported'
      }
    ]
  };
}

export function loadGalleryImportRuleSet(
  storageArea: Pick<Storage, 'getItem'> = globalThis.localStorage
): GalleryImportRuleSet {
  const value = storageArea.getItem(GALLERY_IMPORT_RULES_STORAGE_KEY);
  if (!value) return defaultGalleryImportRuleSet();
  try {
    return validateGalleryImportRuleSet(JSON.parse(value) as unknown);
  } catch {
    return defaultGalleryImportRuleSet();
  }
}

export function saveGalleryImportRuleSet(
  ruleSet: GalleryImportRuleSet,
  storageArea: Pick<Storage, 'setItem'> = globalThis.localStorage
): GalleryImportRuleSet {
  const validated = validateGalleryImportRuleSet(ruleSet);
  storageArea.setItem(GALLERY_IMPORT_RULES_STORAGE_KEY, JSON.stringify(validated));
  return validated;
}
