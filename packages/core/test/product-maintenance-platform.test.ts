import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProductMaintenancePlatform } from '../src/product-maintenance-platform';
import { ProductMaintenanceAdapter, createProductMaintenanceIntent } from '../src/product-maintenance-api';
import type { AlibabaCallResult } from '../src/alibaba-client';
import type { KnownProductDraft, ProductMaintenanceCoordinator } from '../src/product-maintenance-api';
import { ProductMaintenanceService, parseProductMaintenanceRecord } from '../src/product-maintenance-service';
import type { ProductMaintenanceRepository } from '../src/product-maintenance-service';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import bridge from '../../../mock/data/product-maintenance-bridge.json';
import domain from '../../../mock/data/product-maintenance-api.json';
import records from '../../../mock/data/product-maintenance-repository.json';

const reference = JSON.parse(
  await readFile(new URL('../../../mock/data/product-reference/examples.json', import.meta.url), 'utf8')
) as Record<string, { response: unknown }>;
const knownDrafts: KnownProductDraft[] = domain.drafts.deleteBatch.knownDrafts.map((row) => ({
  kind: 'draft',
  draftId: row.draftId,
  source: row.source === 'draft-list' ? 'draft-list' : 'draft-create'
}));
function platform(name: keyof typeof bridge.responses = 'accepted') {
  const call = vi.fn((method: string): Promise<AlibabaCallResult> =>
    Promise.resolve({ method, data: bridge.responses[name] })
  );
  const runtime = createProductMaintenancePlatform({
    context: records.context,
    client: { call },
    enabled: true,
    validateRequest: validateCapabilityRequest,
    validateResponse: validateCapabilityResponse,
    knownDrafts
  });
  const coordinator: ProductMaintenanceCoordinator = {
    run: (intent, send) =>
      send({
        protocol: 'iop',
        persistedIntentId: records.taskId,
        fingerprint: intent.fingerprint,
        reference: domain.snapshots.matching
      })
  };
  return { call, runtime, adapter: new ProductMaintenanceAdapter(runtime.client, coordinator) };
}
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('UNEXPECTED_NETWORK');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('maintenance platform native write contracts', () => {
  it.each(['tiered', 'range', 'skuPrice', 'inventory', 'skuInventory'] as const)(
    'validates and preserves explicit acceptance for %s',
    async (name) => {
      const h = platform();
      const result = await h.adapter.execute(await createProductMaintenanceIntent(domain.drafts[name]));
      expect(result.status).toBe('accepted');
      expect(result.readbackRequired).toBe(true);
      expect(h.call).toHaveBeenCalledTimes(1);
    }
  );
  it('keeps explicit native business rejection, not an apparent success root', async () => {
    const h = platform('rejected');
    const result = await h.adapter.execute(await createProductMaintenanceIntent(domain.drafts.inventory));
    expect(result.status).toBe('rejected');
    expect(h.call).toHaveBeenCalledTimes(1);
  });
  it.each(['invalidMessage', 'invalidSuccess', 'missingRoot', 'errorRoot', 'badEnvelope'] as const)(
    'records malformed/error response %s as ambiguous without retry or raw data',
    async (name) => {
      const h = platform(name);
      const result = await h.adapter.execute(await createProductMaintenanceIntent(domain.drafts.inventory));
      expect(result.status).toBe('ambiguous');
      expect(h.call).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(bridge.marker);
      expect(result).not.toHaveProperty('data');
    }
  );
  it('demonstrates the actual response-contract violation is no longer accepted', async () => {
    expect(
      await validateCapabilityResponse('/icbu/product/edit-inventory', bridge.responses.invalidMessage)
    ).not.toHaveLength(0);
    const h = platform('invalidMessage');
    const result = await h.adapter.execute(await createProductMaintenanceIntent(domain.drafts.inventory));
    expect(result.status).toBe('ambiguous');
  });
  it('keeps correlated evidence without rewriting a native failure into all-success', async () => {
    const single = platform('deleteAccepted');
    expect(
      (await single.adapter.execute(await createProductMaintenanceIntent(domain.drafts.deleteOne))).items
    ).toEqual([{ draftId: domain.drafts.deleteOne.draftIds[0], status: 'reported-deleted' }]);
    const contradictory = platform('deletePartial');
    const result = await contradictory.adapter.execute(
      await createProductMaintenanceIntent(domain.drafts.deleteOne)
    );
    expect(result.status).toBe('ambiguous');
    expect(result.items?.map((item) => item.status)).toEqual(['reported-deleted']);
  });
  it('retains the current native contract single-draft request limit before dispatch', async () => {
    const batch = platform('deletePartial');
    const result = await batch.adapter.execute(
      await createProductMaintenanceIntent(domain.drafts.deleteBatch)
    );
    expect(result.status).toBe('rejected');
    expect(batch.call).not.toHaveBeenCalled();
  });
  it('does not pass arbitrary methods or invalid request fields through to the client', async () => {
    const h = platform();
    await expect(h.runtime.client.call(bridge.unsupportedMethod, bridge.invalidParameters)).rejects.toThrow(
      'CAPABILITY_RESTRICTED'
    );
    await expect(
      h.runtime.client.call('/icbu/product/edit-inventory', bridge.invalidParameters)
    ).rejects.toThrow('REQUEST_CONTRACT_INVALID');
    expect(h.call).not.toHaveBeenCalled();
  });
  it('treats a response bound to another method as ambiguous', async () => {
    const h = platform();
    h.call.mockImplementation(() =>
      Promise.resolve({ method: bridge.wrongMethod, data: bridge.responses.accepted })
    );
    expect(
      (await h.adapter.execute(await createProductMaintenanceIntent(domain.drafts.inventory))).status
    ).toBe('ambiguous');
    expect(h.call).toHaveBeenCalledTimes(1);
  });
  it('retains get/v2 response validation and checks response method identity', async () => {
    const h = platform();
    h.call.mockImplementation((method) =>
      Promise.resolve({ method, data: reference['/alibaba/icbu/product/get/v2']?.response })
    );
    const readProduct = h.runtime.readProduct;
    if (!readProduct) throw new Error('Missing reference reader');
    expect((await readProduct(domain.drafts.inventory.productId)).productId).toBe(
      domain.drafts.inventory.productId
    );
    h.call.mockImplementation(() =>
      Promise.resolve({
        method: bridge.unsupportedMethod,
        data: reference['/alibaba/icbu/product/get/v2']?.response
      })
    );
    await expect(readProduct(domain.drafts.inventory.productId)).rejects.toThrow('RESPONSE_CONTRACT_INVALID');
  });
  it('rejects malformed get/v2 data rather than manufacturing a usable snapshot', async () => {
    const h = platform('invalidMessage');
    const readProduct = h.runtime.readProduct;
    if (!readProduct) throw new Error('Missing reader');
    await expect(readProduct(domain.drafts.inventory.productId)).rejects.toThrow('RESPONSE_CONTRACT_INVALID');
  });
});

