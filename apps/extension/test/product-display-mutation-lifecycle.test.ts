import { describe, expect, it } from 'vitest';

import {
  GatewayException,
  type ProductDisplayMutationResult,
  type ProductDisplayRequest,
  type ProductListQuery,
  type ProductPage
} from '@one-vegetable/core';
import {
  ExtensionProductDisplayMutationLifecycle,
  type ExtensionProductDisplayGateway,
  type ExtensionProductMutationStorage
} from '../lib/product-display-mutation-lifecycle';
import { EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY } from '../lib/product-display-mutation-storage';

describe('extension product display mutation lifecycle', () => {
  it('persists a submitted mutation before calling Alibaba and verifies it after a worker restart', async () => {
    const storage = new MemoryStorage();
    const gateway = new FakeGateway('online');
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 1_000);

    const submitted = await lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'));

    expect(gateway.updates).toEqual(['offline']);
    expect(submitted.jobs).toHaveLength(1);
    expect(submitted.jobs[0]).toMatchObject({
      productId: '1600000000001',
      status: 'verifying',
      originalDisplay: 'online',
      targetDisplay: 'offline'
    });

    const restarted = new ExtensionProductDisplayMutationLifecycle(storage, () => 1_001);
    const page = await restarted.list();
    expect(page.items).toHaveLength(1);
    await expect(
      restarted.submit(gateway, crypto.randomUUID(), displayRequest('offline'))
    ).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
    });

    gateway.status = 'offline';
    const current = page.items[0];
    if (!current) throw new Error('missing persisted mutation job');
    const verified = await restarted.refresh(gateway, current.id, current.revision);
    expect(verified).toMatchObject({
      status: 'verified',
      reasonCode: 'PRODUCT_DISPLAY_READBACK_MATCHED'
    });
  });

  it('moves a timed-out task to recovery-required and restores the original state', async () => {
    let now = 5_000;
    const storage = new MemoryStorage();
    const gateway = new FakeGateway('online');
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => now);
    const submitted = await lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'));
    const initial = submitted.jobs[0];
    if (!initial) throw new Error('missing submitted mutation job');

    now += 2 * 60 * 1000 + 1;
    const recoveryRequired = await lifecycle.refresh(gateway, initial.id, initial.revision);
    expect(recoveryRequired.status).toBe('recovery-required');

    const recovering = await lifecycle.recover(gateway, recoveryRequired.id, recoveryRequired.revision);
    expect(gateway.updates).toEqual(['offline', 'online']);
    expect(recovering.status).toBe('recovering');

    const recovered = await lifecycle.refresh(gateway, recovering.id, recovering.revision);
    expect(recovered).toMatchObject({
      status: 'recovered',
      reasonCode: 'PRODUCT_DISPLAY_RECOVERY_MATCHED'
    });
  });

  it('blocks retries after an uncertain network result and closes the task after original-state readback', async () => {
    const storage = new MemoryStorage();
    const gateway = new FakeGateway('online');
    gateway.updateError = new GatewayException({
      code: 'NETWORK_TIMEOUT',
      message: '请求超时',
      retryable: true
    });
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 8_000);

    await expect(
      lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'))
    ).rejects.toMatchObject({
      gatewayError: { code: 'NETWORK_TIMEOUT' }
    });
    const pending = (await lifecycle.list()).items[0];
    if (!pending) throw new Error('missing uncertain mutation job');
    expect(pending).toMatchObject({
      status: 'recovery-required',
      reasonCode: 'NETWORK_TIMEOUT'
    });
    await expect(
      lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'))
    ).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
    });

    gateway.updateError = null;
    const recovered = await lifecycle.refresh(gateway, pending.id, pending.revision);
    expect(recovered).toMatchObject({
      status: 'recovered',
      reasonCode: 'PRODUCT_DISPLAY_ORIGINAL_STATE_CONFIRMED'
    });
  });

  it('fails closed when persisted jobs are corrupt', async () => {
    const storage = new MemoryStorage({
      [EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY]: { schemaVersion: 1, jobs: [{ id: 'broken' }] }
    });
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage);

    await expect(lifecycle.list()).rejects.toMatchObject({
      gatewayError: { code: 'EXTENSION_PRODUCT_MUTATION_STORAGE_INVALID' }
    });
  });

  it('keeps an accepted request blocked when the verifying-state write fails', async () => {
    const storage = new MemoryStorage({}, 2);
    const gateway = new FakeGateway('online');
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 10_000);

    await expect(lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'))).rejects.toThrow(
      'simulated storage failure'
    );
    expect(gateway.updates).toEqual(['offline']);

    const page = await lifecycle.list();
    expect(page.items[0]?.status).toBe('submitted');
    await expect(
      lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'))
    ).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' }
    });
  });

  it('rejects products already under platform audit before sending a mutation', async () => {
    const gateway = new FakeGateway('auditing');
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(new MemoryStorage());

    await expect(
      lifecycle.submit(gateway, crypto.randomUUID(), displayRequest('offline'))
    ).rejects.toMatchObject({
      gatewayError: { code: 'PRODUCT_DISPLAY_PLATFORM_AUDITING' }
    });
    expect(gateway.updates).toEqual([]);
  });
});

class MemoryStorage implements ExtensionProductMutationStorage {
  readonly values: Record<string, unknown>;
  #setCalls = 0;

  constructor(
    initial: Record<string, unknown> = {},
    private readonly failOnSetCall: number | null = null
  ) {
    this.values = structuredClone(initial);
  }

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(key in this.values ? { [key]: structuredClone(this.values[key]) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    this.#setCalls += 1;
    if (this.#setCalls === this.failOnSetCall) {
      return Promise.reject(new Error('simulated storage failure'));
    }
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

class FakeGateway implements ExtensionProductDisplayGateway {
  readonly updates: ('online' | 'offline')[] = [];
  updateError: GatewayException | null = null;

  constructor(public status: 'online' | 'offline' | 'auditing') {}

  list(request: ProductListQuery): Promise<ProductPage> {
    return Promise.resolve({
      items: [
        {
          id: '1600000000001',
          encryptedId: 'encrypted-product-id',
          subject: 'Smoke product',
          groupName: 'Default',
          status: this.status,
          score: 0,
          imageUrl: null,
          updatedAt: '2026-09-01T00:00:00.000Z',
          categoryId: 100
        }
      ],
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 100,
      total: 1
    });
  }

  updateDisplay(request: ProductDisplayRequest): Promise<ProductDisplayMutationResult> {
    this.updates.push(request.display);
    if (this.updateError) return Promise.reject(this.updateError);
    return Promise.resolve({
      encryptedProductIds: [...request.encryptedProductIds],
      display: request.display,
      traceId: crypto.randomUUID(),
      success: true
    });
  }
}

function displayRequest(display: 'online' | 'offline'): ProductDisplayRequest {
  return {
    productIds: ['1600000000001'],
    encryptedProductIds: ['encrypted-product-id'],
    display
  };
}
