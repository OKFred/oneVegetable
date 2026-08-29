// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createProductTransferDocument,
  parseProductTransferJson,
  productTransferQueueItemId,
  serializeProductTransferDocument
} from '../src/product-transfer';

const fixtureJson = readFileSync(
  resolve(import.meta.dirname, '../../../mock/data/product-transfer-v1.json'),
  'utf8'
);
const schemaJsonFixture = readFileSync(
  resolve(import.meta.dirname, '../../../mock/data/product-transfer-schema-json-v1.json'),
  'utf8'
);

describe('product transfer JSON', () => {
  it('round-trips a versioned product Schema snapshot without losing XML', () => {
    const parsed = parseProductTransferJson(fixtureJson);
    const serialized = serializeProductTransferDocument(parsed);
    const product = parsed.products[0];
    if (!product) throw new Error('Missing transfer fixture product');

    expect(parseProductTransferJson(serialized)).toEqual(parsed);
    expect(product.schemaXml).toContain('Portable solar power station 1000W');
    expect(product.schemaJson.root.name).toBe('itemSchema');
    expect(productTransferQueueItemId(product)).toBe('import:10000001:en_US');
  });

  it('uses Schema JSON when Schema XML is missing and emits both normalized representations', () => {
    const parsed = parseProductTransferJson(schemaJsonFixture);
    const product = parsed.products[0];
    if (!product) throw new Error('Missing Schema JSON fallback fixture product');

    expect(product.schemaXml).toContain('Schema JSON fallback product');
    expect(product.schemaJson.root.attributes).toEqual({ version: 'trade.1.1' });
    expect(parseProductTransferJson(serializeProductTransferDocument(parsed))).toEqual(parsed);
  });

  it('prefers Schema XML when both representations are present', () => {
    const fixture = JSON.parse(schemaJsonFixture) as Record<string, unknown>;
    const products = fixture.products as Record<string, unknown>[];
    const product = products[0];
    if (!product) throw new Error('Missing Schema JSON fallback fixture product');
    product.schemaXml =
      '<itemSchema><field id="productTitle" type="input"><value>Preferred XML</value></field></itemSchema>';
    product.schemaJson = 'invalid but ignored because schemaXml is present';

    const parsed = parseProductTransferJson(JSON.stringify(fixture));
    expect(parsed.products[0]?.schemaXml).toContain('Preferred XML');
    expect(JSON.stringify(parsed.products[0]?.schemaJson)).toContain('Preferred XML');
    expect(JSON.stringify(parsed.products[0]?.schemaJson)).not.toContain('Schema JSON fallback product');
  });

  it('creates normalized documents with an explicit export timestamp', () => {
    const fixture = parseProductTransferJson(fixtureJson);
    const document = createProductTransferDocument(fixture.products, new Date('2026-08-28T09:30:00Z'));

    expect(document.exportedAtUtc).toBe('2026-08-28T09:30:00.000Z');
    expect(document.products).toEqual(fixture.products);
  });

  it('serializes a JSON file with the selected Schema field and imports either representation', () => {
    const document = parseProductTransferJson(fixtureJson);
    const jsonOnly = serializeProductTransferDocument(document, { schemaFormat: 'json' });
    const xmlOnly = serializeProductTransferDocument(document, { schemaFormat: 'xml' });

    expect(schemaFields(jsonOnly)).toEqual({ schemaJson: true, schemaXml: false });
    expect(schemaFields(xmlOnly)).toEqual({ schemaJson: false, schemaXml: true });
    expect(parseProductTransferJson(jsonOnly)).toEqual(document);
    expect(parseProductTransferJson(xmlOnly)).toEqual(document);
  });

  it('rejects unknown versions, duplicate sources, and malformed Schema XML', () => {
    const fixture = JSON.parse(fixtureJson) as Record<string, unknown>;
    expect(() => parseProductTransferJson(JSON.stringify({ ...fixture, schemaVersion: 2 }))).toThrow(
      '不支持的商品导入版本'
    );

    const products = fixture.products as unknown[];
    expect(() =>
      parseProductTransferJson(JSON.stringify({ ...fixture, products: [...products, ...products] }))
    ).toThrow('重复的来源商品和语言');

    const first = products[0] as Record<string, unknown>;
    expect(() =>
      parseProductTransferJson(
        JSON.stringify({ ...fixture, products: [{ ...first, schemaXml: '<itemSchema>' }] })
      )
    ).toThrow('Schema XML');

    expect(() =>
      parseProductTransferJson(
        JSON.stringify({ ...fixture, products: [{ ...first, schemaXml: undefined, schemaJson: undefined }] })
      )
    ).toThrow('Schema XML 或 Schema JSON');
  });
});

function schemaFields(json: string): { schemaJson: boolean; schemaXml: boolean } {
  const value = JSON.parse(json) as { products: Record<string, unknown>[] };
  const product = value.products[0];
  if (!product) throw new Error('Missing serialized transfer product');
  return { schemaJson: 'schemaJson' in product, schemaXml: 'schemaXml' in product };
}
