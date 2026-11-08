import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { NetworkTransport } from '@one-vegetable/core/network';
import { parseShippingQuoteResult } from '@one-vegetable/core/shipping-services';
import estimate from '../../../mock/data/shipping-services/freightos-estimate.json';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { openD1Database } from '../src/db/d1-database';
import { SqlShippingServicesRepository } from '../src/shipping-services/repository';
import { registerShippingServicesRoutes } from '../src/shipping-services/routes';
import { ShippingServicesCipher, ShippingServicesService } from '../src/shipping-services/service';
import {
  shippingQuote,
  shippingSave,
  SHIPPING_TEST_API_KEY,
  SHIPPING_TEST_ENCRYPTION_KEY
} from '../test/shipping-services-fixture';

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function setup() {
  const executor = openD1Database(env.DB).executor;
  const owner = crypto.randomUUID();
  const repository = () => new SqlShippingServicesRepository(executor);
  const cipher = await ShippingServicesCipher.create(SHIPPING_TEST_ENCRYPTION_KEY);
  const send = vi.fn<NetworkTransport['send']>(() => Promise.resolve(Response.json(estimate)));
  const service = () => new ShippingServicesService(repository(), cipher, Date.now, { send });
  return { executor, owner, repository, cipher, send, service };
}

it('replays authenticated CN-origin market estimates in workerd, durably claims before dispatch and blocks replay after reopening', async () => {
  const { executor, repository, send, service } = await setup();
  const auth = new AuthService({
    repository: new SqlAuthRepository(executor),
    bootstrapToken: 'fixture-bootstrap-token-that-is-long'
  });
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'fixture-bootstrap-token-that-is-long',
    username: 'fixture-admin',
    password: 'fixture-password'
  });
  const owner = session.user.id;
  await service().execute(owner, shippingSave());
  const app = new Hono();
  registerShippingServicesRoutes(app, { authService: auth, service: () => Promise.resolve(service()) });
  const input = shippingQuote();
  input.shipment.mode = 'lcl';
  send.mockImplementation(async (url, init) => {
    expect(await repository().hasAttempt(owner, input.requestId)).toBe(true);
    const request = new Request(url, init);
    expect(request.url).toBe('https://ship.freightos.com/api/rate-estimate/v1/search');
    expect(request.method).toBe('POST');
    expect(request.headers.get('apiKey')).toBe(SHIPPING_TEST_API_KEY);
    expect(request.headers.has('cookie')).toBe(false);
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('manual');
    return Response.json(estimate);
  });
  const post = (body: typeof input, csrf = session.session.csrfToken) =>
    app.request('/admin/shipping-services/quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Cookie: `ov_session=${session.sessionToken}`,
        'X-CSRF-Token': csrf
      },
      body: JSON.stringify({ ...body, action: undefined })
    });
  expect((await post(input, '')).status).toBe(403);
  expect((await post({ ...input, consent: { dataSharing: false, costAcknowledged: true } })).status).toBe(
    400
  );
  expect((await post({ ...input, expectedRevision: 9 })).status).toBe(409);
  expect(send).not.toHaveBeenCalled();
  const response = await post(input);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json<{ data: unknown }>();
  expect(parseShippingQuoteResult(body.data).options[0]).toMatchObject({
    kind: 'market-estimate',
    amount: '394.43'
  });
  await expect(service().execute(owner, input)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
  expect(send).toHaveBeenCalledTimes(1);
  const receipt = JSON.stringify(
    await executor.query('SELECT * FROM shipping_quote_attempts WHERE owner_id = ?', [owner])
  );
  for (const forbidden of [
    SHIPPING_TEST_API_KEY,
    'Shenzhen',
    'Los Angeles',
    'Fixture shipment',
    '394.43',
    estimate.requestId
  ])
    expect(receipt).not.toContain(forbidden);
});

