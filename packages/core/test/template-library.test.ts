import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/template-library.json';
import { MemoryProductDescriptionTemplateClient } from '../src/product-description-template-client';
import {
  encodeTemplateBundle,
  importTemplateBundle,
  listAllTemplates,
  parseTemplateBundle,
  TEMPLATE_BUNDLE_MAX_BYTES
} from '../src/template-library';

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Missing fixture');
  return value;
}

describe('portable description templates', () => {
  it('validates a complete package before any write and rejects IDs or forged audit data', () => {
    const create = vi.fn();
    expect(parseTemplateBundle(bytesOf(fixture)).templates).toHaveLength(2);
    expect(() =>
      parseTemplateBundle(
        bytesOf({ ...fixture, templates: [{ ...fixture.templates[0], creatorId: 'admin' }] })
      )
    ).toThrow();
    expect(() =>
      parseTemplateBundle(bytesOf({ ...fixture, templates: [{ ...fixture.templates[0], id: 'existing' }] }))
    ).toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects malformed UTF-8, oversized bytes, unsupported versions and byte-heavy HTML', () => {
    expect(() => parseTemplateBundle(new Uint8Array([255]))).toThrow();
    expect(() => parseTemplateBundle(new Uint8Array(TEMPLATE_BUNDLE_MAX_BYTES + 1))).toThrow();
    expect(() => parseTemplateBundle(bytesOf({ ...fixture, schemaVersion: 2 }))).toThrow();
    expect(() =>
      parseTemplateBundle(
        bytesOf({ ...fixture, templates: [{ ...fixture.templates[0], html: '中'.repeat(90_000) }] })
      )
    ).toThrow();
  });

  it('exports only portable content and sanitizes it, never IDs/actor/audit metadata', async () => {
    const client = new MemoryProductDescriptionTemplateClient();
    const source = first(fixture.templates);
    const template = await client.create({
      ...source,
      category: 'company',
      language: 'en_US',
      html: '<p>Hello</p><script>secret()</script>'
    });
    const pack = parseTemplateBundle(encodeTemplateBundle([template]));
    expect(pack.templates[0]?.html).toBe('<p>Hello</p>');
    expect(Object.keys(first(pack.templates))).toEqual(['name', 'category', 'language', 'html', 'remark']);
  });

  it('skips same-language names and copies without overwriting, including conflicts in the package', async () => {
    const client = new MemoryProductDescriptionTemplateClient();
    const bundle = parseTemplateBundle(bytesOf(fixture));
    await importTemplateBundle(client, bundle, 'skip');
    expect((await importTemplateBundle(client, bundle, 'skip')).map((v) => v.status)).toEqual([
      'skipped',
      'skipped'
    ]);
    await importTemplateBundle(
      client,
      { ...bundle, templates: [first(bundle.templates), first(bundle.templates)] },
      'copy'
    );
    expect((await client.list({ pageSize: 100 })).items.map((v) => v.name)).toEqual(
      expect.arrayContaining(['Company introduction', 'Company introduction (2)', 'Company introduction (3)'])
    );
  });

  it('reads beyond the first hundred and refuses stalled/incomplete pagination', async () => {
    const memory = new MemoryProductDescriptionTemplateClient();
    for (let i = 0; i < 103; i++)
      await memory.create({
        name: `Template ${i}`,
        category: 'custom',
        language: 'zh_CN',
        html: '<p>Text</p>'
      });
    expect(await listAllTemplates(memory)).toHaveLength(103);
    const page = await memory.list({ pageSize: 100 });
    const stalled = vi.spyOn(memory, 'list').mockResolvedValue(page);
    await expect(listAllTemplates(memory)).rejects.toThrow('TEMPLATE_PAGE_LIMIT_EXCEEDED');
    stalled.mockRestore();
  });

  it('stops on failure or context change; imports never retry a write automatically', async () => {
    const client = new MemoryProductDescriptionTemplateClient();
    const create = vi.spyOn(client, 'create').mockRejectedValueOnce(new Error('unknown write'));
    expect(await importTemplateBundle(client, parseTemplateBundle(bytesOf(fixture)), 'skip')).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
    let current = true;
    expect(
      await importTemplateBundle(
        client,
        parseTemplateBundle(bytesOf(fixture)),
        'skip',
        () => {
          current = false;
        },
        () => current
      )
    ).toHaveLength(1);
  });
});