describe('deletion requires an explicit reliable-reader capability before claim', () => {
  it('refuses a delete with no readDrafts without saving or calling the platform', async () => {
    const h = platform('deleteAccepted');
    const stored = parseProductMaintenanceRecord(records.records.deleteOne);
    const save = vi.fn<ProductMaintenanceRepository['save']>(() => Promise.resolve());
    const repository: ProductMaintenanceRepository = {
      get: () => Promise.resolve(structuredClone(stored)),
      list: () => Promise.resolve([structuredClone(stored)]),
      save
    };
    const service = new ProductMaintenanceService(
      repository,
      () => Promise.resolve(h.runtime),
      () => records.now
    );
    await expect(
      service.execute(stored.ownerId, {
        requestId: bridge.requestId,
        context: stored.task.context,
        command: {
          action: 'send',
          taskId: stored.task.id,
          revision: stored.task.revision,
          fingerprint: stored.task.intent.fingerprint
        }
      })
    ).rejects.toThrow('PRODUCT_MAINTENANCE_DRAFT_VERIFICATION_UNAVAILABLE');
    expect(save).not.toHaveBeenCalled();
    expect(h.call).not.toHaveBeenCalled();
    expect(stored.task.status).toBe('prepared');
    expect(stored.task.submitAttempted).toBe(false);
  });
});