it('enforces D1 configuration CAS/AAD and atomic duplicate/day/serial claims across repository instances', async () => {
  const { owner, repository, cipher, service } = await setup();
  const saved = await Promise.allSettled([
    service().execute(owner, shippingSave()),
    service().execute(owner, shippingSave())
  ]);
  expect(saved.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const record = await repository().find(owner, 'freightos');
  if (!record) throw new Error('Missing test record');
  await expect(cipher.decrypt({ ...record, ownerId: crypto.randomUUID() })).rejects.toThrow(
    'SHIPPING_CONFIGURATION_UNREADABLE'
  );
  const now = Date.now();
  const id = crypto.randomUUID();
  const duplicate = await Promise.allSettled([
    repository().claim(record, id, now),
    repository().claim(record, id, now)
  ]);
  expect(duplicate.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(duplicate.filter((item) => item.status === 'rejected')).toMatchObject([
    { reason: { code: 'SHIPPING_QUOTE_ALREADY_SENT' } }
  ]);
  await expect(repository().claim(record, crypto.randomUUID(), now)).rejects.toThrow(
    'SHIPPING_QUOTE_IN_PROGRESS'
  );
  await repository().complete(owner, id, now);
  for (let i = 1; i < 9; i++) {
    const next = crypto.randomUUID();
    await repository().claim(record, next, now);
    await repository().complete(owner, next, now);
  }
  const races = await Promise.allSettled(
    Array.from({ length: 3 }, () => repository().claim(record, crypto.randomUUID(), now))
  );
  expect(races.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(races.filter((item) => item.status === 'rejected')).toMatchObject([
    { reason: { code: 'SHIPPING_LOCAL_DAILY_LIMIT' } },
    { reason: { code: 'SHIPPING_LOCAL_DAILY_LIMIT' } }
  ]);
  await service().execute(owner, shippingSave(1));
  await expect(repository().claim(record, crypto.randomUUID(), now)).rejects.toThrow(
    'SHIPPING_CONFIGURATION_CHANGED'
  );
});

it('does not retry a provider failure and counts it as an attempt in D1', async () => {
  const { owner, executor, send, service } = await setup();
  await service().execute(owner, shippingSave());
  send.mockImplementation(() =>
    Promise.resolve(Response.json({ secret: 'do-not-store-provider-body' }, { status: 503 }))
  );
  const input = shippingQuote();
  await expect(service().execute(owner, input)).rejects.toThrow('SHIPPING_QUOTE_PROVIDER_UNAVAILABLE');
  await expect(service().execute(owner, input)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
  expect(send).toHaveBeenCalledTimes(1);
  const rows = await executor.query('SELECT * FROM shipping_quote_attempts WHERE owner_id = ?', [owner]);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.completed_at_utc).not.toBeNull();
  expect(JSON.stringify(rows)).not.toContain('do-not-store-provider-body');
});

it('releases a crashed D1 serial lease after 60 seconds without releasing its request ID or daily count', async () => {
  const { owner, repository, service, executor, send } = await setup();
  await service().execute(owner, shippingSave());
  const record = await repository().find(owner, 'freightos');
  if (!record) throw new Error('Missing fixture configuration');
  const now = Date.now();
  const interruptedId = crypto.randomUUID();
  await repository().claim(record, interruptedId, now);
  await repository().prune(owner, now + 59_999);
  await expect(repository().claim(record, crypto.randomUUID(), now + 59_999)).rejects.toThrow(
    'SHIPPING_QUOTE_IN_PROGRESS'
  );
  await repository().prune(owner, now + 60_000);
  await repository().claim(record, crypto.randomUUID(), now + 60_000);
  await expect(repository().claim(record, interruptedId, now + 60_000)).rejects.toThrow(
    'SHIPPING_QUOTE_ALREADY_SENT'
  );
  await repository().complete(owner, interruptedId, now + 60_001, false);
  const records = await executor.query('SELECT * FROM shipping_quote_attempts WHERE owner_id = ?', [owner]);
  expect(records).toHaveLength(2);
  expect(records.find((row) => row.request_id === interruptedId)).toMatchObject({
    outcome_unknown: 1,
    completed_at_utc: now + 60_000
  });
  expect(send).not.toHaveBeenCalled();
});
