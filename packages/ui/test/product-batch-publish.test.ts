// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  completeProductBatchPublishItem,
  importProductBatchPublishItems,
  inspectProductBatchPublishImport,
  inspectProductBatchPublishItem,
  loadProductBatchPublishItems,
  runProductBatchPublish,
  upsertProductBatchPublishItem
} from '../src/lib/product-batch-publish';

const NOW = Date.UTC(2026, 7, 28);
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../mock/data/product-batch-publish.json'), 'utf8')
) as { validXml: string; invalidXml: string; onlineCloneXml: string };

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

  it('allows Alibaba category rule warnings through to the publish API', () => {
    const item = upsert(
      'advisory-only',
      `<itemSchema>
        <field id="productTitle" name="商品标题" type="input"><value>Ready title</value></field>
        <field id="material" name="材质" type="input">
          <rules><rule name="requiredRule" value="true"/></rules><value/>
        </field>
      </itemSchema>`,
      NOW
    );

    expect(inspectProductBatchPublishItem(item, 'publish')).toMatchObject({
      ready: true,
      schemaIssueCount: 1,
      blockingIssues: []
    });
  });

  it('accepts an imported online product with an optional empty ladder and integer quantity price', () => {
    const item = upsert('online-clone', fixture.onlineCloneXml, NOW);

    expect(inspectProductBatchPublishItem(item, 'publish')).toMatchObject({
      ready: true,
      schemaIssueCount: 0,
      blockingIssues: []
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

  it('imports multiple products atomically and safely skips completed stable ids', () => {
    const inputs = [
      importInput('import:10000001:en_US', 'Imported first'),
      importInput('import:10000002:en_US', 'Imported second')
    ];

    expect(importProductBatchPublishItems(localStorage, inputs, NOW)).toMatchObject({
      added: 2,
      updated: 0,
      skipped: 0
    });
    expect(importProductBatchPublishItems(localStorage, inputs, NOW + 1)).toMatchObject({
      added: 0,
      updated: 2,
      skipped: 0
    });
    completeProductBatchPublishItem(
      localStorage,
      'import:10000001:en_US',
      'draft',
      'platform-product-1',
      NOW + 2
    );

    expect(importProductBatchPublishItems(localStorage, inputs, NOW + 3)).toMatchObject({
      added: 0,
      updated: 1,
      skipped: 1
    });
    expect(loadProductBatchPublishItems(localStorage, NOW + 4)).toHaveLength(2);
  });

  it('does not partially write an import when any product XML is invalid', () => {
    expect(() =>
      importProductBatchPublishItems(
        localStorage,
        [
          importInput('valid', 'Valid import'),
          { ...importInput('invalid', 'Invalid import'), xml: '<broken>' }
        ],
        NOW
      )
    ).toThrow();
    expect(loadProductBatchPublishItems(localStorage, NOW)).toEqual([]);
  });

  it('preflights an import without changing the queue', () => {
    const inspection = inspectProductBatchPublishImport(
      localStorage,
      [importInput('import:10000001:en_US', 'Preflight only')],
      NOW
    );
    expect(inspection).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(loadProductBatchPublishItems(localStorage, NOW)).toEqual([]);
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

function importInput(id: string, title: string) {
  return {
    id,
    title,
    categoryId: '201712702',
    language: 'en_US' as const,
    market: 'wholesale' as const,
    xml: fixture.validXml.replace('Batch portable power station', title)
  };
}
