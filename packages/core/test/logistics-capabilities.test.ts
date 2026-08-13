import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getCapabilityDefinition,
  isLogisticsCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';

interface LogisticsSnapshot {
  logisticsCategoryCount: number;
  crossDomainCount: number;
  catalogCount: number;
  definitions: {
    method: string;
    lifecycle: 'active' | 'deprecated' | 'unlisted';
    restricted: boolean;
    risk: 'read' | 'mutation';
  }[];
}

async function readSnapshot(): Promise<LogisticsSnapshot> {
  const source = await readFile(
    resolve(import.meta.dirname, '../../../docs/alibaba-logistics-api-docs.json'),
    'utf8'
  );
  return JSON.parse(source) as LogisticsSnapshot;
}

describe('typed logistics capability domain', () => {
  it('keeps fourteen official logistics methods plus the cross-domain shipping template', async () => {
    const snapshot = await readSnapshot();
    const methods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) => methods.has(definition.method));

    expect(snapshot.logisticsCategoryCount).toBe(14);
    expect(snapshot.crossDomainCount).toBe(1);
    expect(snapshot.catalogCount).toBe(15);
    expect(definitions).toHaveLength(15);
    expect(isLogisticsCapabilityMethod('alibaba.wholesale.shippingline.template.list')).toBe(true);
  });

  it('compiles request and response validators for every logistics method', async () => {
    const snapshot = await readSnapshot();
    for (const { method } of snapshot.definitions) {
      const definition = getCapabilityDefinition(method);
      expect(definition, method).not.toBeNull();
      expect(await validateCapabilityRequest(method, definition?.requestExample), method).toEqual([]);
      expect(await validateCapabilityResponse(method, definition?.responseExample), method).toEqual([]);
    }
  });

  it('marks the two officially paused methods deprecated and keeps cancellation a mutation', () => {
    expect(
      getCapabilityDefinition('alibaba.onetouch.logistics.express.logistics.rule.validate')
    ).toMatchObject({ lifecycle: 'deprecated', realCallEnabled: false });
    expect(getCapabilityDefinition('alibaba.onetouch.logistics.express.order.cancel')).toMatchObject({
      lifecycle: 'deprecated',
      risk: 'mutation',
      realCallEnabled: false
    });
  });

  it('keeps OneTouch capabilities qualification-gated while allowing the shipping template read', async () => {
    const snapshot = await readSnapshot();
    const oneTouch = snapshot.definitions.filter((definition) => definition.method.includes('.onetouch.'));
    expect(oneTouch).toHaveLength(14);
    for (const { method } of oneTouch) {
      expect(getCapabilityDefinition(method), method).toMatchObject({
        restricted: true,
        realCallEnabled: false
      });
    }
    expect(getCapabilityDefinition('alibaba.wholesale.shippingline.template.list')).toMatchObject({
      restricted: false,
      realCallEnabled: true
    });
  });
});
