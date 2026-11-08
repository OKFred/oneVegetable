import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ShippingCore from '@one-vegetable/core/shipping-services';
import {
  parseShippingConfigurationSummary,
  requestShippingQuote,
  ShippingServicesError,
  type ShippingProviderId,
  type ShippingQuoteRequest,
  type ShippingQuoteResult
} from '@one-vegetable/core/shipping-services';
import {
  applyNodeMigrations,
  isNodeDatabaseReady,
  openNodeDatabase,
  type NodeDatabaseHandle
} from '../src/db/node-database';
import { SqlShippingServicesRepository } from '../src/shipping-services/repository';
import { ShippingServicesCipher, ShippingServicesService } from '../src/shipping-services/service';
import {
  shippingQuote,
  shippingSave,
  SHIPPING_TEST_API_KEY,
  SHIPPING_TEST_ENCRYPTION_KEY
} from './shipping-services-fixture';

vi.mock('@one-vegetable/core/shipping-services', async (importOriginal) => ({
  ...(await importOriginal<typeof ShippingCore>()),
  requestShippingQuote: vi.fn()
}));

let database: NodeDatabaseHandle;
const send = vi.mocked(requestShippingQuote);
beforeEach(() => {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  send.mockReset();
  send.mockImplementation((request) => Promise.resolve(result(request)));
});
afterEach(() => {
  database.connection.close();
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing fixture record');
  return value;
}

async function setup() {
  let now = Date.UTC(2026, 10, 9, 23, 59, 59);
  const repository = new SqlShippingServicesRepository(database.executor);
  const cipher = await ShippingServicesCipher.create(SHIPPING_TEST_ENCRYPTION_KEY);
  const service = new ShippingServicesService(repository, cipher, () => now);
  return {
    repository,
    cipher,
    service,
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    advanceDay: (days = 1) => {
      now += days * 86_400_000;
    }
  };
}

function result(request: ShippingQuoteRequest): ShippingQuoteResult {
  return {
    requestId: request.requestId,
    provider: request.provider,
    quotedAtUtc: Date.now(),
    options: [],
    searchUrl: null
  };
}

describe('shipping credential vault and durable quote gate', () => {
  it('keeps migrations idempotent and uses write-only AES-GCM bound to owner and provider', async () => {
    const { service, repository, cipher } = await setup();
    applyNodeMigrations(database);
    expect(isNodeDatabaseReady(database)).toBe(true);
    const saved = await service.execute('owner-a', shippingSave());
    expect(parseShippingConfigurationSummary(saved)).toMatchObject({ configured: true, revision: 1 });
    expect(JSON.stringify(saved)).not.toContain(SHIPPING_TEST_API_KEY);
    const record = required(await repository.find('owner-a', 'freightos'));
    expect(record.ciphertext).not.toContain(SHIPPING_TEST_API_KEY);
    await expect(cipher.decrypt(record)).resolves.toBe(SHIPPING_TEST_API_KEY);
    await expect(cipher.decrypt({ ...record, ownerId: 'owner-b' })).rejects.toThrow(
      'SHIPPING_CONFIGURATION_UNREADABLE'
    );
    await expect(cipher.decrypt({ ...record, provider: 'other' as ShippingProviderId })).rejects.toThrow(
      'SHIPPING_CONFIGURATION_UNREADABLE'
    );
    await expect(
      cipher.decrypt({ ...record, ciphertext: required(record.ciphertext).slice(1) })
    ).rejects.toThrow('SHIPPING_CONFIGURATION_UNREADABLE');
    await expect(ShippingServicesCipher.create(undefined)).rejects.toThrow(
      'SHIPPING_CREDENTIAL_ENCRYPTION_KEY_INVALID'
    );
    const second = await cipher.encrypt('owner-a', 'freightos', SHIPPING_TEST_API_KEY);
    expect(second.initializationVector).not.toBe(record.initializationVector);
    expect(
      await service.execute('owner-b', {
        action: 'configuration',
        requestId: crypto.randomUUID(),
        provider: 'freightos'
      })
    ).toMatchObject({ configured: false, revision: null });
  });

  it('CAS protects create/update/clear and retains tombstones to reject old contexts', async () => {
    const { service, repository } = await setup();
    await expect(service.execute('owner', shippingSave(1))).rejects.toThrow('SHIPPING_CONFIGURATION_CHANGED');
    const raced = await Promise.allSettled([
      service.execute('owner', shippingSave()),
      service.execute('owner', shippingSave())
    ]);
    expect(raced.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    await expect(service.execute('owner', shippingSave())).rejects.toThrow('SHIPPING_CONFIGURATION_CHANGED');
    const old = required(await repository.find('owner', 'freightos'));
    await service.execute('owner', {
      action: 'clear',
      provider: 'freightos',
      requestId: crypto.randomUUID(),
      expectedRevision: 1
    });
    const cleared = await service.execute('owner', {
      action: 'configuration',
      provider: 'freightos',
      requestId: crypto.randomUUID()
    });
    expect(parseShippingConfigurationSummary(cleared)).toMatchObject({ configured: false, revision: 2 });
    await expect(service.execute('owner', shippingSave())).rejects.toThrow('SHIPPING_CONFIGURATION_CHANGED');
    await expect(
      service.execute('owner', {
        action: 'clear',
        provider: 'freightos',
        requestId: crypto.randomUUID(),
        expectedRevision: 1
      })
    ).rejects.toThrow('SHIPPING_CONFIGURATION_CHANGED');
    await service.execute('owner', shippingSave(2));
    await expect(service.execute('owner', shippingQuote())).rejects.toThrow('SHIPPING_CONFIGURATION_CHANGED');
    await expect(repository.claim(old, crypto.randomUUID(), Date.now())).rejects.toThrow(
      'SHIPPING_CONFIGURATION_CHANGED'
    );
    expect(send).not.toHaveBeenCalled();
    expect(await database.executor.query('SELECT * FROM shipping_quote_attempts')).toEqual([]);
  });

  it('rejects consent, missing credential, unsupported origin/provider/mode and stale revision before dispatch', async () => {
    const { service } = await setup();
    const input = shippingQuote();
    await expect(service.execute('', input)).rejects.toThrow('SHIPPING_OWNER_REQUIRED');
    await expect(
      service.execute('owner', { ...input, consent: { dataSharing: false, costAcknowledged: true } })
    ).rejects.toThrow('SHIPPING_CONSENT_REQUIRED');
    await expect(
      service.execute('owner', { ...input, consent: { dataSharing: true, costAcknowledged: false } })
    ).rejects.toThrow('SHIPPING_CONSENT_REQUIRED');
    await expect(service.execute('owner', input)).rejects.toThrow('SHIPPING_CREDENTIAL_REQUIRED');
    await service.execute('owner', shippingSave());
    await expect(service.execute('owner', { ...input, provider: 'unsupported' })).rejects.toThrow(
      'SHIPPING_REQUEST_INVALID'
    );
    await expect(
      service.execute('owner', {
        ...input,
        shipment: { ...input.shipment, origin: { ...input.shipment.origin, countryCode: 'HK' } }
      })
    ).rejects.toThrow('SHIPPING_MAINLAND_ORIGIN_REQUIRED');
    await expect(
      service.execute('owner', { ...input, shipment: { ...input.shipment, mode: 'express' } })
    ).rejects.toThrow('SHIPPING_MODE_UNAVAILABLE');
    await expect(service.execute('owner', { ...input, expectedRevision: 2 })).rejects.toThrow(
      'SHIPPING_CONFIGURATION_CHANGED'
    );
    expect(send).not.toHaveBeenCalled();
    expect(await database.executor.query('SELECT * FROM shipping_quote_attempts')).toEqual([]);
  });

  it('persists intent before dispatch, serializes concurrent requests, and never resends duplicates after restart', async () => {
    const { service, repository, cipher } = await setup();
    await service.execute('owner', shippingSave());
    const input = shippingQuote();
    let release!: () => void;
    let entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    send.mockImplementationOnce(async (request) => {
      expect(await repository.hasAttempt('owner', input.requestId)).toBe(true);
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result(request);
    });
    const pending = service.execute('owner', input);
    await dispatched;
    try {
      await expect(service.execute('owner', input)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
      await expect(service.execute('owner', shippingQuote())).rejects.toThrow('SHIPPING_QUOTE_IN_PROGRESS');
    } finally {
      release();
    }
    await pending;
    await expect(
      new ShippingServicesService(new SqlShippingServicesRepository(database.executor), cipher).execute(
        'owner',
        input
      )
    ).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      service.execute('owner', { ...input, requestId: input.requestId.toUpperCase() })
    ).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
    expect(send.mock.calls[0]?.[1]).toBe(SHIPPING_TEST_API_KEY);
    const receipt = JSON.stringify(await database.executor.query('SELECT * FROM shipping_quote_attempts'));
    for (const privateValue of [
      SHIPPING_TEST_API_KEY,
      'Shenzhen',
      'Los Angeles',
      'Fixture shipment',
      '518000'
    ])
      expect(receipt).not.toContain(privateValue);
  });

  it('counts failed calls without retry, enforces ten per UTC day/admin/provider and keeps deduplication across days', async () => {
    const { service, advanceDay } = await setup();
    await service.execute('owner-a', shippingSave());
    await service.execute('owner-b', shippingSave());
    send.mockRejectedValue(new ShippingServicesError('SHIPPING_PROVIDER_RATE_LIMIT'));
    const first = shippingQuote();
    for (let i = 0; i < 10; i++)
      await expect(service.execute('owner-a', i === 0 ? first : shippingQuote())).rejects.toThrow(
        'SHIPPING_PROVIDER_RATE_LIMIT'
      );
    expect(send).toHaveBeenCalledTimes(10);
    await expect(service.execute('owner-a', shippingQuote())).rejects.toThrow('SHIPPING_LOCAL_DAILY_LIMIT');
    await service.execute('owner-a', {
      action: 'clear',
      requestId: crypto.randomUUID(),
      provider: 'freightos',
      expectedRevision: 1
    });
    await service.execute('owner-a', shippingSave(2));
    await expect(service.execute('owner-a', { ...shippingQuote(), expectedRevision: 3 })).rejects.toThrow(
      'SHIPPING_LOCAL_DAILY_LIMIT'
    );
    await expect(service.execute('owner-a', first)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
    await expect(service.execute('owner-b', shippingQuote())).rejects.toThrow('SHIPPING_PROVIDER_RATE_LIMIT');
    advanceDay();
    await expect(service.execute('owner-a', first)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
    await expect(service.execute('owner-a', { ...shippingQuote(), expectedRevision: 3 })).rejects.toThrow(
      'SHIPPING_PROVIDER_RATE_LIMIT'
    );
    expect(send).toHaveBeenCalledTimes(12);
  });

  it('expires only the 60-second serial lease, retaining the unknown request and its quota count', async () => {
    const { service, repository, advance, now } = await setup();
    await service.execute('owner', shippingSave());
    const record = required(await repository.find('owner', 'freightos'));
    const interruptedId = crypto.randomUUID();
    await repository.claim(record, interruptedId, now());
    advance(59_999);
    await expect(service.execute('owner', shippingQuote())).rejects.toThrow('SHIPPING_QUOTE_IN_PROGRESS');
    expect(send).not.toHaveBeenCalled();
    advance(1);
    await service.execute('owner', shippingQuote());
    await expect(service.execute('owner', { ...shippingQuote(), requestId: interruptedId })).rejects.toThrow(
      'SHIPPING_QUOTE_ALREADY_SENT'
    );
    await repository.complete('owner', interruptedId, now(), false);
    const records = await database.executor.query('SELECT * FROM shipping_quote_attempts');
    expect(records).toHaveLength(2);
    expect(records.find((row) => row.request_id === interruptedId)).toMatchObject({
      outcome_unknown: 1,
      completed_at_utc: now()
    });
    expect(send).toHaveBeenCalledTimes(1);
    vi.spyOn(repository, 'claim').mockRejectedValueOnce(new Error('fixture database failure'));
    await expect(service.execute('owner', shippingQuote())).rejects.toThrow('fixture database failure');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown attempts for 30 days, prunes only expired metadata and never auto-dispatches cleanup', async () => {
    const { service, repository, advanceDay, now } = await setup();
    await service.execute('owner', shippingSave());
    const input = shippingQuote();
    send.mockRejectedValueOnce(new ShippingServicesError('SHIPPING_QUOTE_OUTCOME_UNKNOWN'));
    await expect(service.execute('owner', input)).rejects.toThrow('SHIPPING_QUOTE_OUTCOME_UNKNOWN');
    advanceDay(29);
    await expect(service.execute('owner', input)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
    expect(send).toHaveBeenCalledTimes(1);
    advanceDay(2);
    await service.execute('owner', input);
    expect(send).toHaveBeenCalledTimes(2);
    const record = required(await repository.find('owner', 'freightos'));
    await repository.claim(record, crypto.randomUUID(), now());
    advanceDay(31);
    await service.execute('owner', {
      action: 'configuration',
      requestId: crypto.randomUUID(),
      provider: 'freightos'
    });
    expect(await database.executor.query('SELECT * FROM shipping_quote_attempts')).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
