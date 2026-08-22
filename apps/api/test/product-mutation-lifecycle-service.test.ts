import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayException } from '@one-vegetable/core';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';
import {
  ProductMutationAlreadyInProgressError,
  ProductMutationLifecycleService
} from '../src/product-mutations/service';

import type { NodeDatabaseHandle } from '../src/db/node-database';
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
    const { service, gateway } = createService();
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
});

function createService(): {
  service: ProductMutationLifecycleService;
  gateway: {
    update: ReturnType<typeof vi.fn<ProductMutationGateway['update']>>;
    render: ReturnType<typeof vi.fn<ProductMutationGateway['render']>>;
  };
} {
  handle = openNodeDatabase(':memory:');
  applyNodeMigrations(handle);
  const repository = new SqlProductMutationJobRepository(handle.executor);
  const gateway = {
    update: vi.fn<ProductMutationGateway['update']>().mockResolvedValue({
      productId: REQUEST.productId,
      traceId: 'trace-1',
      success: true
    }),
    render: vi.fn<ProductMutationGateway['render']>()
  };
  return { service: new ProductMutationLifecycleService(repository, gateway), gateway };
}
