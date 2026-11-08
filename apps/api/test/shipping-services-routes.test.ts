import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ShippingProvider from '@one-vegetable/core/shipping-quote-provider';
import { requestShippingQuote } from '@one-vegetable/core/shipping-quote-provider';
import {
  parseShippingConfigurationSummary,
  parseShippingQuoteResult
} from '@one-vegetable/core/shipping-services';
import { createApiApp } from '../src/app';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlShippingServicesRepository } from '../src/shipping-services/repository';
import { ShippingServicesCipher, ShippingServicesService } from '../src/shipping-services/service';
import {
  shippingQuote,
  shippingSave,
  SHIPPING_TEST_API_KEY,
  SHIPPING_TEST_ENCRYPTION_KEY
} from './shipping-services-fixture';

vi.mock('@one-vegetable/core/shipping-quote-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof ShippingProvider>()),
  requestShippingQuote: vi.fn()
}));

let database: NodeDatabaseHandle;
const send = vi.mocked(requestShippingQuote);
beforeEach(() => {
  send.mockReset();
});
afterEach(() => {
  database.connection.close();
});

async function setup() {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const authService = new AuthService({
    repository: new SqlAuthRepository(database.executor),
    bootstrapToken: 'fixture-bootstrap-token-that-is-long'
  });
  const service = new ShippingServicesService(
    new SqlShippingServicesRepository(database.executor),
    await ShippingServicesCipher.create(SHIPPING_TEST_ENCRYPTION_KEY)
  );
  const factory = vi.fn(() => Promise.resolve(service));
  const logger = vi.fn();
  const app = createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'disabled',
    authService,
    shippingServices: factory,
    logger
  });
  const session = await authService.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'fixture-bootstrap-token-that-is-long',
    username: 'fixture-admin',
    password: 'fixture-password'
  });
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost',
    Cookie: `ov_session=${session.sessionToken}`,
    'X-CSRF-Token': session.session.csrfToken
  };
  const post = (action: string, body: unknown, customHeaders = headers) =>
    app.request(`/api/v1/admin/shipping-services/${action}`, {
      method: 'POST',
      headers: customHeaders,
      // Command fixtures include action, but the public HTTP body never does.
      body:
        typeof body === 'string'
          ? body
          : JSON.stringify(
              body && typeof body === 'object' && !Array.isArray(body) ? { ...body, action: undefined } : body
            )
    });
  return { app, service, session, headers, post, factory, logger };
}

describe('admin shipping service routes', () => {
  it('requires session, CSRF, allowed Origin and admin on every route before loading service', async () => {
    const { post, headers, session, factory } = await setup();
    const bodies = {
      configuration: { requestId: crypto.randomUUID(), provider: 'freightos' },
      save: shippingSave(),
      clear: { requestId: crypto.randomUUID(), provider: 'freightos', expectedRevision: 1 },
      quote: shippingQuote()
    };
    for (const [action, body] of Object.entries(bodies)) {
      expect((await post(action, body, { ...headers, Cookie: '' })).status).toBe(401);
      expect((await post(action, body, { ...headers, 'X-CSRF-Token': '' })).status).toBe(403);
      expect((await post(action, body, { ...headers, Origin: 'https://untrusted.invalid' })).status).toBe(
        403
      );
    }
    await database.executor.execute("UPDATE users SET role = 'user' WHERE id = ?", [session.user.id]);
    for (const [action, body] of Object.entries(bodies)) {
      const response = await post(action, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'ADMIN_REQUIRED', message: 'ADMIN_REQUIRED', retryable: false }
      });
    }
    expect(factory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('honors all four route contracts without Alibaba auth or a returned key', async () => {
    const { post, logger } = await setup();
    const saved = await post('save', shippingSave());
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { data: unknown };
    expect(parseShippingConfigurationSummary(savedBody.data)).toMatchObject({
      configured: true,
      revision: 1
    });
    const current = await post('configuration', { requestId: crypto.randomUUID(), provider: 'freightos' });
    expect(current.headers.get('Cache-Control')).toBe('no-store');
    expect(
      parseShippingConfigurationSummary(((await current.json()) as { data: unknown }).data)
    ).toMatchObject({ configured: true });
    send.mockImplementation((input) =>
      Promise.resolve({
        requestId: input.requestId,
        provider: input.provider,
        quotedAtUtc: Date.now(),
        options: [
          {
            id: 'fixture-estimate',
            provider: 'freightos',
            kind: 'market-estimate',
            serviceName: 'Fixture market estimate',
            mode: 'air',
            amount: '100',
            currency: 'USD',
            transitDaysFrom: null,
            transitDaysTo: null
          }
        ],
        searchUrl: null
      })
    );
    const quote = shippingQuote();
    const response = await post('quote', quote);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-ID')).toBe(quote.requestId);
    const text = await response.text();
    expect(parseShippingQuoteResult((JSON.parse(text) as { data: unknown }).data).options[0]?.kind).toBe(
      'market-estimate'
    );
    expect(text).not.toContain(SHIPPING_TEST_API_KEY);
    const duplicate = await post('quote', quote);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: 'SHIPPING_QUOTE_ALREADY_SENT', retryable: false }
    });
    const cleared = await post('clear', {
      requestId: crypto.randomUUID(),
      provider: 'freightos',
      expectedRevision: 1
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ ok: true, data: null });
    const stale = await post('save', shippingSave(1));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'SHIPPING_CONFIGURATION_CHANGED' } });
    expect(send).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(logger.mock.calls);
    for (const forbidden of [SHIPPING_TEST_API_KEY, 'Shenzhen', 'Los Angeles', 'Fixture shipment'])
      expect(logs).not.toContain(forbidden);
  });

  it('rejects malformed/oversize bodies, extra fields, mismatched actions and absent consent before loading service', async () => {
    const { post, headers, factory } = await setup();
    const quote = shippingQuote();
    for (const body of [
      '{',
      null,
      [],
      { ...quote, extra: 'not allowed' },
      JSON.stringify({ ...quote, action: 'save' }),
      JSON.stringify({ ...quote, action: 'quote' }),
      { ...quote, consent: { dataSharing: false, costAcknowledged: true } },
      { ...quote, provider: 'unsupported' },
      { ...quote, expectedRevision: null }
    ]) {
      expect((await post('quote', body)).status).toBe(400);
    }
    expect((await post('quote', quote, { ...headers, 'Content-Type': 'text/plain' })).status).toBe(400);
    const oversized = await post('save', { ...shippingSave(), apiKey: 'x'.repeat(17 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('Cache-Control')).toBe('no-store');
    expect(await oversized.json()).toMatchObject({
      error: { code: 'SHIPPING_REQUEST_TOO_LARGE', retryable: false }
    });
    expect(factory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected failures and never retries provider calls', async () => {
    const { post, service, session } = await setup();
    await service.execute(session.user.id, shippingSave());
    send.mockRejectedValueOnce(new Error('RAW_PRIVATE_PROVIDER_BODY_WITH_SECRET'));
    const input = shippingQuote();
    const response = await post('quote', input);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('RAW_PRIVATE');
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'SHIPPING_SERVICES_FAILED', message: 'SHIPPING_SERVICES_FAILED', retryable: false }
    });
    expect((await post('quote', input)).status).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
