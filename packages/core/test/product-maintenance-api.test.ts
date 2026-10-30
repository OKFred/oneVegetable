import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_MAINTENANCE_METHODS,
  ProductMaintenanceAdapter,
  buildProductPriceRequest,
  buildProductInventoryRequest,
  buildProductDraftDeleteRequest,
  validateProductPriceDraft,
  validateProductInventoryDraft,
  validateProductDraftDeleteDraft,
  canonicalizeProductMaintenanceDraft,
  createProductMaintenanceIntent,
  classifyProductMaintenanceResponse,
  classifyProductMaintenanceError,
  comparePriceReadback,
  compareInventoryReadback
} from '../src/product-maintenance-api';
import type {
  ProductMaintenanceCoordinator,
  ProductMaintenanceResult,
  ProductMaintenanceSnapshot
} from '../src/product-maintenance-api';

interface Fixture {
  persistedIntentId: string;
  drafts: Record<string, unknown>;
  requests: Record<string, unknown>;
  snapshots: Record<string, ProductMaintenanceSnapshot>;
  responses: Record<string, unknown>;
  errors: Record<string, unknown>;
  invalidPrices: unknown[];
  invalidInventories: unknown[];
  invalidDeletes: unknown[];
}
const fixture = JSON.parse(
  await readFile(new URL('../../../mock/data/product-maintenance-api.json', import.meta.url), 'utf8')
) as Fixture;
function draft(name: string): unknown {
  return fixture.drafts[name];
}
function snapshot(name = 'matching'): ProductMaintenanceSnapshot {
  const value = fixture.snapshots[name];
  if (!value) throw new Error('Missing synthetic snapshot');
  return value;
}
function response(name: string): unknown {
  return fixture.responses[name];
}
function coordinator(reference?: ProductMaintenanceSnapshot): ProductMaintenanceCoordinator {
  return {
    run: (intent, send) =>
      send({
        protocol: 'iop',
        persistedIntentId: fixture.persistedIntentId,
        fingerprint: intent.fingerprint,
        ...(reference ? { reference } : {})
      })
  };
}
function client(name = 'accepted') {
  return { call: vi.fn((method: string) => Promise.resolve({ method, data: response(name) })) };
}

describe('strict native IOP product maintenance requests', () => {
  it.each(['tiered', 'range', 'skuPrice'])('builds only intended price fields: %s', (name) => {
    const request = buildProductPriceRequest(draft(name));
    expect(request.protocol).toBe('iop');
    expect(request.method).toBe(PRODUCT_MAINTENANCE_METHODS.setPrice);
    expect(request.parameters).toEqual(fixture.requests[name]);
    expect(validateProductPriceDraft(draft(name))).toBe(true);
  });
  it.each(['inventory', 'skuInventory'])('sets absolute inventory: %s', (name) => {
    const request = buildProductInventoryRequest(draft(name));
    expect(request.method).toBe(PRODUCT_MAINTENANCE_METHODS.setInventory);
    expect(request.parameters).toEqual(fixture.requests[name]);
    expect(validateProductInventoryDraft(draft(name))).toBe(true);
    expect(request.parameters).not.toHaveProperty('delta');
  });
  it.each(['deleteOne', 'deleteBatch'])('deletes known drafts only: %s', (name) => {
    expect(buildProductDraftDeleteRequest(draft(name)).parameters).toEqual(fixture.requests[name]);
    expect(validateProductDraftDeleteDraft(draft(name))).toBe(true);
  });
  it('preserves Long IDs and counts as exact strings beyond Number precision', () => {
    const request = buildProductInventoryRequest(draft('largeId'));
    expect(request.parameters.product_id).toBe('9223372036854775807');
    expect(request.parameters.inventory).toBe('9223372036854775807');
  });
  it.each(fixture.invalidPrices.map((value, index) => ({ value, index })))(
    'rejects malformed, unsafe, unknown or conflicting prices #$index',
    ({ value }) => {
      expect(validateProductPriceDraft(value)).toBe(false);
      expect(() => buildProductPriceRequest(value)).toThrow('PRODUCT_MAINTENANCE_INPUT_INVALID');
    }
  );
  it.each(fixture.invalidInventories.map((value, index) => ({ value, index })))(
    'rejects malformed counts, delta fields, maps and mixed inventories #$index',
    ({ value }) => {
      expect(validateProductInventoryDraft(value)).toBe(false);
      expect(() => buildProductInventoryRequest(value)).toThrow('PRODUCT_MAINTENANCE_INPUT_INVALID');
    }
  );
  it.each(fixture.invalidDeletes.map((value, index) => ({ value, index })))(
    'rejects unknown/formal IDs, unconfirmed lists and duplicate drafts #$index',
    ({ value }) => {
      expect(validateProductDraftDeleteDraft(value)).toBe(false);
      expect(() => buildProductDraftDeleteRequest(value)).toThrow('PRODUCT_MAINTENANCE_INPUT_INVALID');
    }
  );
});

