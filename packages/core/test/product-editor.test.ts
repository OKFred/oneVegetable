// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  classifyProductSchemaFields,
  isProductSchemaGroupField,
  productEditorStepForField,
  productSchemaGroupLevel,
  selectQuickPublishFields
} from '../src/product-editor';
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

  it('recognizes scalar and three-level product group fields', () => {
    const model = parseProductSchemaXml(`<itemSchema>
      <field id="productGroup" name="Product group" type="complex">
        <complex-value>
          <field id="first_group_id" name="First" type="input"><value>1001</value></field>
          <field id="second_group_id" name="Second" type="input"><value>1101</value></field>
        </complex-value>
      </field>
      <field id="group_id" name="Legacy group" type="input"><value>1002</value></field>
    </itemSchema>`);

    expect(model.fields.every(isProductSchemaGroupField)).toBe(true);
    expect(model.fields[0]?.instances[0]?.fields.map(productSchemaGroupLevel)).toEqual([1, 2]);
    expect(
      classifyProductSchemaFields(model.fields)
        .flatMap((section) => section.fields)
        .every((entry) => entry.recommended && !entry.optional)
    ).toBe(true);
  });

  it('keeps all required fields and fast-path commerce fields in original order', () => {
    const fields = parseProductSchemaXml(XML).fields;
    const selected = selectQuickPublishFields(fields);

    expect(selected.essential.map((entry) => entry.field.id)).toEqual([
      'productTitle',
      'scImages',
      'superText',
      'minimumOrderQuantity',
      'unknownRequired'
    ]);
    expect(selected.remaining.map((entry) => entry.field.id)).toEqual(['material', 'unknownOptional']);
    expect([...selected.essential, ...selected.remaining].map((entry) => entry.sourceIndex).sort()).toEqual(
      fields.map((_, index) => index)
    );
  });

  it('treats a positive minimum item rule as required in the quick publish path', () => {
    const fields = parseProductSchemaXml(`<itemSchema>
      <field id="ladderPeriod" name="Shipping" type="complex">
        <rules><rule name="minInputNumRule" value="1"/><rule name="maxInputNumRule" value="3"/></rules>
        <fields><field id="ladderPeriod_0" type="complex"><fields>
          <field id="quantity" type="input"/><field id="day" type="input"/>
        </fields></field></fields>
      </field>
    </itemSchema>`).fields;

    expect(selectQuickPublishFields(fields).essential.map((entry) => entry.field.id)).toEqual([
      'ladderPeriod'
    ]);
    expect(classifyProductSchemaFields(fields)[4]?.fields[0]).toMatchObject({
      required: true,
      optional: false
    });
  });
});
