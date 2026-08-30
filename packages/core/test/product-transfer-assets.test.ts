// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  collectProductSchemaAssetReferences,
  normalizeProductTransferAssetPath,
  replaceProductSchemaAssetReferences
} from '../src/product-transfer-assets';
import { parseProductSchemaXml, serializeProductSchemaXml } from '../src/product-schema';

const cover = 'https://sc04.alicdn.com/kf/cover.jpg';
const sku = 'https://sc04.alicdn.com/kf/sku.png';
const detail = 'https://sc04.alicdn.com/kf/detail.webp';

const schemaXml = `<itemSchema>
  <field id="scImages" name="商品图片" type="multiInput">
    <value fileId="old-cover" inputValue="cover">${cover}</value>
  </field>
  <field id="variants" name="销售规格" type="multiComplex">
    <complex-values><complex-value>
      <field id="skuImage" name="SKU 图片" type="input"><value fileId="old-sku">${sku}</value></field>
    </complex-value></complex-values>
  </field>
  <field id="superText" name="商品详情" type="input">
    <rules><rule name="valueTypeRule" value="html"/></rules>
    <value>&lt;p&gt;Detail&lt;/p&gt;&lt;img src=&quot;${detail}&quot; data-photobank-file-id=&quot;old-detail&quot;&gt;</value>
  </field>
  <field id="imageVideo" name="产品视频" type="input"><value>https://sc04.alicdn.com/video.mp4</value></field>
</itemSchema>`;

describe('product transfer image references', () => {
  it('collects root, nested SKU and description images without treating video as an image', () => {
    const references = collectProductSchemaAssetReferences(parseProductSchemaXml(schemaXml));
    expect(references.map((reference) => [reference.source, reference.kind])).toEqual([
      [cover, 'schema-value'],
      [sku, 'schema-value'],
      [detail, 'description-image']
    ]);
  });

  it('removes account-specific file IDs for archive paths and restores new gallery metadata', () => {
    const exported = replaceProductSchemaAssetReferences(
      parseProductSchemaXml(schemaXml),
      new Map([
        [cover, { url: 'assets/cover.jpg', fileId: null }],
        [sku, { url: 'assets/sku.png', fileId: null }],
        [detail, { url: 'assets/detail.webp', fileId: null }]
      ])
    );
    const archiveXml = serializeProductSchemaXml(exported);
    expect(archiveXml).toContain('assets/cover.jpg');
    expect(archiveXml).toContain('assets/sku.png');
    expect(archiveXml).toContain('src="assets/detail.webp"');
    expect(archiveXml).not.toContain('old-cover');
    expect(archiveXml).not.toContain('old-sku');
    expect(archiveXml).not.toContain('old-detail');

    const imported = replaceProductSchemaAssetReferences(
      parseProductSchemaXml(archiveXml),
      new Map([
        [
          'assets/cover.jpg',
          { url: 'https://sc04.alicdn.com/kf/new-cover.jpg', fileId: 'new-cover', fileName: 'cover.jpg' }
        ],
        [
          'assets/sku.png',
          { url: 'https://sc04.alicdn.com/kf/new-sku.png', fileId: 'new-sku', fileName: 'sku.png' }
        ],
        [
          'assets/detail.webp',
          {
            url: 'https://sc04.alicdn.com/kf/new-detail.webp',
            fileId: 'new-detail',
            width: 1000,
            height: 1000
          }
        ]
      ])
    );
    const importedXml = serializeProductSchemaXml(imported);
    expect(importedXml).toContain('fileId="new-cover"');
    expect(importedXml).toContain('fileId="new-sku"');
    expect(importedXml).toContain('data-photobank-file-id="new-detail"');
    expect(importedXml).toContain('https://sc04.alicdn.com/kf/new-detail.webp');
  });

  it('accepts only canonical paths below assets', () => {
    expect(normalizeProductTransferAssetPath('assets/photo.jpg')).toBe('assets/photo.jpg');
    expect(normalizeProductTransferAssetPath('assets/nested/photo.jpg')).toBe('assets/nested/photo.jpg');
    for (const invalid of [
      '../assets/photo.jpg',
      '/assets/photo.jpg',
      'assets/../photo.jpg',
      'assets\\photo.jpg',
      'assets/%2e%2e/photo.jpg',
      'assets/photo.jpg?x=1',
      'assets/'
    ]) {
      expect(normalizeProductTransferAssetPath(invalid)).toBeNull();
    }
  });
});
