import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/product-maintenance-repository.json';
import domain from '../../../mock/data/product-maintenance-api.json';
import {
  classifyProductMaintenanceResponse,
  createProductMaintenanceIntent
} from '../../../packages/core/src/product-maintenance-api';
import {
  parseProductMaintenanceRecord,
  type ProductMaintenanceRecord,
  type ProductMaintenanceTaskStatus
} from '../../../packages/core/src/product-maintenance-service';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlProductMaintenanceRepository } from '../src/product-maintenance/repository';
import type { SqlExecutor } from '../src/db/sql-executor';

let db: NodeDatabaseHandle;
let repository: SqlProductMaintenanceRepository;
function sample(name: keyof typeof fixture.records = 'inventory', id = fixture.taskId) {
  const record = parseProductMaintenanceRecord(fixture.records[name]);
  record.task.id = id;
  return record;
}
function advance(record: ProductMaintenanceRecord, status: ProductMaintenanceTaskStatus) {
  const next = structuredClone(record);
  next.task.revision++;
  next.task.updateTimeUtc++;
  next.task.status = status;
  const attempted = status !== 'prepared' && status !== 'cancelled';
  next.task.submitAttempted = attempted;
  next.task.submittedTimeUtc = attempted ? fixture.now : null;
  next.task.receipt =
    status === 'dispatching' || !attempted
      ? null
      : classifyProductMaintenanceResponse(
          next.task.intent.draft,
          status === 'partial'
            ? domain.responses.partial
            : status === 'rejected'
              ? domain.responses.rejected
              : domain.responses.accepted
        );
  if (status === 'ambiguous') next.task.receipt = null;
  next.task.readback =
    status === 'verified'
      ? { status: 'matched', mismatchedFields: [], unavailableFields: [], checkedTimeUtc: fixture.now }
      : null;
  return next;
}
beforeEach(() => {
  db = openNodeDatabase(':memory:');
  applyNodeMigrations(db);
  if (!db.connection.prepare('SELECT version FROM schema_migrations WHERE version = 18').get()) {
    db.connection.exec(
      readFileSync(new URL('../drizzle/0018_product_maintenance_jobs.sql', import.meta.url), 'utf8')
    );
  }
  repository = new SqlProductMaintenanceRepository(db.executor);
});
afterEach(() => {
  db.connection.close();
});

