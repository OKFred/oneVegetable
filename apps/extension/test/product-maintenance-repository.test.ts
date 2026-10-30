import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
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
import {
  ExtensionProductMaintenanceRepository,
  PRODUCT_MAINTENANCE_DATABASE
} from '../lib/product-maintenance-repository';

let factory: IDBFactory;
let repository: ExtensionProductMaintenanceRepository;
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
  factory = new IDBFactory();
  repository = new ExtensionProductMaintenanceRepository(factory);
});
describe('Extension product maintenance repository', () => {
  it('persists detached records and isolates get/list by owner', async () => {
    const record = sample();
    await repository.save(record, null);
    const other = new ExtensionProductMaintenanceRepository(factory);
    expect(await other.get(record.task.id, record.ownerId)).toEqual(record);
    expect(await other.get(record.task.id, fixture.otherOwnerId)).toBeNull();
    expect(await other.list(fixture.otherOwnerId)).toEqual([]);
    const rows = await other.list(record.ownerId);
    const first = rows[0];
    if (!first) throw new Error('Missing row');
    first.task.revision = 999;
    expect((await repository.get(record.task.id, record.ownerId))?.task.revision).toBe(1);
  });
  it('allows the same task ID for different owners', async () => {
    const record = sample();
    const other = sample();
    other.ownerId = fixture.otherOwnerId;
    await repository.save(record, null);
    await repository.save(other, null);
    expect(await repository.get(other.task.id, other.ownerId)).toEqual(other);
  });
  it('atomically permits just one CAS claimant across repository instances', async () => {
    const record = sample();
    await repository.save(record, null);
    const results = await Promise.allSettled([
      repository.save(advance(record, 'dispatching'), 1),
      new ExtensionProductMaintenanceRepository(factory).save(advance(record, 'cancelled'), 1)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { message: 'ENTITY_VERSION_CONFLICT' }
    });
  });
  it('atomically excludes concurrent tasks for the same account/context/product', async () => {
    const results = await Promise.allSettled([
      repository.save(sample(), null),
      new ExtensionProductMaintenanceRepository(factory).save(sample('price', fixture.secondTaskId), null)
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { message: 'PRODUCT_MAINTENANCE_ENTITY_BUSY' }
    });
    expect(await repository.list(fixture.ownerId)).toHaveLength(1);
  });
  it.each(['prepared', 'dispatching', 'accepted', 'partial', 'ambiguous'] as const)(
    'blocks another task and clearAll while %s',
    async (status) => {
      const record = sample(status === 'partial' ? 'deleteBatch' : 'inventory');
      await repository.save(record, null);
      if (status !== 'prepared') await repository.save(advance(record, status), 1);
      await expect(
        repository.save(sample(status === 'partial' ? 'deleteOne' : 'price', fixture.secondTaskId), null)
      ).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
      await expect(repository.clearAll()).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
      expect(await repository.get(record.task.id, record.ownerId)).not.toBeNull();
    }
  );
  it.each(['verified', 'rejected', 'cancelled'] as const)(
    'releases locks and permits explicit clear only after %s',
    async (status) => {
      const record = sample();
      await repository.save(record, null);
      await repository.save(advance(record, status), 1);
      const other = sample('price', fixture.secondTaskId);
      await repository.save(other, null);
      await expect(repository.clearAll()).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
      await repository.save(advance(other, 'cancelled'), 1);
      await repository.clearAll();
      expect(await repository.list(record.ownerId)).toEqual([]);
    }
  );
  it.each(['otherContext', 'otherIdentityContext'] as const)(
    'keeps lock scope independent for %s',
    async (key) => {
      await repository.save(sample(), null);
      const other = sample('price', fixture.secondTaskId);
      other.task.context = fixture[key];
      await expect(repository.save(other, null)).resolves.toBeUndefined();
    }
  );
  it('retains locks on every draft entity after partial deletion', async () => {
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
  it('does not move context, alter intent/baseline, reset send-attempt or revive terminal tasks', async () => {
    const record = sample();
    await repository.save(record, null);
    const moved = advance(record, 'dispatching');
    moved.task.context = fixture.otherContext;
    await expect(repository.save(moved, 1)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const baseline = advance(record, 'dispatching');
    if (!baseline.task.baseline) throw new Error('Missing baseline');
    baseline.task.baseline = { ...baseline.task.baseline, fields: { inventory: '51' } };
    await expect(repository.save(baseline, 1)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
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
  it('rejects duplicate insertion, stale revision and invalid revision increments', async () => {
    const record = sample();
    await repository.save(record, null);
    await expect(repository.save(record, null)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    await expect(repository.save(record, 1)).rejects.toThrow('ENTITY_VERSION_CONFLICT');
    await expect(repository.save(advance(record, 'dispatching'), 0)).rejects.toThrow(
      'ENTITY_VERSION_CONFLICT'
    );
    expect(await repository.get(record.task.id, record.ownerId)).toEqual(record);
  });
  it('snapshots the input before asynchronous validation and returns newest records first', async () => {
    const first = sample();
    const saving = repository.save(first, null);
    first.task.revision = 999;
    await saving;
    const second = sample('deleteOne', fixture.secondTaskId);
    second.task.updateTimeUtc++;
    await repository.save(second, null);
    expect((await repository.list(fixture.ownerId)).map((record) => record.task.id)).toEqual([
      fixture.secondTaskId,
      fixture.taskId
    ]);
    expect((await repository.get(first.task.id, first.ownerId))?.task.revision).toBe(1);
  });
  it('fails closed on corrupt records and forged intent hashes without fallback', async () => {
    const bad = sample();
    Reflect.set(bad.task, 'unknownSecretField', 'synthetic-rejected');
    await expect(repository.save(bad, null)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const forged = sample();
    forged.task.intent.fingerprint = '0'.repeat(64);
    await expect(repository.save(forged, null)).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    expect(await repository.list(fixture.ownerId)).toEqual([]);
  });
  it('does not partially clear resolved records when another owner still has an unresolved task', async () => {
    const first = sample();
    await repository.save(first, null);
    await repository.save(advance(first, 'cancelled'), 1);
    const other = sample();
    other.ownerId = fixture.otherOwnerId;
    await repository.save(other, null);
    await expect(repository.clearAll()).rejects.toThrow('PRODUCT_MAINTENANCE_ENTITY_BUSY');
    expect(await repository.list(first.ownerId)).toHaveLength(1);
    expect(await repository.list(other.ownerId)).toHaveLength(1);
  });
  it('refuses to clear structurally corrupt persisted records', async () => {
    await repository.clearAll();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PRODUCT_MAINTENANCE_DATABASE, 1);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('synthetic IndexedDB open failure'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tasks', 'readwrite');
      tx.objectStore('tasks').put({ ownerId: fixture.ownerId, task: { id: fixture.taskId } });
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(new Error('synthetic IndexedDB write failure'));
      };
    });
    db.close();
    await expect(repository.clearAll()).rejects.toThrow('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    await expect(repository.get(fixture.taskId, fixture.ownerId)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_TASK_CORRUPT'
    );
  });
});
