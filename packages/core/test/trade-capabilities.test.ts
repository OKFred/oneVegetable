import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getCapabilityDefinition,
  isTradeCapabilityMethod,
  listCapabilityDefinitions,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';

interface TradeDocumentSnapshot {
  catalogCount: number;
  definitions: {
    method: string;
    restricted: boolean;
    risk: 'read' | 'mutation';
  }[];
}

interface TradeExclusionSnapshot {
  count: number;
  exclusions: { method: string; reason: string }[];
}

async function readSnapshot<T>(fileName: string): Promise<T> {
  const source = await readFile(resolve(import.meta.dirname, `../../../docs/${fileName}`), 'utf8');
  return JSON.parse(source) as T;
}

describe('typed trade capability domain', () => {
  it('keeps 26 callable contracts and records the Jushita-only detail method separately', async () => {
    const snapshot = await readSnapshot<TradeDocumentSnapshot>('alibaba-trade-api-docs.json');
    const exclusions = await readSnapshot<TradeExclusionSnapshot>('alibaba-trade-api-exclusions.json');
    const methods = new Set(snapshot.definitions.map((definition) => definition.method));
    const definitions = listCapabilityDefinitions().filter((definition) => methods.has(definition.method));

    expect(snapshot.catalogCount).toBe(26);
    expect(definitions).toHaveLength(26);
    expect(exclusions.count).toBe(1);
    expect(exclusions.exclusions[0]).toMatchObject({
      method: 'alibaba.seller.order.get',
      reason: 'jushita-only'
    });
    expect(isTradeCapabilityMethod('alibaba.seller.order.get')).toBe(false);
  });

  it('compiles request and response validators for every trade method', async () => {
    const snapshot = await readSnapshot<TradeDocumentSnapshot>('alibaba-trade-api-docs.json');

    for (const { method } of snapshot.definitions) {
      const definition = getCapabilityDefinition(method);
      expect(definition, method).not.toBeNull();
      expect(validateCapabilityRequest(method, definition?.requestExample), method).toEqual([]);
      expect(validateCapabilityResponse(method, definition?.responseExample), method).toEqual([]);
    }
  });

  it('keeps every mutation disabled until an account smoke test unlocks it', async () => {
    const snapshot = await readSnapshot<TradeDocumentSnapshot>('alibaba-trade-api-docs.json');
    const mutations = snapshot.definitions.filter((definition) => definition.risk === 'mutation');

    expect(mutations.length).toBeGreaterThan(0);
    for (const { method } of mutations) {
      expect(getCapabilityDefinition(method)?.realCallEnabled, method).toBe(false);
    }
  });

  it('keeps partner-specific and additional-qualification capabilities restricted', async () => {
    const snapshot = await readSnapshot<TradeDocumentSnapshot>('alibaba-trade-api-docs.json');
    const restricted = snapshot.definitions.filter((definition) => definition.restricted);

    expect(restricted.length).toBeGreaterThan(0);
    for (const { method } of restricted) {
      const definition = getCapabilityDefinition(method);
      expect(definition?.restricted, method).toBe(true);
      expect(definition?.realCallEnabled, method).toBe(false);
    }
  });

  it('exposes the documented order, finance, fulfillment, and address methods', () => {
    expect(isTradeCapabilityMethod('alibaba.seller.order.list')).toBe(true);
    expect(isTradeCapabilityMethod('alibaba.seller.order.fund.get')).toBe(true);
    expect(isTradeCapabilityMethod('alibaba.seller.order.logistics.get')).toBe(true);
    expect(isTradeCapabilityMethod('alibaba.trade.fulfillment.channel.get')).toBe(true);
    expect(isTradeCapabilityMethod('alibaba.trade.address.schema.query')).toBe(true);
  });
});