describe('intent identity and readback evidence', () => {
  it('canonicalizes key order and deep-freezes exact dispatch parameters', async () => {
    const input = draft('tiered') as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(input).reverse());
    const first = await createProductMaintenanceIntent(input);
    const second = await createProductMaintenanceIntent(reversed);
    expect(canonicalizeProductMaintenanceDraft(input)).toBe(canonicalizeProductMaintenanceDraft(reversed));
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.parameters)).toBe(true);
    expect(Object.isFrozen(first.draft)).toBe(true);
  });
  it('keeps different exact decimal prices and actions distinct', async () => {
    expect((await createProductMaintenanceIntent(draft('tiered'))).fingerprint).not.toBe(
      (await createProductMaintenanceIntent(draft('range'))).fingerprint
    );
    expect((await createProductMaintenanceIntent(draft('inventory'))).fingerprint).not.toBe(
      (await createProductMaintenanceIntent(draft('skuInventory'))).fingerprint
    );
  });
  it.each(['tiered', 'range', 'skuPrice'])('compares exact price readback %s without floats', (name) => {
    expect(comparePriceReadback(draft(name), snapshot(name === 'range' ? 'range' : 'matching')).status).toBe(
      'matched'
    );
  });
  it('detects a price difference below floating-point precision', () => {
    expect(comparePriceReadback(draft('skuPrice'), snapshot('priceMismatch')).status).toBe('mismatched');
  });
  it('does not guess an existing SKU currency', () => {
    expect(comparePriceReadback(draft('skuPrice'), snapshot('currencyMismatch')).status).toBe('mismatched');
    expect(comparePriceReadback(draft('skuPrice'), snapshot('missingCurrency')).status).toBe('unavailable');
  });
  it.each(['missingSku', 'duplicateSku'])(
    'does not manufacture missing/duplicate SKU evidence: %s',
    (name) => {
      expect(comparePriceReadback(draft('skuPrice'), snapshot(name)).status).toBe('unavailable');
    }
  );
  it.each(['missingPrice', 'duplicateTier'])(
    'does not manufacture missing/duplicate tier evidence: %s',
    (name) => {
      expect(comparePriceReadback(draft('tiered'), snapshot(name)).status).not.toBe('matched');
    }
  );
  it.each(['inventory', 'skuInventory'])('compares SPU or selected SKU inventory: %s', (name) => {
    expect(compareInventoryReadback(draft(name), snapshot()).status).toBe('matched');
  });
  it('keeps missing inventory separate from zero', () => {
    expect(compareInventoryReadback(draft('inventory'), snapshot('missingInventory')).status).toBe(
      'unavailable'
    );
    expect(compareInventoryReadback(draft('inventory'), snapshot('malformedInventory')).status).toBe(
      'unavailable'
    );
    expect(compareInventoryReadback(draft('inventory'), snapshot('inventoryMismatch')).status).toBe(
      'mismatched'
    );
  });
  it('rejects another product as readback evidence', () => {
    expect(comparePriceReadback(draft('tiered'), snapshot('wrongProduct')).status).toBe('mismatched');
    expect(compareInventoryReadback(draft('inventory'), snapshot('wrongProduct')).status).toBe('mismatched');
  });
});

