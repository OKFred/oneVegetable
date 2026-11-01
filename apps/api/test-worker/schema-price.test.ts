import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-schema-price.json';
import integrity from '../../../mock/data/product-maintenance-integrity.json';
import { opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import { createProductMaintenanceGuardedBaseline } from '@one-vegetable/core/product-maintenance-service';
import {
  prepareProductSchemaPrice,
  type ProductSchemaPriceGuard
} from '@one-vegetable/core/product-schema-price';
import type { ProductReference } from '@one-vegetable/core/product-reference';
import { openD1Database } from '../src/db/d1-database';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';
import {
  ProductMutationLifecycleService,
  type ProductMutationGateway
} from '../src/product-mutations/service';

it('preflights and verifies guarded two-root prices without browser DOM globals in workerd', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const repository = new SqlProductMutationJobRepository(openD1Database(env.DB).executor);
  const actor = { actorId: 'schema-price-worker', username: 'admin', role: 'admin', source: 'bff' } as const;
  const options = {
    productContext: { identity: await opaqueGalleryId(actor.actorId), gateway: 'b'.repeat(64) }
  };
  let reference: ProductReference = structuredClone(integrity.snapshot);
  let xml = fixture.multiXml;
  const deny = () => Promise.reject(new Error('UNEXPECTED_MUTATION'));
  const update = vi.fn<ProductMutationGateway['update']>((request) => {
    xml = request.schemaPatchXml;
    reference = { ...reference, price: { ...reference.price, tiers: structuredClone(fixture.draft.tiers) } };
    return Promise.resolve({
      productId: request.productId,
      success: true,
      traceId: 'synthetic-worker-price'
    });
  });
  const gateway: ProductMutationGateway = {
    publish: deny,
    saveDraft: deny,
    get: deny,
    updateDisplay: deny,
    list: deny,
    render: () => Promise.resolve({ xml, categoryId: 12345, language: 'en_US', market: 'wholesale' }),
    readReference: () => Promise.resolve(structuredClone(reference)),
    update
  };
  const lifecycle = new ProductMutationLifecycleService(repository, gateway);
  const baseline = await createProductMaintenanceGuardedBaseline(fixture.draft, reference);
  const guard: ProductSchemaPriceGuard = {
    version: 1,
    draft: { ...structuredClone(fixture.draft), operation: 'setPrice', mode: 'tiered', currency: 'USD' },
    baseline,
    schemaFingerprint: 'a'.repeat(64)
  };
  await expect(
    lifecycle.submitUpdate({
      actor,
      options,
      requestId: crypto.randomUUID(),
      request: {
        productId: fixture.draft.productId,
        categoryId: 12345,
        language: 'en_US',
        schemaPatchXml: fixture.multiXml,
        priceGuard: guard
      }
    })
  ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_SCHEMA_PRICE_BASELINE_CHANGED' } });
  expect(update).not.toHaveBeenCalled();
  expect(await repository.findBlocking(fixture.draft.productId)).toBeNull();
  const prepared = await prepareProductSchemaPrice(xml, fixture.draft, reference);
  const { job } = await lifecycle.submitUpdate({
    actor,
    options,
    requestId: crypto.randomUUID(),
    request: {
      productId: fixture.draft.productId,
      categoryId: 12345,
      language: 'en_US',
      schemaPatchXml: prepared.patchXml,
      priceGuard: prepared.guard
    }
  });
  expect(job.protocol).toBe('iop');
  expect(job.fieldExpectations.map((field) => field.fieldId).sort()).toEqual(['ladderPrice', 'modelNumber']);
  expect(job.fieldExpectations.find((field) => field.fieldId === 'ladderPrice')?.priceGuard).toEqual(
    prepared.guard
  );
  expect(
    await lifecycle.refresh({
      actor,
      requestId: crypto.randomUUID(),
      id: job.id,
      expectedRevision: job.revision
    })
  ).toMatchObject({ status: 'verified' });
  expect(update).toHaveBeenCalledOnce();
});
