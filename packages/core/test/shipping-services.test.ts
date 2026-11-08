import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { filterChinaShippingServices, SHIPPING_SERVICE_DIRECTORY } from '../src/shipping-directory';
import {
  parseShippingServicesRequest,
  parseShippingConfigurationSummary,
  parseShippingQuoteResult,
  safeShippingSearchUrl
} from '../src/shipping-services';
import type { ShippingQuoteRequest } from '../src/shipping-services';
import {
  freightosQuotePayload,
  parseFreightosQuote,
  requestShippingQuote
} from '../src/shipping-quote-provider';
import { BffControlClient } from '../src/control-client';

const source = JSON.parse(
  readFileSync(
    new URL('../../../mock/data/shipping-services/cn-export-request.json', import.meta.url),
    'utf8'
  )
) as ShippingQuoteRequest;
const providerReply: unknown = JSON.parse(
  readFileSync(
    new URL('../../../mock/data/shipping-services/freightos-estimate.json', import.meta.url),
    'utf8'
  )
);
const request = () => structuredClone(source);
const reply = () => structuredClone(providerReply) as Record<string, unknown>;

describe('China-origin shipping directory', () => {
  it('has audited HTTPS official links and stable unique IDs without transmitting route details', () => {
    expect(new Set(SHIPPING_SERVICE_DIRECTORY.map((v) => v.id)).size).toBe(SHIPPING_SERVICE_DIRECTORY.length);
    for (const entry of SHIPPING_SERVICE_DIRECTORY) {
      expect(entry.originCountries).toContain('CN');
      for (const url of [entry.websiteUrl, entry.sourceUrl]) {
        const parsed = new URL(url);
        expect(parsed.protocol).toBe('https:');
        expect(parsed.username + parsed.password + parsed.hash + parsed.search).toBe('');
      }
    }
    expect(filterChinaShippingServices({ keyword: '顺丰' }).map((v) => v.id)).toEqual(['sf']);
    expect(filterChinaShippingServices({ mode: 'lcl' }).every((v) => v.modes.includes('lcl'))).toBe(true);
    expect(filterChinaShippingServices({ mode: 'parcel' }).some((v) => v.id === 'sf')).toBe(true);
  });
});

