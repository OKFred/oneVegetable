import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayException } from '@one-vegetable/core';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';
import {
  ProductDisplayNoChangeError,
  ProductMutationAlreadyInProgressError,
  ProductMutationLifecycleService
} from '../src/product-mutations/service';

import type { NodeDatabaseHandle } from '../src/db/node-database';
import type { AuthService } from '../src/auth/service';
import type { ProductPage } from '@one-vegetable/core';
import type { ProductMutationGateway } from '../src/product-mutations/service';

const ACTOR = { actorId: 'admin-1', username: 'admin', role: 'admin', source: 'bff' } as const;
const PATCH = `<itemSchema><field id="subject" type="input"><values><value>Updated title</value></values></field></itemSchema>`;
const REQUEST = {
  productId: '1601928079741',
  categoryId: 201712702,
  language: 'en_US',
  schemaPatchXml: PATCH
} as const;

let handle: NodeDatabaseHandle | undefined;

afterEach(() => {
  handle?.connection.close();
  handle = undefined;
});

describe('product mutation lifecycle service', () => {
  it('returns auditing instead of synchronous success and blocks duplicate writes', async () => {
    const { service, gateway } = createService();
    const submitted = await service.submitUpdate({
      requestId: '8dfb995a-d2fc-4582-a108-d63848d03449',
      actor: ACTOR,
      request: REQUEST
    });
    expect(submitted.job).toMatchObject({ status: 'auditing', productId: REQUEST.productId });
    expect(gateway.update).toHaveBeenCalledOnce();
    await expect(
      service.submitUpdate({
        requestId: '3ca26d74-99ab-4a29-a87a-0edb8f1704c4',
        actor: ACTOR,
        request: REQUEST
      })
    ).rejects.toBeInstanceOf(ProductMutationAlreadyInProgressError);
    expect(gateway.update).toHaveBeenCalledOnce();
  });

  it('keeps an accepted update auditing while Alibaba review blocks render', async () => {
    const { service, gateway, audit } = createService();
    const submitted = await service.submitUpdate({
      requestId: '358f0f24-aab5-4822-91df-a20602bcf5e5',
      actor: ACTOR,
      request: REQUEST
    });
    gateway.render.mockRejectedValueOnce(
      new GatewayException({
        code: 'PUB_BIZCHECK_PRODUCT_IN_AUDITING',
        message: 'Your product is currently under review.',
        retryable: false
      })
    );
    const refreshed = await service.refresh({
      requestId: 'ee17b803-7bb2-494d-963d-0c87c3050acf',
      actor: ACTOR,
      id: submitted.job.id,
      expectedRevision: submitted.job.revision
    });
    expect(refreshed).toMatchObject({
      status: 'auditing',
      reasonCode: 'PUB_BIZCHECK_PRODUCT_IN_AUDITING'
    });
    expect(refreshed.lastCheckedTimeUtc).not.toBeNull();
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'ee17b803-7bb2-494d-963d-0c87c3050acf' })
    );
  });

  it('verifies matching readback and marks mismatches as recovery required', async () => {
    const first = createService();
    const submitted = await first.service.submitUpdate({
      requestId: '2344dc9d-d026-47d1-9fd3-c9c05a8ae30e',
      actor: ACTOR,
      request: REQUEST
    });
    first.gateway.render.mockResolvedValueOnce({
      xml: PATCH,
      categoryId: REQUEST.categoryId,
      language: REQUEST.language,
      market: 'wholesale'
    });
    await expect(
      first.service.refresh({
        requestId: 'd02fdc47-31c1-40b0-bb96-783b06915038',
        actor: ACTOR,
        id: submitted.job.id,
        expectedRevision: submitted.job.revision
      })
    ).resolves.toMatchObject({ status: 'verified' });

    handle?.connection.close();
    handle = undefined;
    const second = createService();
    const secondSubmitted = await second.service.submitUpdate({
      requestId: 'f69ccf89-fbe2-45fb-b5e5-a5fed6d2b5ec',
      actor: ACTOR,
      request: { ...REQUEST, productId: '1601928079742' }
    });
    second.gateway.render.mockResolvedValueOnce({
      xml: PATCH.replace('Updated title', 'Original title'),
      categoryId: REQUEST.categoryId,
      language: REQUEST.language,
      market: 'wholesale'
    });
    await expect(
      second.service.refresh({
        requestId: '93353c8f-e259-4dd6-aa62-a720beb55029',
        actor: ACTOR,
        id: secondSubmitted.job.id,
        expectedRevision: secondSubmitted.job.revision
      })
    ).resolves.toMatchObject({ status: 'recovery-required' });
  });

  it('persists display mutations and verifies the target state through the product list', async () => {
    const { service, gateway } = createService();
    gateway.list.mockResolvedValue(productPage('online'));
    gateway.updateDisplay.mockResolvedValue({
      encryptedProductIds: ['encrypted-1'],
      display: 'offline',
      traceId: 'display-trace',
      success: true
    });
    const submitted = await service.submitDisplay({
      requestId: '27c927aa-629d-4fc5-a05f-a02ac6902c6f',
      actor: ACTOR,
      request: {
        productIds: [REQUEST.productId],
        encryptedProductIds: ['encrypted-1'],
        display: 'offline'
      }
    });
    expect(submitted.jobs).toHaveLength(1);
    expect(submitted.jobs[0]).toMatchObject({
      operation: 'updateProductDisplay',
      status: 'verifying',
      productId: REQUEST.productId,
      encryptedProductId: 'encrypted-1',
      originalDisplay: 'online',
      targetDisplay: 'offline'
    });

    gateway.list.mockResolvedValue(productPage('offline'));
    const job = submitted.jobs[0];
    if (!job) throw new Error('Missing display job');
    await expect(
      service.refresh({
        requestId: 'f92981bb-1697-4b2f-b7c2-4f5731b55a44',
        actor: ACTOR,
        id: job.id,
        expectedRevision: job.revision
      })
    ).resolves.toMatchObject({ status: 'verified' });
  });

  it('requires explicit recovery after a display readback timeout and verifies the original state', async () => {
    let now = 10_000;
    const { service, gateway } = createService(() => now);
    gateway.list.mockResolvedValue(productPage('online'));
    gateway.updateDisplay.mockResolvedValue({
      encryptedProductIds: ['encrypted-1'],
      display: 'offline',
      traceId: 'display-trace',
      success: true
    });
    const submitted = await service.submitDisplay({
      requestId: 'ed7e103d-f6aa-4ba3-bdc1-b789e08b8740',
      actor: ACTOR,
      request: {
        productIds: [REQUEST.productId],
        encryptedProductIds: ['encrypted-1'],
        display: 'offline'
      }
    });
    const job = submitted.jobs[0];
    if (!job) throw new Error('Missing display job');
    now += 120_001;
    const uncertain = await service.refresh({
      requestId: 'f8ea49c5-01f8-4b43-9576-4e7f32096464',
      actor: ACTOR,
      id: job.id,
      expectedRevision: job.revision
    });
    expect(uncertain).toMatchObject({ status: 'recovery-required' });

    gateway.updateDisplay.mockResolvedValueOnce({
      encryptedProductIds: ['encrypted-1'],
      display: 'online',
      traceId: 'recovery-trace',
      success: true
    });
    const recovering = await service.recover({
      requestId: '4383dbbc-357e-4585-a218-6c79583f5509',
      actor: ACTOR,
      id: uncertain.id,
      expectedRevision: uncertain.revision
    });
    expect(recovering).toMatchObject({ status: 'recovering', traceId: 'recovery-trace' });
    await expect(
      service.refresh({
        requestId: '42d0480f-0fe9-4a1a-a465-70a13841fbe2',
        actor: ACTOR,
        id: recovering.id,
        expectedRevision: recovering.revision
      })
    ).resolves.toMatchObject({ status: 'recovered' });
  });

  it('rejects a no-op display mutation before calling the write gateway', async () => {
    const { service, gateway } = createService();
    gateway.list.mockResolvedValue(productPage('online'));
    await expect(
      service.submitDisplay({
        requestId: 'a94bb51d-bc28-4d30-ae43-a38d17271a13',
        actor: ACTOR,
        request: {
          productIds: [REQUEST.productId],
          encryptedProductIds: ['encrypted-1'],
          display: 'online'
        }
      })
    ).rejects.toBeInstanceOf(ProductDisplayNoChangeError);
    expect(gateway.updateDisplay).not.toHaveBeenCalled();
  });

  it('can restore the original display state before verification finishes', async () => {
    const { service, gateway } = createService();
    gateway.list.mockResolvedValue(productPage('online'));
    gateway.updateDisplay.mockResolvedValue({
      encryptedProductIds: ['encrypted-1'],
      display: 'offline',
      traceId: 'display-trace',
      success: true
    });
    const submitted = await service.submitDisplay({
      requestId: '3100aa3b-b47e-46a2-b556-c363f832ec09',
      actor: ACTOR,
      request: {
        productIds: [REQUEST.productId],
        encryptedProductIds: ['encrypted-1'],
        display: 'offline'
      }
    });
    const job = submitted.jobs[0];
    if (!job) throw new Error('Missing display job');
    gateway.updateDisplay.mockResolvedValueOnce({
      encryptedProductIds: ['encrypted-1'],
      display: 'online',
      traceId: 'early-recovery-trace',
      success: true
    });
    await expect(
      service.recover({
        requestId: '08005235-3034-4bf9-a87e-7699c511125d',
        actor: ACTOR,
        id: job.id,
        expectedRevision: job.revision
      })
    ).resolves.toMatchObject({ status: 'recovering', originalDisplay: 'online' });
  });
});

