import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DeviceLocalKeyStore } from '../lib/device-local-key';
import {
  ExtensionShippingServicesService,
  type ShippingServicesLocalStore,
  type ShippingServicesStoredState
} from '../lib/shipping-services-service';
import { SHIPPING_PERMISSION_ORIGINS } from '../lib/shipping-services-protocol';
import { freightosResponse, shippingConfiguration, shippingQuote } from './shipping-services-fixture';

function setup() {
  let value: unknown;
  let now = Date.UTC(2026, 10, 9);
  const deviceKey = new DeviceLocalKeyStore('fixture-shipping-services-key', 'SHIPPING_SERVICES_FAILED');
  const store = {
    read: vi.fn(() => Promise.resolve(structuredClone(value))),
    write: vi.fn((next: ShippingServicesStoredState) => {
      value = structuredClone(next);
      return Promise.resolve();
    }),
    remove: vi.fn(() => {
      value = undefined;
      return Promise.resolve();
    }),
    key: (create: boolean) => deviceKey.key(create),
    removeKey: () => deviceKey.removeKey()
  } satisfies ShippingServicesLocalStore;
  const send = vi.fn((_input: RequestInfo | URL, _init: RequestInit) =>
    Promise.resolve(Response.json(freightosResponse))
  );
  const contains = vi.fn(() => Promise.resolve(true));
  const create = () => new ExtensionShippingServicesService(store, contains, { send }, () => now);
  const service = create();
  const handle = (input: Record<string, unknown>, trusted = true, worker = service) =>
    worker.handle(
      { requestId: crypto.randomUUID(), kind: 'shipping-services-request', provider: 'freightos', ...input },
      trusted
    );
  const save = (expectedRevision: number | null = null) =>
    handle({ ...shippingConfiguration, action: 'save', expectedRevision });
  const state = () => structuredClone(value) as ShippingServicesStoredState;
  return {
    service,
    store,
    send,
    contains,
    create,
    handle,
    save,
    state,
    corrupt: (next: unknown) => {
      value = next;
    },
    nextDay: () => {
      now += 86_400_000;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    }
  };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected real network')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extension shipping services', () => {
  it('encrypts a write-only key, authenticates metadata, and restores without TOP/IOP or a password', async () => {
    const s = setup();
    const result = await s.save();
    expect(result).toMatchObject({
      ok: true,
      data: { provider: 'freightos', configured: true, revision: 1 }
    });
    expect(Object.keys('data' in result ? (result.data as object) : {})).toEqual([
      'provider',
      'configured',
      'revision',
      'updatedAtUtc'
    ]);
    expect(JSON.stringify(result)).not.toContain(shippingConfiguration.apiKey);
    expect(JSON.stringify(s.state())).not.toContain(shippingConfiguration.apiKey);
    expect((await s.store.key(false))?.extractable).toBe(false);
    expect(await s.handle({ action: 'configuration' }, true, s.create())).toMatchObject({
      ok: true,
      data: 'data' in result ? result.data : null
    });
    expect(s.send).not.toHaveBeenCalled();
    const saved = s.state();
    s.corrupt({ ...saved, revision: 2 });
    expect(await s.handle({ action: 'configuration' })).toMatchObject({
      error: { code: 'SHIPPING_CONFIGURATION_UNREADABLE' }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies untrusted senders and malformed/easyship/CN-invalid/consent-invalid requests before storage', async () => {
    const s = setup();
    expect(await s.handle({ action: 'save', ...shippingConfiguration }, false)).toMatchObject({
      error: { code: 'SHIPPING_UNTRUSTED_SENDER' }
    });
    for (const input of [
      { action: 'save', ...shippingConfiguration, provider: 'easyship' },
      { action: 'save', ...shippingConfiguration, termsAccepted: false },
      { action: 'save', ...shippingConfiguration, apiKey: 'bad\nheader' },
      { ...shippingQuote(), action: 'quote', consent: { dataSharing: false, costAcknowledged: true } },
      { ...shippingQuote(), action: 'quote', endpoint: 'https://attacker.example' },
      {
        ...shippingQuote(),
        action: 'quote',
        shipment: {
          ...shippingQuote().shipment,
          origin: { countryCode: 'HK', city: 'Hong Kong', state: '', postalCode: '' }
        }
      }
    ])
      expect((await s.handle(input)).ok).toBe(false);
    expect(s.store.read).not.toHaveBeenCalled();
    expect(s.send).not.toHaveBeenCalled();
    expect(await s.store.key(false)).toBeNull();
  });

  it('requires the exact optional host grant on save and quote, with no transport on denial', async () => {
    const s = setup();
    s.contains.mockResolvedValue(false);
    expect(await s.save()).toMatchObject({ error: { code: 'SHIPPING_PERMISSION_REQUIRED' } });
    expect(await s.store.read()).toBeUndefined();
    s.contains.mockResolvedValue(true);
    await s.save();
    s.contains.mockResolvedValue(false);
    expect(await s.handle({ ...shippingQuote(), action: 'quote' })).toMatchObject({
      error: { code: 'SHIPPING_PERMISSION_REQUIRED' }
    });
    expect(s.state().claims).toEqual([]);
    expect(s.send).not.toHaveBeenCalled();
    expect(SHIPPING_PERMISSION_ORIGINS).toEqual(['https://ship.freightos.com/*']);
    expect(s.contains).toHaveBeenCalledWith(['https://ship.freightos.com/*']);
  });

  it('persists only claim metadata before one fixed-host dispatch and never stores addresses/results', async () => {
    const s = setup();
    await s.save();
    const quote = shippingQuote();
    s.send.mockImplementation((input, init) => {
      expect(s.state().claims).toEqual([
        {
          requestId: quote.requestId,
          attemptedAtUtc: Date.UTC(2026, 10, 9),
          revision: 1,
          completedAtUtc: null
        }
      ]);
      expect(input instanceof URL ? input.href : input).toBe(
        'https://ship.freightos.com/api/rate-estimate/v1/search'
      );
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('manual');
      expect(init.credentials).toBe('omit');
      expect(new Headers(init.headers).get('apiKey')).toBe(shippingConfiguration.apiKey);
      return Promise.resolve(Response.json(freightosResponse));
    });
    const result = await s.handle({ ...quote, action: 'quote' });
    expect(result).toMatchObject({
      ok: true,
      data: {
        options: [{ kind: 'market-estimate', amount: '123.45', transitDaysFrom: null, transitDaysTo: null }]
      }
    });
    expect(JSON.stringify(result)).not.toContain(freightosResponse.rawPrivateField);
    for (const secret of [
      shippingConfiguration.apiKey,
      quote.shipment.origin.city,
      quote.shipment.destination.city,
      freightosResponse.rawPrivateField,
      '123.45'
    ])
      expect(JSON.stringify(s.state())).not.toContain(secret);
    expect(s.send).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serializes competing saves, validates revisions, and does not reuse a cleared generation', async () => {
    const s = setup();
    const saves = await Promise.all([s.save(), s.save()]);
    expect(saves.map((v) => v.ok)).toEqual([true, false]);
    expect(saves[1]).toMatchObject({ error: { code: 'SHIPPING_CONFIGURATION_CHANGED' } });
    expect(await s.handle({ action: 'clear', expectedRevision: 2 })).toMatchObject({
      error: { code: 'SHIPPING_CONFIGURATION_CHANGED' }
    });
    expect(await s.handle({ action: 'clear', expectedRevision: 1 })).toMatchObject({ ok: true, data: null });
    expect(await s.store.key(false)).toBeNull();
    expect(await s.save()).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(await s.handle({ ...shippingQuote(), action: 'quote' })).toMatchObject({
      error: { code: 'SHIPPING_CONFIGURATION_CHANGED' }
    });
    expect(s.send).not.toHaveBeenCalled();
  });

  it('claims concurrent duplicate IDs once and keeps successful/unknown IDs across worker restarts and days', async () => {
    const s = setup();
    await s.save();
    const quote = { ...shippingQuote(), action: 'quote' };
    const results = await Promise.all([s.handle(quote), s.handle(quote)]);
    expect(results.map((v) => v.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' } });
    s.nextDay();
    expect(await s.handle(quote, true, s.create())).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    const unknown = { ...shippingQuote(), action: 'quote' };
    s.send.mockRejectedValueOnce(new Error('private provider response ' + shippingConfiguration.apiKey));
    expect(await s.handle(unknown)).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_OUTCOME_UNKNOWN', retryable: false }
    });
    expect(await s.handle(unknown, true, s.create())).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    expect(s.send).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch when the first claim write fails and returns only a safe error', async () => {
    const s = setup();
    await s.save();
    vi.mocked(s.store.write).mockRejectedValueOnce(new Error(shippingConfiguration.apiKey));
    const result = await s.handle({ ...shippingQuote(), action: 'quote' });
    expect(result).toMatchObject({
      error: { code: 'SHIPPING_SERVICES_FAILED', message: 'SHIPPING_SERVICES_FAILED', retryable: false }
    });
    expect(JSON.stringify(result)).not.toContain(shippingConfiguration.apiKey);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.state().claims).toHaveLength(0);
  });

  it('does not report success if post-result metadata persistence fails or resend after restart', async () => {
    const s = setup();
    await s.save();
    s.store.write
      .mockImplementationOnce((next) => {
        s.corrupt(structuredClone(next));
        return Promise.resolve();
      })
      .mockRejectedValueOnce(new Error(shippingConfiguration.apiKey));
    const quote = { ...shippingQuote(), action: 'quote' };
    const result = await s.handle(quote);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SHIPPING_SERVICES_FAILED', retryable: false }
    });
    expect(result).not.toHaveProperty('data');
    expect(JSON.stringify(result)).not.toContain(shippingConfiguration.apiKey);
    expect(s.state().claims).toMatchObject([{ requestId: quote.requestId, completedAtUtc: null }]);
    expect(await s.handle(quote, true, s.create())).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    expect(s.send).toHaveBeenCalledOnce();
  });

  it('prunes expired completed and pending claims on the next persisted state without erasing current unknowns', async () => {
    const s = setup();
    await s.save();
    const now = Date.UTC(2026, 10, 9);
    const claim = (attemptedAtUtc: number, completedAtUtc: number | null) => ({
      requestId: crypto.randomUUID(),
      attemptedAtUtc,
      completedAtUtc,
      revision: 1
    });
    const cutoff = now - 30 * 86_400_000;
    const expired = [claim(cutoff - 1, cutoff), claim(cutoff - 1, null)];
    const retained = [claim(cutoff, null), claim(now - 86_400_000, now), claim(now, null)];
    s.corrupt({ ...s.state(), claims: [...expired, ...retained] });
    expect(await s.save(1)).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(s.state().claims).toEqual(retained);
    expect(
      await s.handle(
        { ...shippingQuote(), action: 'quote', requestId: retained[0]?.requestId, expectedRevision: 2 },
        true,
        s.create()
      )
    ).toMatchObject({ error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' } });
    expect(await s.handle({ ...shippingQuote(), action: 'quote', expectedRevision: 2 })).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_IN_PROGRESS' }
    });
    expect(await s.handle({ action: 'clear', expectedRevision: 2 })).toMatchObject({ ok: true });
    expect(s.state().claims).toEqual(retained);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('bounds the crashed-worker serial lease to 60s while retaining the original ID for the full 30-day window', async () => {
    const s = setup();
    await s.save();
    const quote = shippingQuote();
    s.corrupt({
      ...s.state(),
      claims: [
        {
          requestId: quote.requestId,
          attemptedAtUtc: Date.UTC(2026, 10, 9),
          revision: 1,
          completedAtUtc: null
        }
      ]
    });
    const restarted = s.create();
    expect(await s.handle({ ...quote, action: 'quote' }, true, restarted)).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    expect(await s.handle({ ...shippingQuote(), action: 'quote' }, true, restarted)).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_IN_PROGRESS' }
    });
    expect(s.send).not.toHaveBeenCalled();
    s.advance(59_999);
    expect(await s.handle({ ...shippingQuote(), action: 'quote' }, true, restarted)).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_IN_PROGRESS' }
    });
    s.advance(1);
    expect((await s.handle({ ...shippingQuote(), action: 'quote' }, true, restarted)).ok).toBe(true);
    expect(s.state().claims).toHaveLength(2);
    expect(await s.handle({ ...quote, action: 'quote' }, true, restarted)).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    s.advance(30 * 86_400_000 - 60_000);
    expect(await s.handle({ ...quote, action: 'quote' }, true, s.create())).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT' }
    });
    expect(s.send).toHaveBeenCalledOnce();
    s.advance(1);
    expect((await s.handle({ ...quote, action: 'quote' }, true, s.create())).ok).toBe(true);
    expect(s.send).toHaveBeenCalledTimes(2);
  });

  it('counts unknown and lease-expired crashed attempts toward the daily ceiling after config clear', async () => {
    const s = setup();
    await s.save();
    s.corrupt({
      ...s.state(),
      claims: [
        {
          requestId: crypto.randomUUID(),
          attemptedAtUtc: Date.UTC(2026, 10, 9),
          revision: 1,
          completedAtUtc: null
        }
      ]
    });
    s.advance(60_000);
    s.send.mockRejectedValue(new Error('Fixture unknown outcome'));
    for (let index = 0; index < 9; index++)
      expect(await s.handle({ ...shippingQuote(), action: 'quote' })).toMatchObject({
        error: { code: 'SHIPPING_QUOTE_OUTCOME_UNKNOWN' }
      });
    await s.handle({ action: 'clear', expectedRevision: 1 });
    await s.save();
    expect(
      await s.handle({ ...shippingQuote(), action: 'quote', expectedRevision: 2 }, true, s.create())
    ).toMatchObject({ error: { code: 'SHIPPING_LOCAL_DAILY_LIMIT' } });
    expect(s.send).toHaveBeenCalledTimes(9);
    expect(s.state().claims).toHaveLength(10);
  });

  it('rechecks a grant revoked between claiming and dispatch without sending or refunding the claim', async () => {
    const s = setup();
    await s.save();
    s.contains.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await s.handle({ ...shippingQuote(), action: 'quote' })).ok).toBe(false);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.state().claims).toHaveLength(1);
    expect(s.state().claims[0]?.completedAtUtc).not.toBeNull();
  });

  it('keeps the ten-attempt UTC day ceiling across restart, provider clear and credential replacement', async () => {
    const s = setup();
    await s.save();
    for (let index = 0; index < 10; index++)
      expect((await s.handle({ ...shippingQuote(), action: 'quote' })).ok).toBe(true);
    expect(await s.handle({ ...shippingQuote(), action: 'quote' }, true, s.create())).toMatchObject({
      error: { code: 'SHIPPING_LOCAL_DAILY_LIMIT' }
    });
    await s.handle({ action: 'clear', expectedRevision: 1 });
    await s.save();
    expect(await s.handle({ ...shippingQuote(), action: 'quote', expectedRevision: 2 })).toMatchObject({
      error: { code: 'SHIPPING_LOCAL_DAILY_LIMIT' }
    });
    expect(s.send).toHaveBeenCalledTimes(10);
    s.nextDay();
    expect((await s.handle({ ...shippingQuote(), action: 'quote', expectedRevision: 2 })).ok).toBe(true);
  });

  it('queues full local reset behind an active quote and removes configuration, ledger and device key', async () => {
    const s = setup();
    await s.save();
    let finish!: () => void;
    s.send.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            resolve(Response.json(freightosResponse));
          };
        })
    );
    const quote = s.handle({ ...shippingQuote(), action: 'quote' });
    await vi.waitFor(() => {
      expect(s.send).toHaveBeenCalledOnce();
    });
    const reset = s.service.reset();
    expect(s.store.remove).not.toHaveBeenCalled();
    finish();
    await quote;
    await reset;
    expect(await s.store.read()).toBeUndefined();
    expect(await s.store.key(false)).toBeNull();
    expect(await s.handle({ action: 'configuration' }, true, s.create())).toMatchObject({
      data: { configured: false, revision: null }
    });
  });
});
