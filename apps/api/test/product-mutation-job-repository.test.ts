import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

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
  it('upgrades historical TOP receipts without inventing a protocol or an account binding', async () => {
    handle = openNodeDatabase(':memory:');
    const directory = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(directory)
      .filter((name) => /^00(?:0[1-9]|1[0-6])_/u.test(name))
      .sort()) {
      handle.connection.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
    handle.connection
      .exec(`INSERT INTO product_mutation_jobs (id,request_id,product_id,operation,status,payload_fingerprint,field_expectations_json,encrypted_product_id,target_display,original_display,submitted_time_utc,create_time_utc,update_time_utc,creator_id,updater_id,revision)
      VALUES ('legacy','legacy-request','301','updateProductDisplay','verifying','${'c'.repeat(64)}','[]','legacy-cipher','offline','online',1,1,1,'legacy-admin','legacy-admin',2)`);
    applyNodeMigrations(handle);
    const repository = new SqlProductMutationJobRepository(handle.executor);
    const legacy = await repository.get('legacy');
    expect(legacy).toMatchObject({
      encryptedProductId: 'legacy-cipher',
      revision: 2,
      productContext: null,
      recoveryRequestId: null
    });
    expect(legacy?.protocol).toBeUndefined();
    const input = {
      requestId: crypto.randomUUID(),
      productId: '302',
      protocol: 'iop' as const,
      encryptedProductId: null,
      productContext: { identity: 'a'.repeat(64), gateway: 'b'.repeat(64) },
      targetDisplay: 'offline' as const,
      originalDisplay: 'online' as const,
      payloadFingerprint: 'd'.repeat(64),
      actorId: 'admin'
    };
    expect(await repository.createDisplay(input)).toMatchObject({
      protocol: 'iop',
      encryptedProductId: null,
      productContext: input.productContext
    });
    await expect(repository.createDisplay({ ...input, productId: '303', protocol: 'top' })).rejects.toThrow();
  });
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
    if (created.categoryId === null || created.language === null) {
      throw new Error('Schema 更新任务缺少类目或语言');
    }

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

  it('persists display state snapshots without storing a gateway response', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    let now = 1_723_456_789_100;
    const repository = new SqlProductMutationJobRepository(handle.executor, () => now);
    const created = await repository.createDisplay({
      requestId: '53215cc3-8f1d-4519-b8de-72f36361ba98',
      productId: '1601928079741',
      encryptedProductId: 'AAEz7fWKAJllV4DtZ4FKW45E',
      targetDisplay: 'offline',
      originalDisplay: 'online',
      payloadFingerprint: 'c'.repeat(64),
      actorId: 'admin-1'
    });
    expect(created).toMatchObject({
      operation: 'updateProductDisplay',
      status: 'submitted',
      categoryId: null,
      language: null,
      encryptedProductId: 'AAEz7fWKAJllV4DtZ4FKW45E',
      targetDisplay: 'offline',
      originalDisplay: 'online',
      fieldExpectations: []
    });
    now += 10;
    const verifying = await repository.transition({
      id: created.id,
      expectedRevision: created.revision,
      status: 'verifying',
      actorId: 'admin-1',
      traceId: 'display-trace'
    });
    now += 10;
    const recoveryRequired = await repository.transition({
      id: verifying.id,
      expectedRevision: verifying.revision,
      status: 'recovery-required',
      actorId: 'admin-1',
      checked: true
    });
    now += 10;
    const recovering = await repository.transition({
      id: recoveryRequired.id,
      expectedRevision: recoveryRequired.revision,
      status: 'recovering',
      actorId: 'admin-1'
    });
    now += 10;
    await expect(
      repository.transition({
        id: recovering.id,
        expectedRevision: recovering.revision,
        status: 'recovered',
        actorId: 'admin-1',
        checked: true
      })
    ).resolves.toMatchObject({ status: 'recovered', completedTimeUtc: now });
  });
});