function createService(clock: () => number = Date.now): {
  service: ProductMutationLifecycleService;
  gateway: {
    update: ReturnType<typeof vi.fn<ProductMutationGateway['update']>>;
    render: ReturnType<typeof vi.fn<ProductMutationGateway['render']>>;
    updateDisplay: ReturnType<typeof vi.fn<ProductMutationGateway['updateDisplay']>>;
    list: ReturnType<typeof vi.fn<ProductMutationGateway['list']>>;
  };
  audit: ReturnType<typeof vi.fn<AuthService['audit']>>;
} {
  handle = openNodeDatabase(':memory:');
  applyNodeMigrations(handle);
  const repository = new SqlProductMutationJobRepository(handle.executor, clock);
  const gateway = {
    update: vi.fn<ProductMutationGateway['update']>().mockResolvedValue({
      productId: REQUEST.productId,
      traceId: 'trace-1',
      success: true
    }),
    render: vi.fn<ProductMutationGateway['render']>(),
    updateDisplay: vi.fn<ProductMutationGateway['updateDisplay']>(),
    list: vi.fn<ProductMutationGateway['list']>()
  };
  const audit = vi.fn<AuthService['audit']>().mockResolvedValue(undefined);
  const authService = { audit } as unknown as AuthService;
  return {
    service: new ProductMutationLifecycleService(repository, gateway, authService, clock),
    gateway,
    audit
  };
}

function productPage(status: 'online' | 'offline'): ProductPage {
  return {
    items: [
      {
        id: REQUEST.productId,
        encryptedId: 'encrypted-1',
        subject: 'Smoke product',
        groupName: 'Smoke',
        status,
        score: 0,
        updatedAt: '2026-08-22T00:00:00.000Z',
        categoryId: REQUEST.categoryId
      }
    ],
    page: 1,
    pageSize: 100,
    total: 1
  };
}
