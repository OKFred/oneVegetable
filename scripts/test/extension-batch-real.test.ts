import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  parseBatchOptions,
  batchWireAllowed,
  claimBatchAcceptance
} from '../smoke-extension-batch-maintenance-real';
import { installNodeXmlDomGlobals } from '../node-xml-dom';

describe('formal MV3 batch real acceptance guard', () => {
  it('refuses a second run until the first claim is explicitly reconciled', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'onevegetable-batch-guard-'));
    const release = await claimBatchAcceptance(root, '123', 'fixture-key', 'ignored/report.json');
    const claim = (await readdir(resolve(root, 'claims')))[0];
    const saved = await readFile(resolve(root, 'claims', claim ?? ''), 'utf8');
    expect(saved).toContain('ignored/report.json');
    expect(saved).not.toContain('fixture-key');
    await expect(claimBatchAcceptance(root, '123', 'fixture-key', 'other/report.json')).rejects.toThrow(
      'PREVIOUS_BATCH_REQUIRES_READONLY_RECONCILIATION'
    );
    // Another product is independent; no credentials or product content enter the claim.
    const other = await claimBatchAcceptance(root, '456', 'fixture-key', 'other/report.json');
    await other();
    await release();
    const next = await claimBatchAcceptance(root, '123', 'fixture-key', 'next/report.json');
    await next();
    expect(await readdir(resolve(root, 'claims'))).toEqual([]);
  });
  it('requires explicit product, bundle and change/restore confirmation', () => {
    const args = ['--credential=ignored.json', '--product-id=123', '--confirm-change-and-restore'];
    expect(parseBatchOptions(args)).toEqual({ credential: 'ignored.json', productId: '123' });
    for (const invalid of [
      args.slice(0, 2),
      [...args, '--skip-restore'],
      [...args, '--product-id=456'],
      ['--credential=x', '--product-id=9007199254740993', '--confirm-change-and-restore']
    ])
      expect(() => parseBatchOptions(invalid)).toThrow();
  });
  it('refuses other hosts, token, unrelated writes and broad listing', () => {
    expect(
      batchWireAllowed(
        'https://eco.taobao.com/router/rest',
        'method=alibaba.icbu.product.list&id=123&page_size=1',
        '123'
      )
    ).toBe(true);
    for (const [url, body] of [
      ['https://openapi-api.alibaba.com/rest/auth/token/refresh', ''],
      ['https://eco.taobao.com/router/rest', 'method=alibaba.icbu.photobank.upload'],
      ['https://eco.taobao.com/router/rest', 'method=alibaba.icbu.product.list&page_size=30'],
      ['https://eco.taobao.com/router/rest', 'method=alibaba.icbu.product.list&id=456&page_size=1']
    ])
      expect(batchWireAllowed(url ?? '', body ?? '', '123')).toBe(false);
  });
  it('allows only the two target roots in an explicit product update', () => {
    installNodeXmlDomGlobals();
    const body = (xml: string) =>
      new URLSearchParams({
        method: 'alibaba.icbu.product.schema.update',
        param_product_top_publish_request: JSON.stringify({ product_id: 123, xml })
      }).toString();
    const url = 'https://eco.taobao.com/router/rest';
    expect(
      batchWireAllowed(
        url,
        body(
          '<schema><field id="productGroup" type="input"><value>1</value></field><field id="productKeywords" type="input"><value>chair</value></field></schema>'
        ),
        '123'
      )
    ).toBe(true);
    expect(
      batchWireAllowed(
        url,
        body('<schema><field id="subject" type="input"><value>changed</value></field></schema>'),
        '123'
      )
    ).toBe(false);
  });
});
