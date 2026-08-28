// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  completeProductBatchPublishItem,
  inspectProductBatchPublishItem,
  loadProductBatchPublishItems,
  runProductBatchPublish,
  upsertProductBatchPublishItem
} from '../src/lib/product-batch-publish';

const NOW = Date.UTC(2026, 7, 28);
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../mock/data/product-batch-publish.json'), 'utf8')
) as { validXml: string; invalidXml: string };

describe('product batch publish queue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps multiple products in the same category by stable queue id', () => {
    upsert('first', fixture.validXml, NOW);
    upsert('second', fixture.validXml.replace('Batch portable', 'Second portable'), NOW + 1);

    const items = loadProductBatchPublishItems(localStorage, NOW + 2);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(['second', 'first']);
    expect(items.every((item) => item.categoryId === '201712702')).toBe(true);
  });

  it('allows safe incomplete XML for platform drafts but blocks direct publishing', () => {
    const item = upsert('invalid', fixture.invalidXml, NOW);

    expect(inspectProductBatchPublishItem(item, 'draft')).toMatchObject({
      ready: true,
      schemaIssueCount: 1
    });
    expect(inspectProductBatchPublishItem(item, 'publish')).toMatchObject({
      ready: false,
      schemaIssueCount: 1
    });
  });

  it('submits strictly in sequence and continues after one failure', async () => {
    const first = upsert('first', fixture.validXml, NOW);
    const second = upsert('second', fixture.validXml, NOW + 1);
    let active = 0;
    let maximumActive = 0;
    const order: string[] = [];

    const results = await runProductBatchPublish({
      items: [first, second],
      target: 'draft',
      submit: async (_request, item) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(item.id);
        await Promise.resolve();
        active -= 1;
        if (item.id === 'first') throw new Error('first failed');
        return { productId: 'platform-second', traceId: 'trace-second', success: true };
      }
    });

    expect(maximumActive).toBe(1);
    expect(order).toEqual(['first', 'second']);
    expect(results.map((result) => result.status)).toEqual(['failed', 'succeeded']);
  });

  it('marks an accepted item so it cannot be submitted twice', () => {
    const item = upsert('first', fixture.validXml, NOW);
    const completed = completeProductBatchPublishItem(
      localStorage,
      item.id,
      'draft',
      'platform-product-1',
      NOW + 1
    );

    expect(completed).toMatchObject({ status: 'draft-saved', platformProductId: 'platform-product-1' });
    expect(inspectProductBatchPublishItem(completed, 'draft')).toMatchObject({ ready: false });
  });
});

function upsert(id: string, xml: string, now: number) {
  return upsertProductBatchPublishItem(
    localStorage,
    {
      categoryId: '201712702',
      language: 'en_US',
      market: 'wholesale',
      xml
    },
    { id, now }
  );
}