describe('explicit business outcomes, not HTTP success', () => {
  it.each(['accepted', 'acceptedString'])('recognizes documented success representations: %s', (name) => {
    expect(classifyProductMaintenanceResponse(draft('tiered'), response(name))).toMatchObject({
      status: 'accepted',
      protocol: 'iop',
      readbackRequired: true
    });
    expect(classifyProductMaintenanceResponse(draft('inventory'), response(name)).status).toBe('accepted');
  });
  it('recognizes explicit rejection and omits provider messages/raw responses', () => {
    const outcome = classifyProductMaintenanceResponse(draft('tiered'), response('rejected'));
    expect(outcome.status).toBe('rejected');
    expect(outcome).not.toHaveProperty('data');
    expect(outcome).not.toHaveProperty('message');
    expect(JSON.stringify(outcome)).not.toContain('Synthetic rejection');
  });
  it.each(['httpOnly', 'rootSuccessOnly', 'wrongSuccess', 'contradictory', 'wrongData', 'apiError', 'empty'])(
    'keeps insufficient/contradictory price evidence ambiguous: %s',
    (name) => {
      expect(classifyProductMaintenanceResponse(draft('tiered'), response(name)).status).toBe('ambiguous');
    }
  );
  it.each(['deleteOne', 'deleteBatch'])('requires correlated deleted IDs: %s', (name) => {
    const outcome = classifyProductMaintenanceResponse(draft(name), response(name));
    expect(outcome.status).toBe('accepted');
    expect(outcome.items?.every((item) => item.status === 'reported-deleted')).toBe(true);
    expect(outcome.readbackRequired).toBe(true);
  });
  it('records per-ID partial failure even when top-level success is false', () => {
    const outcome = classifyProductMaintenanceResponse(draft('deleteBatch'), response('partial'));
    expect(outcome.status).toBe('partial');
    expect(outcome.items?.map((item) => item.status)).toEqual(['reported-deleted', 'rejected']);
  });
  it('keeps opaque draft_id Object errors uncorrelated, not guessed', () => {
    const outcome = classifyProductMaintenanceResponse(draft('deleteBatch'), response('opaquePartial'));
    expect(outcome.status).toBe('partial');
    expect(outcome.items?.map((item) => item.status)).toEqual(['reported-deleted', 'ambiguous']);
    expect(classifyProductMaintenanceResponse(draft('deleteBatch'), response('deleteUnknown')).status).toBe(
      'ambiguous'
    );
  });
  it('rejects a single explicitly failed deletion without inferring batch-wide failures', () => {
    expect(classifyProductMaintenanceResponse(draft('deleteOne'), response('deleteRejected')).status).toBe(
      'rejected'
    );
  });
  it('does not claim all IDs deleted when success true omits some', () => {
    const outcome = classifyProductMaintenanceResponse(draft('deleteBatch'), response('deleteMissing'));
    expect(outcome.status).toBe('partial');
    expect(outcome.items?.[1]?.status).toBe('ambiguous');
  });
  it.each([
    'deleteHttpOnly',
    'deleteForeign',
    'deleteUnsafe',
    'deleteDuplicate',
    'deleteConflict',
    'deleteOpaque'
  ])('does not infer deletion from malformed/contradictory evidence: %s', (name) => {
    expect(classifyProductMaintenanceResponse(draft('deleteOne'), response(name)).status).toBe('ambiguous');
  });
  it.each(['network', 'timeout', 'upstream', 'unknown', 'business'])(
    'keeps thrown outcome unknown: %s',
    (name) => {
      const outcome = classifyProductMaintenanceError('setPrice', fixture.errors[name]);
      expect(outcome.status).toBe('ambiguous');
      expect(JSON.stringify(outcome)).not.toContain('Synthetic private detail');
    }
  );
  it('recognizes a known permission rejection separately', () => {
    expect(classifyProductMaintenanceError('setPrice', fixture.errors.auth).status).toBe('rejected');
  });
});

