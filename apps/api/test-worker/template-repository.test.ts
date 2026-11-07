import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import fixture from '../../../mock/data/template-library.json';
import { parseTemplateBundle } from '@one-vegetable/core/template-library';
import { openD1Database } from '../src/db/d1-database';
import { SqlProductDescriptionTemplateRepository } from '../src/product-description-templates/repository';
import { BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA } from '@one-vegetable/core/runtime';

it('persists built-in overrides and reversible deletion in D1 without a migration', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const source = BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates[0];
  if (!source) throw new Error('Missing bundled fixture');
  const repository = new SqlProductDescriptionTemplateRepository(openD1Database(env.DB).executor);
  const archived = await repository.archive({ id: source.id, expectedRevision: 1, actorId: 'editor' });
  expect(archived).toMatchObject({ status: 'archived', revision: 2, html: source.html });
  expect((await repository.list({ page: 1, pageSize: 20, status: 'active' })).total).toBe(0);
  const restored = await repository.restore({ id: source.id, expectedRevision: 2, actorId: 'editor' });
  const updated = await repository.update({
    ...source,
    name: 'Edited built-in',
    html: '<p>D1 override</p>',
    expectedRevision: restored.revision,
    actorId: 'another-editor'
  });
  expect(updated).toMatchObject({
    id: source.id,
    creatorId: source.creatorId,
    revision: 4,
    html: '<p>D1 override</p>'
  });
  await expect(
    repository.archive({ id: source.id, expectedRevision: 1, actorId: 'stale' })
  ).rejects.toThrow();
  expect((await repository.list({ page: 1, pageSize: 20 })).items).toEqual([updated]);
});

it('shares template content in isolated D1 with revision protection, archive and restore', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const source = parseTemplateBundle(new TextEncoder().encode(JSON.stringify(fixture))).templates[0];
  if (!source) throw new Error('Missing template fixture');
  const repository = new SqlProductDescriptionTemplateRepository(openD1Database(env.DB).executor);
  const template = await repository.create({ ...source, actorId: 'template-editor-a' });
  const updated = await repository.update({
    ...source,
    id: template.id,
    html: '<p>Updated shared content</p>',
    expectedRevision: template.revision,
    actorId: 'template-editor-b'
  });
  expect(updated).toMatchObject({
    revision: 2,
    html: '<p>Updated shared content</p>',
    creatorId: 'template-editor-a',
    updaterId: 'template-editor-b'
  });
  await expect(
    repository.archive({ id: template.id, expectedRevision: 1, actorId: 'template-editor-a' })
  ).rejects.toThrow();
  const archived = await repository.archive({
    id: template.id,
    expectedRevision: 2,
    actorId: 'template-editor-a'
  });
  expect(archived.status).toBe('archived');
  await repository.restore({ id: template.id, expectedRevision: 3, actorId: 'template-editor-b' });
  const found = await repository.list({ page: 1, pageSize: 20, language: source.language, status: 'active' });
  expect(found.items).toEqual([
    expect.objectContaining({ id: template.id, revision: 4, html: updated.html })
  ]);
});