describe('SQL product maintenance repository', () => {
  it('applies the new migration and persists safe task metadata across repository instances', async () => {
    const record = sample();
    expect(
      db.connection.prepare('SELECT version FROM schema_migrations WHERE version = 18').get()?.version
    ).toBe(18);
    expect(await repository.get(record.task.id, record.ownerId)).toBeNull();
    await repository.save(record, null);
    expect(
      await new SqlProductMaintenanceRepository(db.executor).get(record.task.id, record.ownerId)
    ).toEqual(record);
    expect(await repository.get(record.task.id, fixture.otherOwnerId)).toBeNull();
    expect(await repository.list(fixture.otherOwnerId)).toEqual([]);
  });
  it('isolates the same task ID by owner', async () => {
    const first = sample();
    const other = sample();
    other.ownerId = fixture.otherOwnerId;
    await repository.save(first, null);
    await repository.save(other, null);
    expect((await repository.get(first.task.id, fixture.ownerId))?.ownerId).toBe(fixture.ownerId);
    expect((await repository.get(other.task.id, fixture.otherOwnerId))?.ownerId).toBe(fixture.otherOwnerId);
  });
  it('atomically permits only one competing revision claim', async () => {
    const record = sample();
    await repository.save(record, null);
    const results = await Promise.allSettled([
      repository.save(advance(record, 'dispatching'), 1),
      new SqlProductMaintenanceRepository(db.executor).save(advance(record, 'cancelled'), 1)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { message: 'ENTITY_VERSION_CONFLICT' } });
    expect((await repository.get(record.task.id, record.ownerId))?.task.revision).toBe(2);
  });
  it('does not overwrite an existing task on a repeated insert', async () => {
    const record = sample();
    await repository.save(record, null);
    await expect(repository.save(record, null)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    expect(await repository.get(record.task.id, record.ownerId)).toEqual(record);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid CAS revision %s', async (revision) => {
    await expect(repository.save(sample(), revision)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
  });
  it.each(['prepared', 'dispatching', 'accepted', 'partial', 'ambiguous'] as const)(
    'keeps every entity exclusive while %s',
    async (status) => {
      const record = sample(status === 'partial' ? 'deleteBatch' : 'inventory');
      await repository.save(record, null);
      if (status !== 'prepared') await repository.save(advance(record, status), 1);
      const competing = sample(status === 'partial' ? 'deleteOne' : 'price', fixture.secondTaskId);
      await expect(repository.save(competing, null)).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
      expect(await repository.get(competing.task.id, competing.ownerId)).toBeNull();
    }
  );
  it.each(['verified', 'rejected', 'cancelled'] as const)(
    'releases exclusivity only after %s',
    async (status) => {
      const record = sample();
      await repository.save(record, null);
      await repository.save(advance(record, status), 1);
      const next = sample('price', fixture.secondTaskId);
      await expect(repository.save(next, null)).resolves.toBeUndefined();
    }
  );
  it.each(['otherContext', 'otherIdentityContext'] as const)('scopes entity locks to %s', async (key) => {
    await repository.save(sample(), null);
    const other = sample('price', fixture.secondTaskId);
    other.task.context = fixture[key];
    await expect(repository.save(other, null)).resolves.toBeUndefined();
  });
  it('keeps all draft entities locked after a partial batch outcome', async () => {
    const record = sample('deleteBatch');
    await repository.save(record, null);
    await repository.save(advance(record, 'partial'), 1);
    for (const draftId of domain.drafts.deleteBatch.draftIds) {
      const other = sample('deleteOne', fixture.secondTaskId);
      other.task.intent = await createProductMaintenanceIntent({
        ...domain.drafts.deleteOne,
        draftIds: [draftId],
        knownDrafts: domain.drafts.deleteBatch.knownDrafts
      });
      await expect(repository.save(other, null)).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
    }
  });
  it('permits a product and a distinct draft entity without broad store locking', async () => {
    await repository.save(sample(), null);
    await expect(repository.save(sample('deleteOne', fixture.secondTaskId), null)).resolves.toBeUndefined();
  });
  it('does not let a task move to another context or intent', async () => {
    const record = sample();
    await repository.save(record, null);
    const changed = advance(record, 'dispatching');
    changed.task.context = fixture.otherContext;
    await expect(repository.save(changed, 1)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    const intentChange = sample('price');
    intentChange.task.revision = 2;
    await expect(repository.save(intentChange, 1)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    expect(await repository.get(record.task.id, record.ownerId)).toEqual(record);
  });
  it('never resets submitAttempted or reactivates a terminal task', async () => {
    const record = sample();
    await repository.save(record, null);
    const sent = advance(record, 'dispatching');
    await repository.save(sent, 1);
    await expect(repository.save(advance(sent, 'prepared'), 2)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_TASK_CORRUPT'
    );
    const other = sample('deleteOne', fixture.secondTaskId);
    await repository.save(other, null);
    const cancelled = advance(other, 'cancelled');
    await repository.save(cancelled, 1);
    await expect(repository.save(advance(cancelled, 'prepared'), 2)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_TASK_CORRUPT'
    );
  });
  it('preserves list ordering and detached records without changing the database', async () => {
    const first = sample();
    const second = sample('deleteOne', fixture.secondTaskId);
    second.task.updateTimeUtc++;
    await repository.save(first, null);
    await repository.save(second, null);
    const rows = await repository.list(fixture.ownerId);
    expect(rows.map((row) => row.task.id)).toEqual([fixture.secondTaskId, fixture.taskId]);
    const top = rows[0];
    if (!top) throw new Error('Missing record');
    top.task.revision = 999;
    expect((await repository.get(second.task.id, second.ownerId))?.task.revision).toBe(1);
  });
  it('fails closed on structurally corrupt, oversized or forged intent data', async () => {
    const record = sample();
    Reflect.set(record.task, 'unknownSecretField', 'synthetic-rejected');
    await expect(repository.save(record, null)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const forged = sample();
    forged.task.intent.fingerprint = '0'.repeat(64);
    await expect(repository.save(forged, null)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const huge = sample();
    Reflect.set(huge.task.intent.draft, 'inventory', '1'.repeat(100_001));
    await expect(repository.save(huge, null)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  });
  it('detects corrupt persisted JSON and mismatched SQL metadata', async () => {
    const record = sample();
    await repository.save(record, null);
    const row = (await db.executor.query('SELECT * FROM product_maintenance_jobs'))[0];
    if (!row) throw new Error('Missing row');
    for (const changed of [{ record_json: '{}' }, { revision: 5 }, { active: 0 }]) {
      const executor: SqlExecutor = {
        query: () => Promise.resolve([{ ...row, ...changed }]),
        execute: () => Promise.resolve({ changes: 0 })
      };
      await expect(
        new SqlProductMaintenanceRepository(executor).get(record.task.id, record.ownerId)
      ).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    }
  });
  it('propagates storage failure safely without in-memory fallback or SQL details', async () => {
    const executor: SqlExecutor = {
      query: () => Promise.resolve([]),
      execute: () => Promise.reject(new Error('synthetic-private-SQL-detail'))
    };
    await expect(new SqlProductMaintenanceRepository(executor).save(sample(), null)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_STORAGE_FAILED'
    );
  });
});
