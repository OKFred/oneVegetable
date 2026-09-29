// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import layouts from '../../../mock/data/product-schema/batch-keyword-layouts.json';
import {
  maintainKeywords,
  previewProductBatchMaintenance,
  productBatchTargetFingerprint
} from '../src/product-batch-maintenance';
const xml = readFileSync(resolve('mock/data/product-schema/batch-maintenance.xml'), 'utf8');
describe('existing product batch maintenance', () => {
  it('keeps existing duplicates and original order, normalizes only new input', () => {
    expect(
      maintainKeywords(['Cotton', 'cotton', ' Soft '], {
        action: 'append',
        values: [' COTTON ', 'New', 'new', '']
      })
    ).toEqual(['Cotton', 'cotton', ' Soft ', 'New']);
    expect(
      maintainKeywords(['Cotton shirt', 'shirt', 'Shirt'], { action: 'remove', values: ['shirt'] })
    ).toEqual(['Cotton shirt']);
    expect(maintainKeywords(['old'], { action: 'replace', values: [' x ', 'X', 'y'] })).toEqual(['x', 'y']);
  });
  it('patches only two target roots, keeps XML escaping and parent paths', async () => {
    const preview = await previewProductBatchMaintenance(xml, {
      groupPath: [
        { id: 20, name: 'A' },
        { id: 21, name: 'B' }
      ],
      keywords: { action: 'append', values: ['New & related'] }
    });
    expect(preview.status).toBe('ready');
    expect(preview.after.groups).toEqual(['20', '21']);
    expect(preview.patchXml).toContain('New &amp; related');
    expect(preview.patchXml).not.toContain('subject');
    expect(preview.patchXml).not.toContain('superText');
  });
  it('rejects the whole product if keyword slots overflow even when its group can change', async () => {
    const preview = await previewProductBatchMaintenance(xml, {
      groupPath: [{ id: 20, name: 'A' }],
      keywords: { action: 'append', values: ['a', 'b'] }
    });
    expect(preview).toMatchObject({ status: 'unsupported', reason: 'slots', patchXml: '' });
  });
  it.each(['multiInput', 'repeated'] as const)('supports %s append and remove', async (layout) => {
    const append = await previewProductBatchMaintenance(layouts[layout], {
      groupPath: null,
      keywords: { action: 'append', values: ['linen'] }
    });
    expect(append.status).toBe('ready');
    const remove = await previewProductBatchMaintenance(layouts[layout], {
      groupPath: null,
      keywords: { action: 'remove', values: ['cotton'] }
    });
    expect(remove.status).toBe('ready');
    expect(remove.after.keywords).not.toContain('Cotton');
  });
  it('handles scalar group IDs and no change', async () => {
    expect(
      await previewProductBatchMaintenance(layouts.scalar, {
        groupPath: [{ id: 10, name: 'A' }],
        keywords: null
      })
    ).toMatchObject({ status: 'unchanged', patchXml: '' });
    expect(
      await previewProductBatchMaintenance(layouts.scalar, {
        groupPath: [
          { id: 10, name: 'A' },
          { id: 11, name: 'B' }
        ],
        keywords: null
      })
    ).toMatchObject({ status: 'ready', after: { groups: ['11'] } });
  });
  it('rejects missing targets and readonly values', async () => {
    expect(
      await previewProductBatchMaintenance(layouts.scalar, {
        groupPath: null,
        keywords: { action: 'append', values: ['new'] }
      })
    ).toMatchObject({ reason: 'missingField' });
    expect(
      await previewProductBatchMaintenance(layouts.readonly, {
        groupPath: null,
        keywords: { action: 'replace', values: ['new'] }
      })
    ).toMatchObject({ reason: 'readOnly' });
  });
  it('fingerprints target values and structure but ignores unrelated fields', async () => {
    const baseline = await productBatchTargetFingerprint(xml, ['productKeywords']);
    expect(
      await productBatchTargetFingerprint(xml.replace('Do not change', 'Other change'), ['productKeywords'])
    ).toBe(baseline);
    expect(
      await productBatchTargetFingerprint(xml.replace('Cotton shirt', 'Different'), ['productKeywords'])
    ).not.toBe(baseline);
    expect(
      await productBatchTargetFingerprint(xml.replace('productKeywords_2', 'new-slot'), ['productKeywords'])
    ).not.toBe(baseline);
  });
});
