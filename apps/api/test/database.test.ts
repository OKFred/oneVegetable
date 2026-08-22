import { afterEach, describe, expect, it } from 'vitest';

import { applyNodeMigrations, isNodeDatabaseReady, openNodeDatabase } from '../src/db/node-database';
import { createSqliteMetadataRepository, EntityVersionConflictError } from '../src/db/repository';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let handle: NodeDatabaseHandle | undefined;

afterEach(() => {
  handle?.connection.close();
  handle = undefined;
});

describe('Node SQLite repository', () => {
  it('shares migrations, millisecond audit fields and optimistic revision checks', async () => {
    handle = openNodeDatabase(':memory:');
    expect(isNodeDatabaseReady(handle)).toBe(false);
    applyNodeMigrations(handle);
    expect(isNodeDatabaseReady(handle)).toBe(true);

    let now = 1_723_456_789_012;
    const repository = createSqliteMetadataRepository(handle.db, () => now);
    const created = await repository.create({
      key: 'gateway-mode',
      value: 'mock',
      actorId: 'system:bootstrap',
      remark: ' local default '
    });
    expect(created).toMatchObject({
      revision: 1,
      createTimeUtc: now,
      updateTimeUtc: now,
      creatorId: 'system:bootstrap',
      updaterId: 'system:bootstrap',
      remark: 'local default'
    });

    const migratedHandle = handle;
    expect(() => {
      applyNodeMigrations(migratedHandle);
    }).not.toThrow();
    await expect(repository.get(created.key)).resolves.toEqual(created);

    now += 25;
    const updated = await repository.update({
      key: created.key,
      value: 'disabled',
      expectedRevision: 1,
      actorId: 'admin-1',
      remark: null
    });
    expect(updated).toMatchObject({ revision: 2, updateTimeUtc: now, updaterId: 'admin-1' });
    expect(updated.createTimeUtc).toBe(created.createTimeUtc);

    await expect(
      repository.update({
        key: created.key,
        value: 'real',
        expectedRevision: 1,
        actorId: 'admin-2',
        remark: null
      })
    ).rejects.toBeInstanceOf(EntityVersionConflictError);
  });
});
