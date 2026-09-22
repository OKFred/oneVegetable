import { describe, expect, it } from 'vitest';
import { FREE_API_CAPABILITY_DEFINITIONS } from '../src/generated/free-api-capabilities';
import { findCapabilityWithAccountVerification } from '../src/account-verification';
import {
  findCapability,
  getCapabilityDefinition,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';

describe('free API catalog completion', () => {
  it('preserves long scalar order IDs without accepting rounded numbers or numeric syntax', async () => {
    for (const method of ['alibaba.order.logistics.tracking.get', 'alibaba.order.pay.result.query']) {
      expect(await validateCapabilityRequest(method, { trade_id: '9007199254740993' })).toEqual([]);
      for (const trade_id of [9007199254740992, '1e19', '-1', '0', '001', '123456789012345678901']) {
        expect(await validateCapabilityRequest(method, { trade_id }), method).not.toEqual([]);
      }
    }
  });
  it('records confirmed reads without changing historical verification dates', () => {
    expect(findCapabilityWithAccountVerification('alibaba.icbu.product.id.encrypt')).toMatchObject({
      verification: 'account-verified',
      accountVerificationStatus: 'passed',
      accountVerificationCheckedAt: '2026-09-22T06:39:19.344Z'
    });
    expect(
      findCapabilityWithAccountVerification('alibaba.icbu.product.list')?.accountVerificationCheckedAt
    ).toBe('2026-09-10T06:40:47.891Z');
  });
  it('registers exactly 35 typed, audited definitions without excluded vendors', () => {
    expect(Object.keys(FREE_API_CAPABILITY_DEFINITIONS)).toHaveLength(35);
    for (const method of Object.keys(FREE_API_CAPABILITY_DEFINITIONS)) {
      expect(method).not.toMatch(/snsoft|xiaoman/);
      expect(findCapability(method)?.jushitaOnly).toBe(false);
      expect(getCapabilityDefinition(method)).not.toBeNull();
    }
  });
  it('validates examples, rejects extra request fields and empty response envelopes for every method', async () => {
    for (const [method, definition] of Object.entries(FREE_API_CAPABILITY_DEFINITIONS)) {
      expect(await validateCapabilityRequest(method, definition.requestExample), method).toEqual([]);
      expect(await validateCapabilityResponse(method, definition.responseExample), method).toEqual([]);
      expect(
        await validateCapabilityRequest(method, { ...definition.requestExample, unexpected: true }),
        method
      ).not.toEqual([]);
      expect(await validateCapabilityResponse(method, {}), method).not.toEqual([]);
      expect(await validateCapabilityResponse(method, null), method).not.toEqual([]);
    }
  });
  it('only opens the six general reads by default; no new mutation is silently enabled', () => {
    const definitions = Object.values(FREE_API_CAPABILITY_DEFINITIONS);
    expect(definitions.filter((definition) => definition.realCallEnabled)).toHaveLength(6);
    for (const definition of definitions.filter((item) => item.risk === 'mutation')) {
      expect(definition.realCallEnabled).toBe(false);
    }
    expect(getCapabilityDefinition('alibaba.dropshipping.order.pay')).toMatchObject({
      risk: 'mutation',
      restricted: true,
      realCallEnabled: false
    });
  });
});
