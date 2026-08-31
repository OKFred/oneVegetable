import { describe, expect, it } from 'vitest';

import {
  GatewayException,
  type ProductDetail,
  type ProductDisplayMutationResult,
  type ProductDisplayRequest,
  type ProductListQuery,
  type ProductMutationResult,
  type ProductPage,
  type RequestOf
} from '@one-vegetable/core';
import {
  ExtensionProductDisplayMutationLifecycle,
  type ExtensionProductCreationGateway,
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

  it('persists and verifies a platform draft before returning success', async () => {
    const storage = new MemoryStorage();
    const gateway = new FakeCreationGateway();
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 20_000);

    const result = await lifecycle.submitCreation(
      gateway,
      crypto.randomUUID(),
      'saveProductDraft',
      creationRequest()
    );

    expect(gateway.draftCalls).toHaveLength(1);
    expect(result).toMatchObject({
      productId: gateway.productId,
      success: true,
      job: {
        operation: 'saveProductDraft',
        productId: gateway.productId,
        status: 'verified',
        reasonCode: 'PRODUCT_DRAFT_READBACK_MATCHED'
      }
    });
    const restarted = new ExtensionProductDisplayMutationLifecycle(storage, () => 20_001);
    expect((await restarted.list()).items).toHaveLength(1);
    await expect(
      restarted.submitCreation(gateway, crypto.randomUUID(), 'saveProductDraft', creationRequest())
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_CREATION_ALREADY_ACCEPTED' } });
    expect(gateway.draftCalls).toHaveLength(1);
  });

  it('resumes published-product readback after a worker restart', async () => {
    const storage = new MemoryStorage();
    const gateway = new FakeCreationGateway();
    gateway.publishVisible = false;
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 30_000);

    const result = await lifecycle.submitCreation(
      gateway,
      crypto.randomUUID(),
      'publishProduct',
      creationRequest()
    );
    expect(result.job.status).toBe('verifying');

    gateway.publishVisible = true;
    const restarted = new ExtensionProductDisplayMutationLifecycle(storage, () => 30_001);
    const persisted = (await restarted.list()).items[0];
    if (!persisted) throw new Error('missing persisted creation job');
    const verified = await restarted.refresh(gateway, persisted.id, persisted.revision);
    expect(verified).toMatchObject({
      operation: 'publishProduct',
      productId: gateway.productId,
      status: 'verified',
      reasonCode: 'PRODUCT_PUBLISH_READBACK_MATCHED'
    });
  });

  it('fails closed and blocks duplicate creation after an uncertain network result', async () => {
    const storage = new MemoryStorage();
    const gateway = new FakeCreationGateway();
    gateway.mutationError = new GatewayException({
      code: 'NETWORK_TIMEOUT',
      message: '请求超时',
      retryable: true
    });
    const lifecycle = new ExtensionProductDisplayMutationLifecycle(storage, () => 40_000);

    await expect(
      lifecycle.submitCreation(gateway, crypto.randomUUID(), 'publishProduct', creationRequest())
    ).rejects.toMatchObject({ gatewayError: { code: 'NETWORK_TIMEOUT' } });
    expect((await lifecycle.list()).items[0]).toMatchObject({
      operation: 'publishProduct',
      status: 'recovery-required',
      reasonCode: 'NETWORK_TIMEOUT'
    });
    await expect(
      lifecycle.submitCreation(gateway, crypto.randomUUID(), 'publishProduct', creationRequest())
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_MUTATION_ALREADY_IN_PROGRESS' } });
    expect(gateway.publishCalls).toHaveLength(1);
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

class FakeCreationGateway implements ExtensionProductCreationGateway {
  readonly productId = '1600000000002';
  readonly draftCalls: RequestOf<'saveProductDraft'>[] = [];
  readonly publishCalls: RequestOf<'publishProduct'>[] = [];
  publishVisible = true;
  draftVisible = true;
  mutationError: GatewayException | null = null;

  list(request: ProductListQuery): Promise<ProductPage> {
    const items = this.publishVisible
      ? [
          {
            id: this.productId,
            encryptedId: 'encrypted-created-product',
            subject: 'Created smoke product',
            groupName: 'Default',
            status: 'auditing' as const,
            score: 0,
            imageUrl: null,
            updatedAt: '2026-09-01T00:00:00.000Z',
            categoryId: 100
          }
        ]
      : [];
    return Promise.resolve({
      items,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 100,
      total: items.length
    });
  }

  get(productId: string, draft = false, language = 'en_US'): Promise<ProductDetail> {
    if (!this.draftVisible || !draft || productId !== this.productId) {
      return Promise.reject(
        new GatewayException({ code: 'DRAFT_PENDING', message: '草稿尚未可见', retryable: true })
      );
    }
    return Promise.resolve({
      id: productId,
      encryptedId: null,
      subject: 'Created draft',
      groupName: 'Schema 商品',
      status: 'draft',
      score: 0,
      imageUrl: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
      categoryId: 100,
      language,
      schemaXml: '<schema><field id="subject"><value>Created draft</value></field></schema>'
    });
  }

  mutate(
    _method: 'alibaba.icbu.product.schema.add',
    request: RequestOf<'publishProduct'>
  ): Promise<ProductMutationResult> {
    this.publishCalls.push(structuredClone(request));
    if (this.mutationError) return Promise.reject(this.mutationError);
    return Promise.resolve({ productId: this.productId, traceId: crypto.randomUUID(), success: true });
  }

  saveDraft(request: RequestOf<'saveProductDraft'>): Promise<ProductMutationResult> {
    this.draftCalls.push(structuredClone(request));
    if (this.mutationError) return Promise.reject(this.mutationError);
    return Promise.resolve({ productId: this.productId, traceId: crypto.randomUUID(), success: true });
  }
}

function displayRequest(display: 'online' | 'offline'): ProductDisplayRequest {
  return {
    productIds: ['1600000000001'],
    encryptedProductIds: ['encrypted-product-id'],
    display
  };
}

function creationRequest(): RequestOf<'publishProduct'> {
  return {
    categoryId: 100,
    language: 'en_US',
    schemaXml: '<schema><field id="subject"><value>Created smoke product</value></field></schema>'
  };
}
