import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  callCapability,
  getCapabilityDefinition,
  isRfqCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import { MockGatewayClient } from '../src/mock-client';

interface RfqDocumentSnapshot {
  catalogCount: number;
  definitions: { method: string; risk: 'read' | 'mutation' }[];
}

describe('typed RFQ capability domain', () => {
  it('keeps all seven methods from the official RFQ catalog snapshot', async () => {
    const source = await readFile(
      resolve(import.meta.dirname, '../../../docs/alibaba-rfq-api-docs.json'),
      'utf8'
    );
    const snapshot = JSON.parse(source) as RfqDocumentSnapshot;
    const methods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) => methods.has(definition.method));

    expect(snapshot.catalogCount).toBe(7);
    expect(definitions).toHaveLength(7);
    expect(definitions.map((definition) => definition.method)).toContain('alibaba.icbu.annex.upload');
  });

  it('compiles request and response validators for every RFQ method', async () => {
    const source = await readFile(
      resolve(import.meta.dirname, '../../../docs/alibaba-rfq-api-docs.json'),
      'utf8'
    );
    const snapshot = JSON.parse(source) as RfqDocumentSnapshot;

    for (const { method } of snapshot.definitions) {
      const definition = getCapabilityDefinition(method);
      expect(definition).not.toBeNull();
      expect(validateCapabilityRequest(method, definition?.requestExample)).toEqual([]);
      expect(validateCapabilityResponse(method, definition?.responseExample)).toEqual([]);
    }
  });

  it('enforces the documented 20-ID read-status limit', () => {
    const issues = validateCapabilityRequest('alibaba.icbu.rfq.read', {
      rfq_id_list: Array.from({ length: 21 }, (_, index) => `rfq-${index}`)
    });
    expect(issues.some((issue) => issue.keyword === 'maxItems')).toBe(true);
  });

  it('keeps quotation and attachment writes disabled until account verification', () => {
    expect(getCapabilityDefinition('alibaba.icbu.quotation.post')?.realCallEnabled).toBe(false);
    expect(getCapabilityDefinition('alibaba.icbu.annex.upload')?.realCallEnabled).toBe(false);
    expect(getCapabilityDefinition('alibaba.icbu.rfq.search')?.realCallEnabled).toBe(true);
  });

  it('offers method-correlated RFQ calls through the shared helper', async () => {
    expect(isRfqCapabilityMethod('alibaba.icbu.rfq.myequity')).toBe(true);
    const result = await callCapability(new MockGatewayClient(0), 'alibaba.icbu.rfq.read', {
      rfq_id_list: ['rfq-demo']
    });
    expect(result.method).toBe('alibaba.icbu.rfq.read');
  });
});
