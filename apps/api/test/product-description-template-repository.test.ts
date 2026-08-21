import { afterEach, describe, expect, it } from 'vitest';

import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { EntityVersionConflictError } from '../src/db/repository';
import {
  ProductDescriptionTemplateNameConflictError,
  SqlProductDescriptionTemplateRepository
} from '../src/product-description-templates/repository';

import type { NodeDatabaseHandle } from '../src/db/node-database';

let handle: NodeDatabaseHandle | undefined;

afterEach(() => {
  handle?.connection.close();
  handle = undefined;
});

describe('product description template repository', () => {
  it('shares audited CRUD and archive semantics across SQL runtimes', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    let now = 1_723_456_789_012;
    const repository = new SqlProductDescriptionTemplateRepository(handle.executor, () => now);

    const created = await repository.create({
      name: ' Company profile ',
      category: 'company',
      language: 'en_US',
      html: '<h2>About us</h2>',
      actorId: 'user-1',
      remark: ' shared '
    });
    expect(created).toMatchObject({
      name: 'Company profile',
      status: 'active',
      createTimeUtc: now,
      updateTimeUtc: now,
      creatorId: 'user-1',
      updaterId: 'user-1',
      revision: 1,
      remark: 'shared'
    });

    await expect(
      repository.create({
        name: 'company PROFILE',
        category: 'custom',
        language: 'en_US',
        html: '<p>Duplicate</p>',
        actorId: 'user-2'
      })
    ).rejects.toBeInstanceOf(ProductDescriptionTemplateNameConflictError);

    await repository.create({
      name: '公司介绍',
      category: 'company',
      language: 'zh_CN',
      html: '<h2>关于我们</h2>',
      actorId: 'user-2'
    });
    expect(
      await repository.list({ page: 1, pageSize: 20, language: 'en_US', status: 'active' })
    ).toMatchObject({ total: 1, items: [{ id: created.id }] });

    now += 50;
    const updated = await repository.update({
      id: created.id,
      name: 'Company and factory',
      category: 'company',
      language: 'en_US',
      html: '<h2>About our factory</h2>',
      expectedRevision: 1,
      actorId: 'user-2',
      remark: null
    });
    expect(updated).toMatchObject({ revision: 2, updaterId: 'user-2', updateTimeUtc: now });
    expect(updated.createTimeUtc).toBe(created.createTimeUtc);

    await expect(
      repository.update({
        id: created.id,
        name: 'Stale',
        category: 'custom',
        language: 'en_US',
        html: '<p>Stale</p>',
        expectedRevision: 1,
        actorId: 'user-1',
        remark: null
      })
    ).rejects.toBeInstanceOf(EntityVersionConflictError);

    const archived = await repository.archive({
      id: created.id,
      expectedRevision: 2,
      actorId: 'user-1'
    });
    expect(archived).toMatchObject({ status: 'archived', revision: 3 });
    const restored = await repository.restore({
      id: created.id,
      expectedRevision: 3,
      actorId: 'user-2'
    });
    expect(restored).toMatchObject({ status: 'active', revision: 4 });
  });

  it('rejects invalid names and oversized HTML before persistence', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    const repository = new SqlProductDescriptionTemplateRepository(handle.executor);

    await expect(
      repository.create({
        name: ' ',
        category: 'custom',
        language: 'zh_CN',
        html: '<p>内容</p>',
        actorId: 'user-1'
      })
    ).rejects.toThrow('模板名称必须为 1–80 个字符');
    await expect(
      repository.create({
        name: 'Oversized',
        category: 'custom',
        language: 'en_US',
        html: 'a'.repeat(256 * 1024 + 1),
        actorId: 'user-1'
      })
    ).rejects.toThrow('模板 HTML 不能超过 256 KiB');
  });
});
