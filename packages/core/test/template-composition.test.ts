// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/template-composition.json' with { type: 'json' };
import { parseProductSchemaXml } from '../src/product-schema';
import {
  composeDescriptionTemplates,
  descriptionTemplateToken,
  descriptionTemplateValuesFromSchema,
  DESCRIPTION_COMPOSITION_MAX_BYTES,
  DESCRIPTION_COMPOSITION_MAX_TEMPLATES,
  DESCRIPTION_VARIABLE_MAX_CHARACTERS
} from '../src/template-composition';

describe('description template composition', () => {
  it('replaces supported variables, preserves order, and never changes stored templates', () => {
    const before = JSON.stringify(fixture.templates);
    const result = composeDescriptionTemplates(fixture.templates, fixture.values);
    expect(result.canApply).toBe(true);
    expect(result.html).toContain('About Example Textile');
    expect(result.html.indexOf('Shipping')).toBeLessThan(result.html.indexOf('Packaging'));
    expect(result.html).not.toContain('{{');
    expect(JSON.stringify(fixture.templates)).toBe(before);
  });
  it('escapes supplied HTML and does not recursively evaluate placeholders', () => {
    const result = composeDescriptionTemplates(
      [{ id: 'test', html: '<p>{{ productName }}</p><p>{{model}}</p>' }],
      { productName: fixture.unsafeValue, model: '{{companyName}}' }
    );
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    expect(result.canApply).toBe(true);
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe(fixture.unsafeValue);
    expect(doc.querySelectorAll('p')[1]?.textContent).toBe('{{companyName}}');
  });
  it('reports missing/unsupported variables without guessing values or running expressions', () => {
    const result = composeDescriptionTemplates(
      [{ id: 'x', html: '<p>{{companyName}} {{companyName}} {{1+1}} {{unknown}}</p>' }],
      {}
    );
    expect(result.missing).toEqual(['companyName']);
    expect(result.unsupported).toEqual(['1+1', 'unknown']);
    expect(result.canApply).toBe(false);
  });
  it('does not interpolate attributes, and keeps gallery image IDs unchanged', () => {
    const invalid = composeDescriptionTemplates(
      [{ id: 'x', html: '<a href="https://example.com/{{model}}">{{productName}}</a>' }],
      fixture.values
    );
    expect(invalid.attributeVariables).toEqual(['a.href']);
    expect(invalid.canApply).toBe(false);
    const valid = composeDescriptionTemplates([{ id: 'img', html: fixture.imageHtml }], fixture.values);
    expect(valid.canApply).toBe(true);
    expect(valid.html).toContain('data-photobank-file-id="fixture-photo"');
  });
  it('sanitizes dangerous HTML with the existing whitelist', () => {
    const result = composeDescriptionTemplates(
      [{ id: 'x', html: '<script>alert(1)</script><p onclick="alert(2)">{{productName}}</p>' }],
      fixture.values
    );
    expect(result.canApply).toBe(true);
    expect(result.sanitizedChanges).toBeGreaterThanOrEqual(1);
    expect(result.html).toBe('<p>Cotton T-shirt</p>');
  });
  it('bounds template count, Unicode value length and final UTF-8 size', () => {
    const many = Array.from({ length: DESCRIPTION_COMPOSITION_MAX_TEMPLATES + 1 }, (_, id) => ({
      id: String(id),
      html: '<p>x</p>'
    }));
    expect(composeDescriptionTemplates(many, {}).tooMany).toBe(true);
    expect(composeDescriptionTemplates([], {}).canApply).toBe(false);
    expect(
      composeDescriptionTemplates([{ id: 'x', html: '<p>{{model}}</p>' }], {
        model: '😀'.repeat(DESCRIPTION_VARIABLE_MAX_CHARACTERS + 1)
      }).oversizedValues
    ).toEqual(['model']);
    expect(
      composeDescriptionTemplates([{ id: 'x', html: '中'.repeat(DESCRIPTION_COMPOSITION_MAX_BYTES / 2) }], {})
        .tooLarge
    ).toBe(true);
    expect(
      composeDescriptionTemplates([{ id: 'x', html: '{{model}}'.repeat(100) }], { model: '😀'.repeat(2000) })
        .tooLarge
    ).toBe(true);
    expect(
      composeDescriptionTemplates([{ id: 'x', html: '{{model}}'.repeat(20000) }], { model: 'x'.repeat(2000) })
        .html.length
    ).toBeLessThan(300000);
    expect(descriptionTemplateToken('model')).toBe('{{model}}');
  });
  it('autofills exact, unambiguous scalar Schema values and leaves missing units/company information blank', () => {
    const model = parseProductSchemaXml(fixture.schemaXml);
    const before = JSON.stringify(model);
    expect(descriptionTemplateValuesFromSchema(model)).toEqual({
      productName: 'Cotton T-shirt',
      model: 'CT-100',
      shippingOrigin: 'Shanghai'
    });
    expect(JSON.stringify(model)).toBe(before);
    expect(descriptionTemplateValuesFromSchema(null)).toEqual({});
    const title = model.fields[0];
    if (!title) throw new Error('Missing title');
    model.fields.push({
      ...title,
      id: 'productTitle',
      key: 'other',
      values: [{ text: 'Different title', attributes: {}, metadata: {} }]
    });
    expect(descriptionTemplateValuesFromSchema(model).productName).toBeUndefined();
  });
});
