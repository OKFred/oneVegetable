import { afterEach, describe, expect, it } from 'vitest';

import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { EntityVersionConflictError } from '../src/db/repository';
import {
  ProductMutationJobConflictError,
  SqlProductMutationJobRepository
} from '../src/product-mutations/repository';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let handle: NodeDatabaseHandle | undefined;

afterEach(() => {
  handle?.connection.close();
  handle = undefined;
});

describe('product mutation job repository', () => {
  it('persists an audited lifecycle without storing the schema XML', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    let now = 1_723_456_789_012;
    const repository = new SqlProductMutationJobRepository(handle.executor, () => now);
    const fingerprint = 'a'.repeat(64);
    const created = await repository.create({
      requestId: 'db15c03b-ff7b-4aef-96ab-3a569a52e5ec',
      productId: '1601928079741',
      categoryId: 201712702,
      language: 'en_US',
      payloadFingerprint: fingerprint,
      fieldExpectations: [{ fieldId: 'subject', fingerprint }],
      actorId: 'user-1'
    });
    expect(created).toMatchObject({
      status: 'submitted',
      submittedTimeUtc: now,
      revision: 1,
      creatorId: 'user-1',
      fieldExpectations: [{ fieldId: 'subject', fingerprint }]
    });
    expect(JSON.stringify(created)).not.toContain('<field');
    expect(await repository.findBlocking(created.productId)).toMatchObject({ id: created.id });

    await expect(
      repository.create({
        requestId: '580e931b-c57d-43a9-b9dd-215956d492af',
        productId: created.productId,
        categoryId: created.categoryId,
        language: created.language,
        payloadFingerprint: fingerprint,
        fieldExpectations: [{ fieldId: 'subject', fingerprint }],
        actorId: 'user-2'
      })
    ).rejects.toBeInstanceOf(ProductMutationJobConflictError);

    now += 20;
    const auditing = await repository.transition({
      id: created.id,
      expectedRevision: 1,
      status: 'auditing',
      actorId: 'user-1',
      traceId: 'trace-1',
      reasonCode: 'ALIBABA_ACCEPTED'
    });
    expect(auditing).toMatchObject({ status: 'auditing', revision: 2, traceId: 'trace-1' });

    now += 20;
    const verified = await repository.transition({
      id: created.id,
      expectedRevision: 2,
      status: 'verified',
      actorId: 'user-1',
      checked: true,
      reasonCode: 'READBACK_MATCHED'
    });
    expect(verified).toMatchObject({
      status: 'verified',
      revision: 3,
      lastCheckedTimeUtc: now,
      completedTimeUtc: now
    });
    expect(await repository.findBlocking(created.productId)).toBeNull();
  });

  it('enforces optimistic revisions and transition order', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    const repository = new SqlProductMutationJobRepository(handle.executor);
    const fingerprint = 'b'.repeat(64);
    const created = await repository.create({
      requestId: '2817ebf7-a38c-432a-9066-f58b993f1b67',
      productId: '1601928079742',
      categoryId: 201712702,
      language: 'zh_CN',
      payloadFingerprint: fingerprint,
      fieldExpectations: [{ fieldId: 'subject', fingerprint }],
      actorId: 'user-1'
    });
    await expect(
      repository.transition({
        id: created.id,
        expectedRevision: 2,
        status: 'failed',
        actorId: 'user-1'
      })
    ).rejects.toBeInstanceOf(EntityVersionConflictError);
    await expect(
      repository.transition({
        id: created.id,
        expectedRevision: 1,
        status: 'verified',
        actorId: 'user-1'
      })
    ).rejects.toThrow('不能从 submitted 变更为 verified');
  });
});
