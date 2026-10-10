import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/template-library.json';
import {
  IndexedDbProductDescriptionTemplateClient,
  clearLocalTemplates,
  LOCAL_TEMPLATE_DATABASE
} from '../../core/src/indexeddb-template-client';
import { parseTemplateBundle } from '../../core/src/template-library';

function sample() {
  const item = parseTemplateBundle(new TextEncoder().encode(JSON.stringify(fixture))).templates[0];
  if (!item) throw new Error('Missing template fixture');
  return item;
}
describe('local template transactions', () => {
  it('persists across clients, sanitizes HTML and preserves creation audit fields', async () => {
    const db = new IDBFactory();
    const client = new IndexedDbProductDescriptionTemplateClient(db);
    const created = await client.create({ ...sample(), html: '<p>Safe</p><script>unsafe()</script>' });
    expect(created.html).toBe('<p>Safe</p>');
    expect((await new IndexedDbProductDescriptionTemplateClient(db).list()).items).toEqual([created]);
    const update = {
      ...sample(),
      id: created.id,
      revision: created.revision,
      name: 'Changed',
      html: created.html
    };
    const updated = await client.update(update);
    expect(updated).toMatchObject({
      name: 'Changed',
      revision: 2,
      creatorId: 'local:templates',
      createTimeUtc: created.createTimeUtc
    });
    await expect(client.update(update)).rejects.toMatchObject({
      gatewayError: { code: 'ENTITY_VERSION_CONFLICT' }
    });
    const archived = await client.archive(updated.id, updated.revision);
    expect((await client.list({ status: 'active' })).total).toBe(0);
    expect(await client.restore(archived.id, archived.revision)).toMatchObject({
      status: 'active',
      revision: 4
    });
  });
  it('serializes case-insensitive uniqueness across tabs', async () => {
    const db = new IDBFactory();
    const first = new IndexedDbProductDescriptionTemplateClient(db);
    const second = new IndexedDbProductDescriptionTemplateClient(db);
    const outcomes = await Promise.allSettled([
      first.create(sample()),
      second.create({ ...sample(), name: sample().name.toUpperCase() })
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await first.list()).total).toBe(1);
  });
  it('rejects forged inputs and oversized HTML before persisting', async () => {
    const client = new IndexedDbProductDescriptionTemplateClient(new IDBFactory());
    await expect(client.create({ ...sample(), html: '中'.repeat(90_000) })).rejects.toThrow();
    await expect(client.create({ ...sample(), name: '' })).rejects.toThrow();
    await expect(client.create({ ...sample(), html: '<script>unsafe()</script>' })).rejects.toThrow();
    await expect(
      client.create({ ...sample(), revision: 999 } as Parameters<typeof client.create>[0])
    ).rejects.toThrow();
    expect((await client.list()).total).toBe(0);
  });
  it('rejects corrupted records and clears only its named database', async () => {
    const factory = new IDBFactory();
    const client = new IndexedDbProductDescriptionTemplateClient(factory);
    await client.create(sample());
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(LOCAL_TEMPLATE_DATABASE);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('templates', 'readwrite');
        tx.objectStore('templates').put({ id: 'broken' });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Fixture write failed'));
        };
      };
    });
    await expect(client.list()).rejects.toThrow('TEMPLATE_STORAGE_INVALID');
    await clearLocalTemplates(factory);
    expect((await client.list()).total).toBe(0);
  });
});
