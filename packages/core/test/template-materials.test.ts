import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/template-material-core.json';
import {
  parseTemplateMaterialDocument,
  templateImageSources,
  templateMaterialManifest,
  templateMaterialPath,
  templateMaterialResolvedBundle,
  templatesWithMaterialPaths,
  type TemplateMaterialDocument
} from '../src/template-materials';

const path = templateMaterialPath(fixture.sha256, 'png');
function sample(): TemplateMaterialDocument {
  return {
    kind: 'oneVegetable.product-description-template-assets',
    schemaVersion: 1,
    exportedAtUtc: 1_800_000_000_000,
    templates: [
      {
        ...fixture.template,
        category: 'company',
        language: 'en_US',
        html: `${fixture.template.html}<img alt="company" src="${path}">`
      }
    ],
    assets: [
      { path, fileName: 'company.png', contentType: 'image/png', byteLength: 8, sha256: fixture.sha256 }
    ]
  };
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
describe('portable template materials', () => {
  it('deduplicates sources and removes old account material metadata while keeping text variables', () => {
    const original = {
      ...sample().templates[0],
      html: `${fixture.template.html}<img src="${fixture.sourceUrl}" data-photobank-file-id="${fixture.oldFileId}" data-photobank-width="750"><img src="${fixture.sourceUrl}">`
    };
    // Use the typed portable entry instead of trusting optional array access.
    const entry = sample().templates[0];
    if (!entry) throw new Error('fixture');
    const value = { ...entry, html: original.html };
    expect(templateImageSources([value])).toEqual([fixture.sourceUrl]);
    const replaced = templatesWithMaterialPaths([value], new Map([[fixture.sourceUrl, path]]));
    expect(replaced[0]?.html).toContain('{{companyName}}');
    expect(replaced[0]?.html).toContain(path);
    expect(replaced[0]?.html).not.toContain(fixture.sourceUrl);
    expect(replaced[0]?.html).not.toContain('data-photobank-');
  });
  it('normalizes safe HTML and rejects undeclared, absolute, traversal and unreferenced images', () => {
    const value = sample();
    const entry = value.templates[0];
    if (!entry) throw new Error('fixture');
    entry.html += '<script>alert(1)</script>';
    const parsed = parseTemplateMaterialDocument(encode(value));
    expect(parsed.templates[0]?.html).not.toContain('script');
    expect(parsed.templates[0]?.html).toContain(path);
    expect(parseTemplateMaterialDocument(templateMaterialManifest(parsed))).toEqual(parsed);
    for (const bad of [
      fixture.sourceUrl,
      '../assets/a.png',
      '/assets/a.png',
      `assets/${'b'.repeat(64)}.png`
    ]) {
      entry.html = `<img src="${bad}">`;
      expect(() => parseTemplateMaterialDocument(encode(value))).toThrow();
    }
    entry.html = '<p>No image</p>';
    expect(() => parseTemplateMaterialDocument(encode(value))).toThrow('TEMPLATE_MATERIAL_UNREFERENCED');
  });
  it('rejects invalid timestamps, metadata, duplicate hashes and filenames', () => {
    const value = sample();
    expect(() =>
      parseTemplateMaterialDocument(encode({ ...value, exportedAtUtc: Number.MAX_SAFE_INTEGER + 1 }))
    ).toThrow();
    expect(() =>
      parseTemplateMaterialDocument(encode({ ...value, assets: [...value.assets, ...value.assets] }))
    ).toThrow();
    const asset = value.assets[0];
    if (!asset) throw new Error('fixture');
    for (const fileName of ['../company.png', 'a\\b.png', 'x\n.png'])
      expect(() =>
        parseTemplateMaterialDocument(encode({ ...value, assets: [{ ...asset, fileName }] }))
      ).toThrow();
  });
  it('accepts only gallery HTTPS sources without embedded credentials or fragments', () => {
    const value = sample().templates[0];
    if (!value) throw new Error('fixture');
    for (const url of [
      'http://s.alicdn.com/a.png',
      'https://example.com/a.png',
      'https://user:pass@s.alicdn.com/a.png',
      `${fixture.sourceUrl}#secret`
    ])
      expect(() => templateImageSources([{ ...value, html: `<img src="${url}">` }])).toThrow();
    expect(templateImageSources([{ ...value, html: '<img src="//s.alicdn.com/a.png">' }])).toEqual([
      'https://s.alicdn.com/a.png'
    ]);
  });
  it('does not export original signed image links around portable images', () => {
    const entry = sample().templates[0];
    if (!entry) throw new Error('fixture');
    const url = `${fixture.sourceUrl}?signature=fixture-not-a-secret`;
    for (const href of [url, `${url}#preview`, `${fixture.sourceUrl}?signature=another-fixture`]) {
      const values = templatesWithMaterialPaths(
        [{ ...entry, html: `<a href="${href}" target="_blank"><img src="${url}"></a>` }],
        new Map([[url, path]])
      );
      expect(values[0]?.html).toContain(path);
      expect(values[0]?.html).not.toContain(fixture.sourceUrl);
      expect(values[0]?.html).not.toContain('signature');
    }
  });
  it('resolves only freshly confirmed material IDs and URLs, not old account IDs', () => {
    const document = sample();
    const parsed = templateMaterialResolvedBundle(
      document,
      new Map([[path, { url: fixture.newUrl, fileId: fixture.newFileId }]])
    );
    expect(parsed.templates[0]?.html).toContain(fixture.newUrl);
    expect(parsed.templates[0]?.html).toContain(`data-photobank-file-id="${fixture.newFileId}"`);
    expect(parsed.templates[0]?.html).not.toContain(path);
    expect(() => templateMaterialResolvedBundle(document, new Map())).toThrow(
      'TEMPLATE_MATERIAL_UNCONFIRMED'
    );
    expect(() =>
      templateMaterialResolvedBundle(
        document,
        new Map([[path, { url: 'https://example.com/x.png', fileId: fixture.newFileId }]])
      )
    ).toThrow();
  });
});
