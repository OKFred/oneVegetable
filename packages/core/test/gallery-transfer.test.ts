import { describe, expect, it } from 'vitest';

import {
  evaluateGalleryImportRules,
  GALLERY_TRANSFER_MAX_ARCHIVE_BYTES,
  validateGalleryImportRuleSet,
  validateGalleryTransferDocument
} from '../src/gallery-transfer';

const RULES = {
  schemaVersion: 1,
  conflictPolicy: 'rename',
  rules: [
    {
      id: 'product-main',
      name: '商品主图',
      enabled: true,
      sourcePrefix: 'catalog',
      includeGlob: '**/*.jpg',
      excludeGlobs: ['**/draft-*'],
      targetGroupPath: '商品/主图'
    },
    {
      id: 'details',
      name: '详情素材',
      enabled: true,
      sourcePrefix: '',
      includeGlob: '**/*.png',
      excludeGlobs: [],
      targetGroupPath: '商品/详情'
    }
  ]
} as const;

describe('gallery transfer rules', () => {
  it('validates a deterministic first-match rule set', () => {
    expect(validateGalleryImportRuleSet(RULES)).toEqual(RULES);
    expect(() => validateGalleryImportRuleSet({ ...RULES, rules: [RULES.rules[0], RULES.rules[0]] })).toThrow(
      /重复/u
    );
    expect(() =>
      validateGalleryImportRuleSet({
        ...RULES,
        rules: [{ ...RULES.rules[0], sourcePrefix: '../secrets' }]
      })
    ).toThrow(/不安全/u);
  });

  it('maps matching images and reports excluded or unmatched files', () => {
    const decisions = evaluateGalleryImportRules(
      [
        candidate('catalog/shirts/front.jpg'),
        candidate('catalog/shirts/draft-front.jpg'),
        candidate('marketing/detail.png'),
        candidate('notes/readme.txt', 'text/plain')
      ],
      validateGalleryImportRuleSet(RULES)
    );
    expect(decisions).toMatchObject([
      { action: 'import', matchedRuleId: 'product-main', targetGroupPath: '商品/主图' },
      { action: 'skip', matchedRuleId: 'product-main', reason: 'excluded' },
      { action: 'import', matchedRuleId: 'details', targetGroupPath: '商品/详情' },
      { action: 'skip', matchedRuleId: null, reason: 'unmatched' }
    ]);
  });

  it('validates gallery manifests and rejects traversal or duplicate assets', () => {
    const asset = {
      path: 'assets/front.jpg',
      fileName: 'front.jpg',
      sourcePhotoId: 'photo-1',
      groupPath: '商品/主图',
      contentType: 'image/jpeg',
      byteLength: 1024,
      sha256: 'a'.repeat(64),
      width: 1200,
      height: 1200,
      modifiedTimeUtc: 1_788_793_200_000
    };
    expect(
      validateGalleryTransferDocument({
        schemaVersion: 1,
        kind: 'one-vegetable-gallery-transfer',
        createdTimeUtc: 1_788_793_200_000,
        assets: [asset]
      })
    ).toMatchObject({ assets: [{ path: 'assets/front.jpg' }] });
    expect(() =>
      validateGalleryTransferDocument({
        schemaVersion: 1,
        kind: 'one-vegetable-gallery-transfer',
        createdTimeUtc: 1,
        assets: [{ ...asset, path: 'assets/../secret.jpg' }]
      })
    ).toThrow(/不安全/u);
    expect(GALLERY_TRANSFER_MAX_ARCHIVE_BYTES).toBe(50 * 1024 * 1024);
  });
});

function candidate(sourcePath: string, contentType = 'image/jpeg') {
  return { sourcePath, fileName: sourcePath.split('/').at(-1) ?? '', byteLength: 1024, contentType };
}
