import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { openD1Database } from '../src/db/d1-database';
import { SqlProductMutationJobRepository } from '../src/product-mutations/repository';

it('migrates nullable ownership and atomically blocks duplicate product updates in D1', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const repository = new SqlProductMutationJobRepository(openD1Database(env.DB).executor);
  const input = {
    requestId: crypto.randomUUID(),
    productId: '301',
    categoryId: 123,
    language: 'en_US' as const,
    payloadFingerprint: 'c'.repeat(64),
    fieldExpectations: [{ fieldId: 'keywords', fingerprint: 'd'.repeat(64) }],
    actorId: 'batch-test-admin',
    batchId: crypto.randomUUID(),
    productContext: { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) }
  };
  const results = await Promise.allSettled([
    repository.create(input),
    repository.create({ ...input, requestId: crypto.randomUUID() })
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const saved = await repository.findBlocking('301');
  expect(saved).toMatchObject({
    batchId: input.batchId,
    productContext: input.productContext,
    status: 'submitted'
  });
  const { batchId: _batchId, productContext: _productContext, ...oldInput } = input;
  const legacy = await repository.create({ ...oldInput, productId: '302' });
  expect(legacy.productContext).toBeNull();
  expect(legacy.batchId).toBeNull();
});
