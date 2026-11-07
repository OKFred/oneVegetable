import { afterEach, describe, expect, it } from 'vitest';

import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { EntityVersionConflictError } from '../src/db/repository';
import { BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA } from '@one-vegetable/core/runtime';
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
  it('materializes built-in edits with stable IDs, revisions and recoverable deletion', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    const source = BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates[0];
    if (!source) throw new Error('Missing bundled fixture');
    const repository = new SqlProductDescriptionTemplateRepository(handle.executor);
    await expect(
      repository.update({
        ...source,
        name: 'Invalid stale first edit',
        expectedRevision: 99,
        actorId: 'editor'
      })
    ).rejects.toBeInstanceOf(EntityVersionConflictError);
    expect((await repository.list({ page: 1, pageSize: 20 })).total).toBe(0);
    const updated = await repository.update({
      ...source,
      name: 'Edited built-in',
      html: '<p>Edited content</p>',
      expectedRevision: source.revision,
      actorId: 'editor'
    });
    expect(updated).toMatchObject({
      id: source.id,
      creatorId: source.creatorId,
      createTimeUtc: source.createTimeUtc,
      updaterId: 'editor',
      revision: 2,
      html: '<p>Edited content</p>'
    });
    const reopened = new SqlProductDescriptionTemplateRepository(handle.executor);
    expect(await reopened.get(source.id)).toEqual(updated);
    await expect(
      reopened.archive({
        id: source.id,
        expectedRevision: 1,
        actorId: 'another-editor'
      })
    ).rejects.toBeInstanceOf(EntityVersionConflictError);
    const archived = await reopened.archive({
      id: source.id,
      expectedRevision: 2,
      actorId: 'editor'
    });
    expect((await reopened.list({ page: 1, pageSize: 20, status: 'active' })).total).toBe(0);
    expect(
      await reopened.restore({
        id: source.id,
        expectedRevision: archived.revision,
        actorId: 'editor'
      })
    ).toMatchObject({ status: 'active', revision: 4, html: updated.html });
    expect(BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates[0]).toEqual(source);
  });

  it('archives untouched built-ins and rejects racing first modifications atomically', async () => {
    handle = openNodeDatabase(':memory:');
    applyNodeMigrations(handle);
    const source = BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates[0];
    const other = BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates[1];
    if (!source || !other) throw new Error('Missing bundled fixtures');
    const repository = new SqlProductDescriptionTemplateRepository(handle.executor);
    const outcomes = await Promise.allSettled([
      repository.update({ ...source, expectedRevision: 1, actorId: 'first', name: 'Changed' }),
      repository.archive({ id: source.id, expectedRevision: 1, actorId: 'second' })
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { name: 'EntityVersionConflictError' }
    });
    const archived = await repository.archive({ id: other.id, expectedRevision: 1, actorId: 'editor' });
    expect(archived).toMatchObject({ id: other.id, status: 'archived', revision: 2 });
    await expect(
      repository.update({
        ...source,
        id: crypto.randomUUID(),
        expectedRevision: 1,
        actorId: 'editor'
      })
    ).rejects.toThrow('商品详情模板不存在');
    expect((await repository.list({ page: 1, pageSize: 20 })).total).toBe(2);
  });

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
