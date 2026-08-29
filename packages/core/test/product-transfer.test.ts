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

describe('product transfer JSON', () => {
  it('round-trips a versioned product Schema snapshot without losing XML', () => {
    const parsed = parseProductTransferJson(fixtureJson);
    const serialized = serializeProductTransferDocument(parsed);
    const product = parsed.products[0];
    if (!product) throw new Error('Missing transfer fixture product');

    expect(parseProductTransferJson(serialized)).toEqual(parsed);
    expect(product.schemaXml).toContain('Portable solar power station 1000W');
    expect(productTransferQueueItemId(product)).toBe('import:10000001:en_US');
  });

  it('creates normalized documents with an explicit export timestamp', () => {
    const fixture = parseProductTransferJson(fixtureJson);
    const document = createProductTransferDocument(fixture.products, new Date('2026-08-28T09:30:00Z'));

    expect(document.exportedAtUtc).toBe('2026-08-28T09:30:00.000Z');
    expect(document.products).toEqual(fixture.products);
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
  });
});
