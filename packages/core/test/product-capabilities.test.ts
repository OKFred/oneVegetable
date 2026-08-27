import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  callCapability,
  getCapabilityDefinition,
  isProductCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import { MockGatewayClient } from '../src/mock-client';

interface ProductDocumentSnapshot {
  catalogCount: number;
  articleCount: number;
  definitions: { method: string; source: 'catalog' | 'article' }[];
}

describe('typed product capability domain', () => {
  it('keeps 25 catalog methods and two article-only Schema mutations', async () => {
    const source = await readFile(
      resolve(import.meta.dirname, '../../../docs/alibaba-product-api-docs.json'),
      'utf8'
    );
    const snapshot = JSON.parse(source) as ProductDocumentSnapshot;
    const productMethods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) =>
      productMethods.has(definition.method)
    );
    expect(snapshot.catalogCount).toBe(25);
    expect(snapshot.articleCount).toBe(2);
    expect(definitions).toHaveLength(snapshot.catalogCount + snapshot.articleCount);
    expect(definitions.filter((item) => item.source === 'article').map((item) => item.method)).toEqual([
      'alibaba.icbu.product.schema.add',
      'alibaba.icbu.product.schema.add.draft'
    ]);
  });

  it('exercises request and response standalone validators for every product method', async () => {
    for (const definition of listCapabilityDefinitions().filter((item) =>
      isProductCapabilityMethod(item.method)
    )) {
      await expect(
        validateCapabilityRequest(definition.method, definition.requestExample)
      ).resolves.toBeDefined();
      await expect(
        validateCapabilityResponse(definition.method, definition.responseExample)
      ).resolves.toBeDefined();
    }
  });

  it('rejects an invalid method-specific request before a Mock call can complete', async () => {
    const client = new MockGatewayClient(0);
    await expect(
      client.request('callCapability', {
        method: 'alibaba.icbu.category.id.mapping',
        parameters: { cat_id: 'not-a-number' }
      })
    ).rejects.toThrow('请求契约不通过');
  });

  it('returns raw response data, traceId and structured drift warnings', async () => {
    const client = new MockGatewayClient(0);
    const result = await client.request('callCapability', {
      method: 'alibaba.icbu.category.attr.get',
      parameters: { attribute_request: { cat_id: 123 } }
    });
    expect(result.traceId).toContain('mock-');
    expect(result.data).toBeTruthy();
    expect(result.contractValid).toBe(false);
    expect(result.contractIssues.length).toBeGreaterThan(0);
  });

  it('marks deprecated methods and only enables account-verified mutations', () => {
    expect(getCapabilityDefinition('alibaba.icbu.product.add')?.lifecycle).toBe('deprecated');
    const mutations = listCapabilityDefinitions().filter((item) => item.risk === 'mutation');
    expect(mutations.length).toBeGreaterThan(0);
    expect(
      mutations
        .filter((item) => item.realCallEnabled)
        .map((item) => item.method)
        .sort()
    ).toEqual([
      'alibaba.icbu.photobank.group.operate',
      'alibaba.icbu.product.batch.update.display',
      'alibaba.icbu.product.schema.add'
    ]);
    expect(
      mutations
        .filter((item) => item.realCallEnabled)
        .every((item) => item.verification === 'account-verified')
    ).toBe(true);
  });

  it('offers a method-correlated call helper', async () => {
    const result = await callCapability(new MockGatewayClient(0), 'alibaba.icbu.product.list', {
      current_page: 1,
      page_size: 10,
      language: 'ENGLISH'
    });
    expect(result.method).toBe('alibaba.icbu.product.list');
  });
});
