// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { classifyProductSchemaFields, productEditorStepForField } from '../src/product-editor';
import { parseProductSchemaXml } from '../src/product-schema';

const XML = `<itemSchema>
  <field id="productTitle" name="Product title" type="input"><rules><rule name="requiredRule" value="true"/></rules><value>Solar station</value></field>
  <field id="material" name="Material" type="input"><rules><rule name="tipRule" value="Prefer an exact material"/></rules><value>ABS</value></field>
  <field id="scImages" name="Images" type="multiInput"><value fileId="photo-1">https://photobank.example/a.jpg</value></field>
  <field id="superText" name="Description" type="input"><rules><rule name="valueTypeRule" value="html"/></rules><value>&lt;p&gt;Detail&lt;/p&gt;</value></field>
  <field id="minimumOrderQuantity" name="Minimum order quantity" type="input"><value>10</value></field>
  <field id="unknownRequired" name="Unknown required" type="input"><rules><rule name="requiredRule" value="1"/></rules><value>x</value></field>
  <field id="unknownOptional" name="Unknown optional" type="input"><value/></field>
</itemSchema>`;

describe('product editor field classifier', () => {
  it('assigns every field exactly once while preserving source order', () => {
    const model = parseProductSchemaXml(XML);
    const sections = classifyProductSchemaFields(model.fields);
    const entries = sections.flatMap((section) => section.fields);

    expect(entries).toHaveLength(model.fields.length);
    expect(new Set(entries.map((entry) => entry.field.key)).size).toBe(model.fields.length);
    expect(entries.map((entry) => entry.sourceIndex).toSorted((left, right) => left - right)).toEqual(
      model.fields.map((_, index) => index)
    );
  });

  it('uses deterministic content rules and keeps unknown fields in attributes', () => {
    const fields = parseProductSchemaXml(XML).fields;
    expect(fields.map(productEditorStepForField)).toEqual([
      'basics',
      'attributes',
      'media',
      'description',
      'trade',
      'attributes',
      'attributes'
    ]);
  });

  it('separates required, recommended and optional fields', () => {
    const sections = classifyProductSchemaFields(parseProductSchemaXml(XML).fields);
    const entries = sections.flatMap((section) => section.fields);
    expect(entries.find((entry) => entry.field.id === 'productTitle')).toMatchObject({
      required: true,
      recommended: false,
      optional: false
    });
    expect(entries.find((entry) => entry.field.id === 'material')).toMatchObject({
      required: false,
      recommended: true,
      optional: false
    });
    expect(entries.find((entry) => entry.field.id === 'unknownOptional')).toMatchObject({
      required: false,
      recommended: false,
      optional: true
    });
  });
});
