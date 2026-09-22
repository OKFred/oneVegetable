export const LEGACY_EDITOR_NOTICE_KEY = 'one-vegetable:legacy-editor-drafts:notice:v1';
const productDraftKeys = new Set([
  'one-vegetable-product-editor-drafts-v3',
  'one-vegetable-product-editor-drafts-v2',
  'one-vegetable-product-schema-draft'
]);
export function legacyEditorDraftKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && (productDraftKeys.has(key) || key.startsWith('one-vegetable:rfq-draft:'))) keys.push(key);
  }
  return keys;
}
export function claimLegacyEditorNotice(storage: Storage): string[] {
  if (storage.getItem(LEGACY_EDITOR_NOTICE_KEY) === 'shown') return [];
  const keys = legacyEditorDraftKeys(storage);
  if (keys.length) storage.setItem(LEGACY_EDITOR_NOTICE_KEY, 'shown');
  return keys;
}
/** Delete only keys captured by the consent prompt, never queues, tasks or settings. */
export function clearLegacyEditorDrafts(storage: Storage, consentedKeys: readonly string[]): void {
  for (const key of consentedKeys) {
    if (productDraftKeys.has(key) || key.startsWith('one-vegetable:rfq-draft:')) storage.removeItem(key);
  }
}
