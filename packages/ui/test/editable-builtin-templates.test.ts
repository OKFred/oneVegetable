import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { BundledProductDescriptionTemplateClient } from '../../core/src/bundled-product-description-template-client';
import { CompositeProductDescriptionTemplateClient } from '../../core/src/composite-template-client';
import { BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA } from '../../core/src/generated/product-description-templates';
import { IndexedDbProductDescriptionTemplateClient } from '../../core/src/indexeddb-template-client';
import { MemoryProductDescriptionTemplateClient } from '../../core/src/product-description-template-client';

const templates = BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates;
const original = templates.find((item) => item.language === 'en_US');
if (!original) throw new Error('Missing bundled template fixture');
const edit = (changes: Partial<Parameters<MemoryProductDescriptionTemplateClient['update']>[0]> = {}) => ({
  id: original.id,
  name: original.name,
  category: original.category,
  language: original.language,
  html: original.html,
  revision: original.revision,
  remark: original.remark,
  ...changes
});
const composite = (
  shared: IndexedDbProductDescriptionTemplateClient | MemoryProductDescriptionTemplateClient
) =>
  new CompositeProductDescriptionTemplateClient(
    new BundledProductDescriptionTemplateClient(templates),
    shared
  );

describe.each(['memory', 'indexeddb'] as const)('editable built-in templates: %s', (kind) => {
  function setup() {
    const factory = new IDBFactory();
    const shared =
      kind === 'memory'
        ? new MemoryProductDescriptionTemplateClient()
        : new IndexedDbProductDescriptionTemplateClient(factory);
    const reopen = () =>
      composite(kind === 'memory' ? shared : new IndexedDbProductDescriptionTemplateClient(factory));
    return { shared, client: composite(shared), reopen };
  }

  it('persists a sanitized override under the original ID without changing bundled defaults', async () => {
    const { client, shared, reopen } = setup();
    const snapshot = structuredClone(original);
    const updated = await client.update(
      edit({
        name: 'Edited built-in',
        html: '<p>Edited</p><script>unsafe()</script>'
      })
    );
    expect(updated).toMatchObject({
      id: original.id,
      revision: 2,
      name: 'Edited built-in',
      html: '<p>Edited</p>',
      creatorId: original.creatorId,
      createTimeUtc: original.createTimeUtc
    });
    const listed = await reopen().list({ language: original.language });
    expect(listed.items.filter((item) => item.id === original.id)).toEqual([updated]);
    expect((await shared.list()).total).toBe(1);
    expect(original).toEqual(snapshot);
  });

  it('deletes an untouched built-in reversibly, without resurrecting it after reopening', async () => {
    const { client, reopen } = setup();
    const archived = await client.archive(original.id, original.revision);
    expect(archived).toMatchObject({ status: 'archived', revision: 2, html: original.html });
    expect((await reopen().list({ status: 'active' })).items.some((item) => item.id === original.id)).toBe(
      false
    );
    expect((await reopen().list({ status: 'archived' })).items).toEqual([archived]);
    const restored = await reopen().restore(original.id, archived.revision);
    expect(restored).toMatchObject({ status: 'active', revision: 3, html: original.html });
    expect(
      (await reopen().list({ language: original.language })).items.filter((item) => item.id === original.id)
    ).toEqual([restored]);
  });

  it('rejects stale simultaneous first edits rather than overwriting the winning result', async () => {
    const { client, shared } = setup();
    const outcomes = await Promise.allSettled([
      client.update(edit({ html: '<p>Changed</p>' })),
      client.archive(original.id, original.revision)
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { gatewayError: { code: 'ENTITY_VERSION_CONFLICT' } }
    });
    expect((await shared.list()).total).toBe(1);
  });

  it('does not reveal the original again when its override changes language or category', async () => {
    const { client, reopen } = setup();
    const changed = await client.update(
      edit({
        name: 'Moved built-in',
        language: 'zh_CN',
        category: 'custom',
        html: '<p>Changed</p>'
      })
    );
    expect((await reopen().list({ language: 'en_US' })).items.some((item) => item.id === original.id)).toBe(
      false
    );
    expect(
      (await reopen().list({ language: 'zh_CN', category: 'custom' })).items.filter(
        (item) => item.id === original.id
      )
    ).toEqual([changed]);
    expect(
      (await reopen().list({ category: original.category })).items.some((item) => item.id === original.id)
    ).toBe(false);
  });

  it('does not materialize unknown IDs or incorrect first revisions', async () => {
    const { client, shared } = setup();
    await expect(client.archive(crypto.randomUUID(), 1)).rejects.toMatchObject({
      gatewayError: { code: 'TEMPLATE_NOT_FOUND' }
    });
    await expect(client.update(edit({ revision: 99 }))).rejects.toMatchObject({
      gatewayError: { code: 'ENTITY_VERSION_CONFLICT' }
    });
    expect((await shared.list()).total).toBe(0);
  });

  it('preserves existing same-name custom content when an initial edit conflicts', async () => {
    const { client, shared } = setup();
    const { name, category, language, remark } = original;
    const custom = await shared.create({ name, category, language, remark, html: '<p>Custom content</p>' });
    await expect(client.update(edit({ html: '<p>Conflicting edit</p>' }))).rejects.toMatchObject({
      gatewayError: { code: 'TEMPLATE_NAME_CONFLICT' }
    });
    expect((await shared.list()).items).toEqual([custom]);
    await expect(client.update(edit({ name: 'Renamed built-in' }))).resolves.toMatchObject({ revision: 2 });
  });
});
