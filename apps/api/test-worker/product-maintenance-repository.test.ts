import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/product-maintenance-repository.json';
import domain from '../../../mock/data/product-maintenance-api.json';
import { classifyProductMaintenanceResponse } from '../../../packages/core/src/product-maintenance-api';
import { parseProductMaintenanceRecord } from '../../../packages/core/src/product-maintenance-service';
import { openD1Database } from '../src/db/d1-database';
import { SqlProductMaintenanceRepository } from '../src/product-maintenance/repository';

async function setup(name: keyof typeof fixture.records = 'inventory') {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const database = openD1Database(env.DB);
  const repository = new SqlProductMaintenanceRepository(database.executor);
  const record = parseProductMaintenanceRecord(fixture.records[name]);
  record.ownerId = 'worker-' + crypto.randomUUID();
  return { database, repository, record };
}
describe('D1 product maintenance repository', () => {
  it('persists minimal receipts with owner isolation and SQL revision CAS', async () => {
    const { database, repository, record } = await setup();
    await repository.save(record, null);
    const loaded = await new SqlProductMaintenanceRepository(database.executor).get(
      record.task.id,
      record.ownerId
    );
    expect(loaded).toEqual(record);
    expect(await repository.get(record.task.id, fixture.otherOwnerId)).toBeNull();
    const changed = structuredClone(record);
    changed.task.revision = 2;
    changed.task.updateTimeUtc++;
    changed.task.status = 'dispatching';
    changed.task.submitAttempted = true;
    changed.task.submittedTimeUtc = fixture.now;
    await repository.save(changed, 1);
    await expect(repository.save(changed, 1)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    expect((await repository.list(record.ownerId))[0]?.task.status).toBe('dispatching');
  });
  it('uses D1 statement atomicity to exclude concurrent tasks sharing a product', async () => {
    const { database, repository, record } = await setup();
    const other = parseProductMaintenanceRecord(fixture.records.price);
    other.ownerId = record.ownerId;
    other.task.id = fixture.secondTaskId;
    const results = await Promise.allSettled([
      repository.save(record, null),
      new SqlProductMaintenanceRepository(database.executor).save(other, null)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { message: 'PRODUCT_MAINTENANCE_ENTITY_BUSY' }
    });
    expect(await repository.list(record.ownerId)).toHaveLength(1);
  });
  it('keeps partially deleted draft entities locked without partial insertion', async () => {
    const { repository, record } = await setup('deleteBatch');
    await repository.save(record, null);
    const partial = structuredClone(record);
    partial.task.revision = 2;
    partial.task.status = 'partial';
    partial.task.submitAttempted = true;
    partial.task.submittedTimeUtc = fixture.now;
    partial.task.receipt = classifyProductMaintenanceResponse(
      partial.task.intent.draft,
      domain.responses.partial
    );
    await repository.save(partial, 1);
    const other = parseProductMaintenanceRecord(fixture.records.deleteOne);
    other.ownerId = record.ownerId;
    other.task.id = fixture.secondTaskId;
    await expect(repository.save(other, null)).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
    expect(await repository.get(other.task.id, other.ownerId)).toBeNull();
  });
  it('releases a cancelled lock but never allows that original task to be reactivated', async () => {
    const { repository, record } = await setup();
    await repository.save(record, null);
    const cancelled = structuredClone(record);
    cancelled.task.revision = 2;
    cancelled.task.status = 'cancelled';
    await repository.save(cancelled, 1);
    const other = parseProductMaintenanceRecord(fixture.records.price);
    other.ownerId = record.ownerId;
    other.task.id = fixture.secondTaskId;
    await repository.save(other, null);
    const revived = structuredClone(record);
    revived.task.revision = 3;
    await expect(repository.save(revived, 2)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  });
});