describe('third-party quote trust boundaries', () => {
  it('uses the generated request schema and requires both explicit consents', () => {
    expect(parseShippingServicesRequest({ ...request(), action: 'quote' }).action).toBe('quote');
    expect(() =>
      parseShippingServicesRequest({ ...request(), action: 'quote', token: 'unexpected' })
    ).toThrow('SHIPPING_REQUEST_INVALID');
    for (const name of ['dataSharing', 'costAcknowledged'] as const) {
      const value = request();
      value.consent[name] = false;
      expect(() => parseShippingServicesRequest({ ...value, action: 'quote' })).toThrow(
        'SHIPPING_CONSENT_REQUIRED'
      );
    }
    expect(() =>
      parseShippingServicesRequest({ ...request(), provider: 'easyship', action: 'quote' })
    ).toThrow('SHIPPING_REQUEST_INVALID');
  });
  it('does not replace mainland China with Hong Kong or accept domestic routes', () => {
    const value = request();
    value.shipment.origin.countryCode = 'HK';
    expect(() => freightosQuotePayload(value)).toThrow('SHIPPING_MAINLAND_ORIGIN_REQUIRED');
    value.shipment.origin.countryCode = 'CN';
    value.shipment.destination.countryCode = 'CN';
    expect(() => freightosQuotePayload(value)).toThrow('SHIPPING_EXPORT_DESTINATION_REQUIRED');
    value.shipment.destination.countryCode = 'ZZ';
    expect(() => freightosQuotePayload(value)).toThrow('SHIPPING_REQUEST_INVALID');
  });
  it('sends per-piece dimensions and weight, not Alibaba tokens or buyer information', () => {
    const value = request();
    const payload = freightosQuotePayload(value);
    expect(payload).toMatchObject({
      shipment: {
        direction: 'Export',
        transportMode: 'LCL',
        origin: { countryCode: 'CN' },
        load: { packages: [{ quantity: 2, weight: { value: 10, unit: 'kg' } }] }
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|session|accessToken|Unbranded|contact|phone/);
    value.shipment.mode = 'fcl';
    value.shipment.packaging = 'container40';
    expect(() => freightosQuotePayload(value)).toThrow('SHIPPING_PACKAGING_INVALID');
    value.shipment.lengthCm = value.shipment.widthCm = value.shipment.heightCm = 0;
    const container = freightosQuotePayload(value);
    expect(JSON.stringify(container)).not.toContain('dimensions');
    value.shipment.mode = 'express';
    expect(() => freightosQuotePayload(value)).toThrow('SHIPPING_MODE_UNAVAILABLE');
  });
  it('rejects malformed or past pickup dates without a provider call', async () => {
    const send = vi.fn();
    const value = request();
    value.shipment.pickupDate = '2026-02-30';
    await expect(requestShippingQuote(value, 'fixture-key', { send })).rejects.toThrow(
      'SHIPPING_PICKUP_DATE_INVALID'
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('never exposes credentials in summaries or permits unsafe result links', () => {
    expect(
      parseShippingConfigurationSummary({
        provider: 'freightos',
        configured: false,
        revision: 2,
        updatedAtUtc: 123
      }).revision
    ).toBe(2);
    expect(() =>
      parseShippingConfigurationSummary({
        provider: 'freightos',
        configured: true,
        revision: null,
        updatedAtUtc: null
      })
    ).toThrow('SHIPPING_RESPONSE_INVALID');
    expect(() =>
      parseShippingConfigurationSummary({
        provider: 'freightos',
        configured: false,
        revision: null,
        updatedAtUtc: null,
        apiKey: 'secret'
      })
    ).toThrow('SHIPPING_RESPONSE_INVALID');
    for (const url of [
      'javascript:alert(1)',
      'https://evil.test/results/a',
      'https://ship.freightos.com@evil.test/results/a',
      'https://ship.freightos.com/',
      'http://ship.freightos.com/results/a'
    ])
      expect(safeShippingSearchUrl(url)).toBeNull();
    const result = parseFreightosQuote(providerReply, request());
    expect(() => parseShippingQuoteResult({ ...result, searchUrl: 'https://evil.test/results/a' })).toThrow(
      'SHIPPING_QUOTE_RESPONSE_INVALID'
    );
  });
  it('keeps estimates distinct from bookable quotes and missing values distinct from zero', () => {
    const result = parseFreightosQuote(providerReply, request());
    expect(result.options[0]).toMatchObject({
      kind: 'market-estimate',
      amount: '394.43',
      currency: 'USD',
      transitDaysFrom: 17,
      transitDaysTo: 25
    });
    const missing = reply();
    missing.modes = [{ mode: 'LCL' }];
    expect(parseFreightosQuote(missing, request()).options[0]).toMatchObject({
      amount: null,
      currency: null,
      transitDaysFrom: null
    });
    delete missing.modes;
    expect(parseFreightosQuote(missing, request()).options).toEqual([]);
    expect(() => parseFreightosQuote({}, request())).toThrow('SHIPPING_QUOTE_RESPONSE_INVALID');
  });
  it('rejects incompatible units, wrong routes and invalid prices', () => {
    const value = reply();
    value.origin = { countryCode: 'US' };
    expect(() => parseFreightosQuote(value, request())).toThrow('SHIPPING_QUOTE_RESPONSE_INVALID');
    for (const modes of [
      [{ mode: 'LCL', averageTransitTime: { from: 1, to: 3, unit: 'hours' } }],
      [{ mode: 'LCL', averagePrice: { value: -1, currency: 'USD' } }],
      [{ mode: 'LCL', averageTransitTime: { from: 3, to: 1, unit: 'days' } }]
    ])
      expect(() => parseFreightosQuote({ ...reply(), modes }, request())).toThrow(
        'SHIPPING_QUOTE_RESPONSE_INVALID'
      );
  });
  it('uses one fixed HTTPS quote endpoint, no cookies, no redirects or retries', async () => {
    const send = vi.fn((_url: RequestInfo | URL, _init: RequestInit) =>
      Promise.resolve(Response.json(providerReply))
    );
    const result = await requestShippingQuote(request(), 'fixture-private-key', { send });
    expect(result.options).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
    const call = send.mock.calls[0];
    if (!call) throw new Error('Expected one provider request');
    const [url, init] = call;
    expect(url instanceof URL ? url.href : typeof url === 'string' ? url : url.url).toBe(
      'https://ship.freightos.com/api/rate-estimate/v1/search'
    );
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'manual'
    });
    expect(new Headers(init.headers).get('apiKey')).toBe('fixture-private-key');
  });
  it.each([
    [401, 'SHIPPING_PROVIDER_AUTH_REQUIRED'],
    [429, 'SHIPPING_PROVIDER_RATE_LIMIT'],
    [400, 'SHIPPING_QUOTE_REJECTED'],
    [500, 'SHIPPING_QUOTE_PROVIDER_UNAVAILABLE']
  ])('normalizes HTTP %s without leaking provider response', async (status, code) => {
    const send = vi.fn(() => Promise.resolve(Response.json({ message: 'fixture-private-key' }, { status })));
    await expect(requestShippingQuote(request(), 'fixture-private-key', { send })).rejects.toThrow(code);
    expect(send).toHaveBeenCalledOnce();
  });
  it('stops after ambiguous transport failure and does not return raw exception text', async () => {
    const send = vi.fn(() => Promise.reject(new Error('fixture-private-key')));
    await expect(requestShippingQuote(request(), 'fixture-private-key', { send })).rejects.toThrow(
      'SHIPPING_QUOTE_OUTCOME_UNKNOWN'
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it('uses BFF CSRF and preserves the exact quote request ID without sending an action field', async () => {
    const send = vi.fn((_url: RequestInfo | URL, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('Expected a JSON string');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body.requestId).toBe(source.requestId);
      expect(body).not.toHaveProperty('action');
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-fixture');
      return Promise.resolve(
        Response.json({
          requestId: body.requestId,
          ok: true,
          data: parseFreightosQuote(providerReply, request())
        })
      );
    });
    const client = new BffControlClient({
      baseUrl: 'https://workbench.test',
      shippingServicesValidators: () => import('../src/shipping-services'),
      csrfToken: () => 'csrf-fixture',
      transport: { send }
    });
    expect((await client.shippingServices.quote(request())).requestId).toBe(source.requestId);
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not dispatch from a BFF client without its shipping validator loader', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json({})));
    const client = new BffControlClient({ baseUrl: 'https://workbench.test', transport: { send } });
    await expect(client.shippingServices.configuration('freightos')).rejects.toMatchObject({
      gatewayError: { code: 'SHIPPING_SERVICES_UNAVAILABLE' }
    });
    expect(send).not.toHaveBeenCalled();
  });
});
