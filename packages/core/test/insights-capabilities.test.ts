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
  definitions: { method: string; restricted: boolean; permissionGroups: string[] }[];
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

  it('forwards every official permission package to registry and OpenAPI metadata', async () => {
    const snapshot = await readSnapshot();
    const contract = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../../openapi/one-vegetable.json'), 'utf8')
    ) as { 'x-insights-capabilities': Record<string, { permissionGroups: string[] }> };

    for (const { method, permissionGroups } of snapshot.definitions) {
      expect(Array.isArray(permissionGroups), method).toBe(true);
      expect(getCapabilityDefinition(method)?.permissionGroups, method).toEqual(permissionGroups);
      expect(contract['x-insights-capabilities'][method]?.permissionGroups, method).toEqual(permissionGroups);
    }
  });

  it('exposes the exact official supplier package without changing read availability', async () => {
    const method = 'alibaba.procurement.mysupplier.list';
    const snapshot = await readSnapshot();
    expect(snapshot.definitions.find((definition) => definition.method === method)?.permissionGroups).toEqual(
      ['国际站企业集成基础权限包']
    );
    expect(getCapabilityDefinition(method)).toMatchObject({
      permissionGroups: ['国际站企业集成基础权限包'],
      risk: 'read',
      restricted: false,
      realCallEnabled: true
    });
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
    expect(getCapabilityDefinition('alibaba.procurement.supplier.items.get')).toMatchObject({
      restricted: false,
      realCallEnabled: true
    });
  });
});
