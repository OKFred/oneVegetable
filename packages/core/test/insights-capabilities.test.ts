import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getCapabilityDefinition,
  isInsightsCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';

interface InsightsSnapshot {
  dataCount: number;
  buyerCount: number;
  catalogCount: number;
  definitions: { method: string; restricted: boolean }[];
}

async function readSnapshot(): Promise<InsightsSnapshot> {
  const source = await readFile(
    resolve(import.meta.dirname, '../../../docs/alibaba-insights-api-docs.json'),
    'utf8'
  );
  return JSON.parse(source) as InsightsSnapshot;
}

describe('typed data and supplier insights capability domain', () => {
  it('keeps two data methods and two buyer procurement methods', async () => {
    const snapshot = await readSnapshot();
    const methods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) => methods.has(definition.method));

    expect(snapshot).toMatchObject({ dataCount: 2, buyerCount: 2, catalogCount: 4 });
    expect(definitions).toHaveLength(4);
    expect(isInsightsCapabilityMethod('alibaba.procurement.mysupplier.list')).toBe(true);
  });

  it('compiles request and response validators for every insights method', async () => {
    const snapshot = await readSnapshot();
    for (const { method } of snapshot.definitions) {
      const definition = getCapabilityDefinition(method);
      expect(definition, method).not.toBeNull();
      expect(await validateCapabilityRequest(method, definition?.requestExample), method).toEqual([]);
      expect(await validateCapabilityResponse(method, definition?.responseExample), method).toEqual([]);
    }
  });

  it('keeps CGS partner data restricted without disabling ordinary reads', () => {
    expect(getCapabilityDefinition('alibaba.mydata.self.query.cgsokk')).toMatchObject({
      restricted: true,
      realCallEnabled: false,
      featureArea: 'partnerData'
    });
    expect(getCapabilityDefinition('alibaba.icbu.diagnostic.supplier.rank.getpercent')).toMatchObject({
      restricted: false,
      realCallEnabled: true
    });
    expect(getCapabilityDefinition('alibaba.procurement.mysupplier.list')).toMatchObject({
      restricted: false,
      realCallEnabled: true
    });
  });
});