describe('coordinator-required one-shot adapter', () => {
  it('waits for coordinator persistence before exactly one native call', async () => {
    const events: string[] = [];
    let receipt: ProductMaintenanceResult | undefined;
    const transport = client();
    transport.call.mockImplementation((method) => {
      events.push('call');
      return Promise.resolve({ method, data: response('accepted') });
    });
    const durable: ProductMaintenanceCoordinator = {
      run: async (intent, send) => {
        events.push('persist-and-claim');
        receipt = await coordinator().run(intent, send);
        events.push('persist-result');
        return receipt;
      }
    };
    const intent = await createProductMaintenanceIntent(draft('tiered'));
    const outcome = await new ProductMaintenanceAdapter(transport, durable).execute(intent);
    expect(events).toEqual(['persist-and-claim', 'call', 'persist-result']);
    expect(transport.call).toHaveBeenCalledExactlyOnceWith(intent.method, intent.parameters);
    expect(outcome).toBe(receipt);
    expect(outcome.status).toBe('accepted');
    expect(outcome).not.toHaveProperty('completed');
  });
  it('never retries unknown network outcomes', async () => {
    const transport = client();
    transport.call.mockRejectedValue(fixture.errors.network);
    const outcome = await new ProductMaintenanceAdapter(transport, coordinator()).execute(
      await createProductMaintenanceIntent(draft('inventory'))
    );
    expect(outcome.status).toBe('ambiguous');
    expect(transport.call).toHaveBeenCalledTimes(1);
  });
  it('refuses edited fingerprints, methods and parameters before dispatch', async () => {
    const transport = client();
    const intent = await createProductMaintenanceIntent(draft('tiered'));
    const changed = await createProductMaintenanceIntent(draft('inventory'));
    const adapter = new ProductMaintenanceAdapter(transport, coordinator());
    await expect(adapter.execute({ ...intent, fingerprint: changed.fingerprint })).rejects.toThrow(
      'INTENT_MISMATCH'
    );
    await expect(adapter.execute({ ...intent, method: changed.method })).rejects.toThrow('INTENT_MISMATCH');
    await expect(adapter.execute({ ...intent, parameters: changed.parameters })).rejects.toThrow(
      'INTENT_MISMATCH'
    );
    expect(transport.call).not.toHaveBeenCalled();
  });
  it('does not dispatch when coordinator fails to persist', async () => {
    const transport = client();
    const durable: ProductMaintenanceCoordinator = {
      run: () => Promise.reject(new Error('persistence-failed'))
    };
    await expect(
      new ProductMaintenanceAdapter(transport, durable).execute(
        await createProductMaintenanceIntent(draft('inventory'))
      )
    ).rejects.toThrow('persistence-failed');
    expect(transport.call).not.toHaveBeenCalled();
  });
  it('requires coordinator even for a valid native intent', async () => {
    const transport = client();
    await expect(
      new ProductMaintenanceAdapter(transport, undefined as unknown as ProductMaintenanceCoordinator).execute(
        await createProductMaintenanceIntent(draft('inventory'))
      )
    ).rejects.toThrow('COORDINATOR_REQUIRED');
    expect(transport.call).not.toHaveBeenCalled();
  });
  it('prevents the same send callback from being used twice', async () => {
    const transport = client();
    const durable: ProductMaintenanceCoordinator = {
      run: async (intent, send) => {
        const first = await coordinator().run(intent, send);
        await expect(coordinator().run(intent, send)).rejects.toThrow('ALREADY_DISPATCHED');
        return first;
      }
    };
    await new ProductMaintenanceAdapter(transport, durable).execute(
      await createProductMaintenanceIntent(draft('deleteOne'))
    );
    expect(transport.call).toHaveBeenCalledTimes(1);
  });
  it.each(['currencyMismatch', 'missingCurrency', 'wrongProduct', 'missingSku', 'duplicateSku'])(
    'blocks SKU price dispatch without matching explicit existing currency: %s',
    async (name) => {
      const transport = client();
      await expect(
        new ProductMaintenanceAdapter(transport, coordinator(snapshot(name))).execute(
          await createProductMaintenanceIntent(draft('skuPrice'))
        )
      ).rejects.toThrow('SKU_CURRENCY_UNCONFIRMED');
      expect(transport.call).not.toHaveBeenCalled();
    }
  );
  it('allows explicit matching SKU currency without adding currency to sku_price wire keys', async () => {
    const transport = client();
    const intent = await createProductMaintenanceIntent(draft('skuPrice'));
    await new ProductMaintenanceAdapter(transport, coordinator(snapshot())).execute(intent);
    expect(transport.call).toHaveBeenCalledExactlyOnceWith(intent.method, fixture.requests.skuPrice);
  });
  it('rejects an unbound permit and a coordinator-fabricated result', async () => {
    const transport = client();
    const intent = await createProductMaintenanceIntent(draft('inventory'));
    const wrong = await createProductMaintenanceIntent(draft('tiered'));
    const durable: ProductMaintenanceCoordinator = {
      run: (current, send) =>
        send({
          protocol: 'iop',
          persistedIntentId: fixture.persistedIntentId,
          fingerprint: wrong.fingerprint
        })
    };
    await expect(new ProductMaintenanceAdapter(transport, durable).execute(intent)).rejects.toThrow(
      'PERMIT_INVALID'
    );
    expect(transport.call).not.toHaveBeenCalled();
    const manufactured: ProductMaintenanceCoordinator = {
      run: (current) =>
        Promise.resolve(classifyProductMaintenanceResponse(current.draft, response('accepted')))
    };
    await expect(new ProductMaintenanceAdapter(transport, manufactured).execute(intent)).rejects.toThrow(
      'COORDINATOR_INVALID'
    );
  });
  it('does not expose a generic call route', () => {
    expect(ProductMaintenanceAdapter.prototype).not.toHaveProperty('call');
  });
});
