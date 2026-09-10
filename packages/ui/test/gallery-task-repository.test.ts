import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/gallery-transfer-task.json';
import {
  validateGalleryTransferTask,
  GALLERY_TASK_RETENTION_MS
} from '@one-vegetable/core/gallery-transfer-task';
import { IndexedDbGalleryTaskRepository, GALLERY_TASK_DATABASE } from '../src/lib/gallery-task-repository';

describe('local durable gallery repository', () => {
  it('persists across repository instances, commits revisions and refuses running cleanup', async () => {
    const factory = new IDBFactory();
    const task = validateGalleryTransferTask(structuredClone(fixture));
    const first = new IndexedDbGalleryTaskRepository(factory);
    await first.create(task);
    const second = new IndexedDbGalleryTaskRepository(factory);
    expect(await second.get(task.id)).toEqual(task);
    await second.update(task.id, (current) => {
      current.status = 'running';
    });
    expect((await first.get(task.id)).revision).toBe(2);
    await expect(first.remove(task.id)).rejects.toThrow();
    await expect(first.clearAll()).rejects.toThrow();
    await first.update(task.id, (current) => {
      current.status = 'paused';
    });
    await first.clearAll();
    expect(await second.list()).toEqual([]);
  });
  it('retains old unresolved records and purges only old terminal records', async () => {
    let now = 1000;
    const repo = new IndexedDbGalleryTaskRepository(new IDBFactory(), () => now);
    const original = validateGalleryTransferTask(structuredClone(fixture));
    for (const status of ['paused', 'attention', 'completed', 'cancelled'] as const)
      await repo.create({ ...original, id: status, status, createTimeUtc: now, updateTimeUtc: now });
    now += GALLERY_TASK_RETENTION_MS + 1;
    expect((await repo.list()).map((task) => task.id).sort()).toEqual(['attention', 'paused']);
  });
  it('isolates malformed records and never exposes their contents', async () => {
    const factory = new IDBFactory();
    const repo = new IndexedDbGalleryTaskRepository(factory);
    await repo.list();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open(GALLERY_TASK_DATABASE);
      open.onerror = () => {
        reject(new Error('open'));
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('tasks', 'readwrite');
        tx.objectStore('tasks').put({ id: 'broken', token: 'must-not-survive' });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(new Error('write'));
        };
      };
    });
    expect(await repo.list()).toEqual([]);
    expect(await repo.list()).toEqual([]);
  });
  it('enforces the 100 task quota without deleting unresolved records', async () => {
    const repo = new IndexedDbGalleryTaskRepository(new IDBFactory());
    const task = validateGalleryTransferTask(structuredClone(fixture));
    for (let i = 0; i < 100; i++) await repo.create({ ...task, id: `task-${i}` });
    await expect(repo.create({ ...task, id: 'overflow' })).rejects.toThrow();
    expect(await repo.list()).toHaveLength(100);
  });
});
