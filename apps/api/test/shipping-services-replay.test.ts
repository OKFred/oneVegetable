import { afterEach, expect, it, vi } from 'vitest';
import type { NetworkTransport } from '@one-vegetable/core/network';
import { parseShippingQuoteResult } from '@one-vegetable/core/shipping-services';
import estimate from '../../../mock/data/shipping-services/freightos-estimate.json';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlShippingServicesRepository } from '../src/shipping-services/repository';
import { ShippingServicesCipher, ShippingServicesService } from '../src/shipping-services/service';
import {
  shippingQuote,
  shippingSave,
  SHIPPING_TEST_API_KEY,
  SHIPPING_TEST_ENCRYPTION_KEY
} from './shipping-services-fixture';

let database: NodeDatabaseHandle | undefined;
afterEach(() => {
  database?.connection.close();
});

it('replays the shared Freightos adapter through Node with a persisted claim and no native transport', async () => {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const repository = new SqlShippingServicesRepository(database.executor);
  const input = shippingQuote();
  input.shipment.mode = 'lcl';
  const send = vi.fn<NetworkTransport['send']>(async (url, init) => {
    expect(await repository.hasAttempt('fixture-owner', input.requestId)).toBe(true);
    expect(new Request(url, init).url).toBe('https://ship.freightos.com/api/rate-estimate/v1/search');
    expect(new Headers(init.headers).get('apiKey')).toBe(SHIPPING_TEST_API_KEY);
    return Response.json(estimate);
  });
  const service = new ShippingServicesService(
    repository,
    await ShippingServicesCipher.create(SHIPPING_TEST_ENCRYPTION_KEY),
    Date.now,
    { send }
  );
  await service.execute('fixture-owner', shippingSave());
  const quote = parseShippingQuoteResult(await service.execute('fixture-owner', input));
  expect(quote.options[0]).toMatchObject({ kind: 'market-estimate', amount: '394.43', currency: 'USD' });
  await expect(service.execute('fixture-owner', input)).rejects.toThrow('SHIPPING_QUOTE_ALREADY_SENT');
  expect(send).toHaveBeenCalledTimes(1);
});
