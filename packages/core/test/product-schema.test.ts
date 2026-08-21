// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cloneProductSchemaInstance,
  inspectProductSchemaSerialization,
  parseProductSchemaXml,
  ProductSchemaSerializationError,
  productSchemaFieldText,
  serializeProductSchemaXml,
  validateProductSchemaModel,
  withProductSchemaFieldText
} from '../src/product-schema';

const REAL_LAYOUT_XML = readFileSync(
  resolve(process.cwd(), 'mock/data/product-schema/real-layout-minimal.xml'),
  'utf8'
);

const XML = `<itemSchema data-version="1">
  <unknown keep="yes" />
  <field id="title" name="Title" type="input"><rules><rule name="requiredRule" value="true"/><rule name="minLengthRule" value="3"/></rules><values><value>A &amp; B</value></values></field>
  <field id="description" name="Description" type="multiInput"><rules><rule name="minInputNumRule" value="1"/></rules><values><value>One</value><value>Two</value></values></field>
  <field id="market" name="Market" type="singleCheck"><options><option displayName="Wholesale" value="wholesale"/></options><values><value>wholesale</value></values></field>
  <field id="services" name="Services" type="multiCheck"><options><option displayName="OEM" value="oem"/><option displayName="ODM" value="odm"/></options><values><value>oem</value></values></field>
  <field id="package" name="Package" type="complex"><complex-values><complex-value><field id="weight" name="Weight" type="input"><rules><rule name="maxValueRule" value="100"/></rules><values><value>5.25</value></values></field></complex-value></complex-values></field>
  <field id="sku" name="SKU" type="multiComplex"><rules><rule name="serverBizRule" value="safe.expression()"/></rules><complex-values><complex-value><field id="skuId" name="SKU ID" type="input"><values><value>SKU-1</value></values></field></complex-value></complex-values></field>
  <field id="notice" name="Server notice" type="label"><values><value>Read only</value></values></field>
</itemSchema>`;

function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing test value at index ${index}`);
  return value;
}

describe('product Schema XML engine', () => {
  it('returns the authoritative source XML byte-for-byte when nothing changed', () => {
    const model = parseProductSchemaXml(REAL_LAYOUT_XML);
    const inspection = inspectProductSchemaSerialization(model);

    expect(inspection).toMatchObject({ noOp: true, safe: true, changedFieldKeys: [] });
    expect(inspection.xml).toBe(REAL_LAYOUT_XML);
    expect(serializeProductSchemaXml(model)).toBe(REAL_LAYOUT_XML);
  });

  it('patches one duplicate-id field while preserving unknown nodes, namespaces and untouched CDATA', () => {
    const model = parseProductSchemaXml(REAL_LAYOUT_XML);
    model.fields[6] = withProductSchemaFieldText(at(model.fields, 6), 'first-updated');
    const inspection = inspectProductSchemaSerialization(model);

    expect(inspection).toMatchObject({ noOp: false, safe: true, changedFieldKeys: ['field:6'] });
    expect(inspection.xml).toContain('ov:flag="A"');
    expect(inspection.xml).toContain('脱敏后的真实布局回归样例');
    expect(inspection.xml).toContain('<![CDATA[<h2>Sample detail</h2>');
    const roundTrip = parseProductSchemaXml(inspection.xml);
    expect(productSchemaFieldText(at(roundTrip.fields, 6))).toBe('first-updated');
    expect(productSchemaFieldText(at(roundTrip.fields, 7))).toBe('second');
  });

  it('keeps official image attributes but excludes gallery display metadata from a patched value', () => {
    const model = parseProductSchemaXml(REAL_LAYOUT_XML);
    const images = at(model.fields, 1);
    expect(at(images.values, 0)).toMatchObject({
      attributes: { fileId: 'photo-1', inputValue: 'cover', img: 'true' },
      metadata: { fileName: 'cover.jpg', width: '1000' }
    });
    images.values[0] = {
      ...at(images.values, 0),
      text: 'https://sc.example/updated.jpg'
    };

    const xml = serializeProductSchemaXml(model);
    expect(xml).toContain('fileId="photo-1" inputValue="cover" img="true"');
    expect(xml).not.toContain('fileName="cover.jpg"');
    expect(xml).not.toContain('width="1000"');
  });

  it('deletes a source-bound middle instance and appends a template-backed instance safely', () => {
    const model = parseProductSchemaXml(REAL_LAYOUT_XML);
    const tiers = at(model.fields, 5);
    tiers.instances.splice(0, 1);
    const added = cloneProductSchemaInstance(tiers);
    added.fields[0] = withProductSchemaFieldText(at(added.fields, 0), '500');
    added.fields[1] = withProductSchemaFieldText(at(added.fields, 1), '8.50');
    tiers.instances.push(added);

    const roundTrip = parseProductSchemaXml(serializeProductSchemaXml(model));
    const resultTiers = at(roundTrip.fields, 5).instances;
    expect(resultTiers).toHaveLength(2);
    expect(productSchemaFieldText(at(at(resultTiers, 0).fields, 0))).toBe('100');
    expect(productSchemaFieldText(at(at(resultTiers, 1).fields, 0))).toBe('500');
  });

  it('blocks serialization when a field no longer maps to its source node', () => {
    const model = parseProductSchemaXml(REAL_LAYOUT_XML);
    at(model.fields, 0).sourceIndex = 999;
    const inspection = inspectProductSchemaSerialization(model);

    expect(inspection.safe).toBe(false);
    expect(inspection.structuralDiffs).toContain('field:0 无法绑定到源字段');
    expect(() => serializeProductSchemaXml(model)).toThrow(ProductSchemaSerializationError);
  });

  it('counts populated complex instances and never validates fields templates as user data', () => {
    const model = parseProductSchemaXml(REAL_LAYOUT_XML);
    const issues = validateProductSchemaModel(model);

    expect(issues.some((issue) => issue.fieldKey === 'field:1' && issue.severity === 'error')).toBe(false);
    expect(issues.some((issue) => issue.fieldKey === 'field:2' && issue.severity === 'error')).toBe(false);
    expect(issues.some((issue) => issue.fieldKey === 'field:5' && issue.severity === 'error')).toBe(false);

    const templateOnly = parseProductSchemaXml(`<itemSchema>
      <field id="tiers" name="Tiers" type="multiComplex">
        <fields><field id="price" name="Price" type="input"><rules><rule name="requiredRule" value="true"/></rules><value/></field></fields>
      </field>
    </itemSchema>`);
    expect(validateProductSchemaModel(templateOnly)).toEqual([]);
  });

  it('deduplicates identical issues while retaining genuinely empty fields', () => {
    const model = parseProductSchemaXml(`<itemSchema>
      <field id="color" name="Color" type="input">
        <rules><rule name="requiredRule" value="true"/><rule name="requiredRule" value="true"/></rules>
        <value/>
      </field>
    </itemSchema>`);
    const issues = validateProductSchemaModel(model);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ fieldKey: 'field:0', rule: 'requiredRule' });
  });

  it('parses all seven field types and keeps unknown rules as warnings', () => {
    const model = parseProductSchemaXml(XML);
    expect(model.fields.map((field) => field.type)).toEqual([
      'input',
      'multiInput',
      'singleCheck',
      'multiCheck',
      'complex',
      'multiComplex',
      'label'
    ]);
    expect(model.warnings).toContain('sku 的 serverBizRule 需由 Alibaba 服务端校验');
  });

  it('serializes special characters without dropping unknown XML nodes', () => {
    const model = parseProductSchemaXml(XML);
    model.fields[0] = withProductSchemaFieldText(at(model.fields, 0), '<Solar & Storage>');
    const serialized = serializeProductSchemaXml(model);
    expect(serialized).toContain('keep="yes"');
    expect(serialized).toContain('&lt;Solar &amp; Storage&gt;');
    expect(productSchemaFieldText(at(parseProductSchemaXml(serialized).fields, 0))).toBe('<Solar & Storage>');
  });

  it('adds and removes multiComplex instances', () => {
    const model = parseProductSchemaXml(XML);
    const sku = at(model.fields, 5);
    const second = cloneProductSchemaInstance(sku);
    second.fields[0] = withProductSchemaFieldText(at(second.fields, 0), 'SKU-2');
    sku.instances.push(second);
    let roundTrip = parseProductSchemaXml(serializeProductSchemaXml(model));
    expect(at(roundTrip.fields, 5).instances).toHaveLength(2);
    expect(productSchemaFieldText(at(at(at(roundTrip.fields, 5).instances, 1).fields, 0))).toBe('SKU-2');
    at(roundTrip.fields, 5).instances.splice(0, 1);
    roundTrip = parseProductSchemaXml(serializeProductSchemaXml(roundTrip));
    expect(at(roundTrip.fields, 5).instances).toHaveLength(1);
  });

  it('validates local rules and never executes server expressions', () => {
    const model = parseProductSchemaXml(XML);
    model.fields[0] = withProductSchemaFieldText(at(model.fields, 0), '');
    const packageInstance = at(at(model.fields, 4).instances, 0);
    packageInstance.fields[0] = withProductSchemaFieldText(at(packageInstance.fields, 0), '101');
    const issues = validateProductSchemaModel(model);
    expect(issues.some((issue) => issue.rule === 'requiredRule' && issue.severity === 'error')).toBe(true);
    expect(issues.some((issue) => issue.rule === 'maxValueRule' && issue.severity === 'error')).toBe(true);
    expect(issues.some((issue) => issue.rule === 'serverBizRule' && issue.severity === 'warning')).toBe(true);
  });

  it('preserves value attributes such as PhotoBank fileId without normalizing the XML layout', () => {
    const xml = `<itemSchema><fields><field id="scImages" name="Images" type="multiInput"><value fileId="photo-1" inputValue="cover" img="true">https://photobank.example/cover.jpg</value></field></fields></itemSchema>`;
    const model = parseProductSchemaXml(xml);
    const image = at(model.fields, 0);
    expect(image.values).toEqual([
      {
        text: 'https://photobank.example/cover.jpg',
        attributes: { fileId: 'photo-1', inputValue: 'cover', img: 'true' },
        metadata: {}
      }
    ]);

    image.values[0] = {
      text: 'https://photobank.example/updated.jpg',
      attributes: { ...at(image.values, 0).attributes },
      metadata: {}
    };
    const serialized = serializeProductSchemaXml(model);
    expect(serialized).toContain('<value fileId="photo-1" inputValue="cover" img="true">');
    expect(serialized).not.toContain('<values>');
    expect(at(parseProductSchemaXml(serialized).fields, 0).values[0]?.attributes.fileId).toBe('photo-1');
  });

  it('parses rule metadata, dependency groups and applies byte/open-bound validation', () => {
    const xml = `<itemSchema>
      <field id="market" name="Market" type="input"><value>wholesale</value></field>
      <field id="title" name="Title" type="input">
        <rules>
          <rule name="minLengthRule" value="4" unit="byte" exProperty="not include">
            <depend-group operator="and"><depend-express fieldId="market" symbol="=" value="wholesale"/></depend-group>
          </rule>
          <rule name="readOnlyRule" value="true"/>
        </rules>
        <value>中文</value>
      </field>
    </itemSchema>`;
    const model = parseProductSchemaXml(xml);
    const title = at(model.fields, 1);
    expect(at(title.rules, 0).attributes).toMatchObject({ unit: 'byte', exProperty: 'not include' });
    expect(at(at(title.rules, 0).dependGroups, 0).expressions).toEqual([
      { fieldId: 'market', symbol: '=', value: 'wholesale' }
    ]);
    expect(validateProductSchemaModel(model).some((issue) => issue.rule === 'minLengthRule')).toBe(false);

    title.values[0] = { text: 'a中', attributes: {}, metadata: {} };
    expect(validateProductSchemaModel(model).some((issue) => issue.rule === 'minLengthRule')).toBe(true);
  });

  it('inherits parent regular expressions and supports official complex value layouts', () => {
    const xml = `<itemSchema><fields>
      <field id="sku" name="SKU" type="multiComplex">
        <rules><rule name="regxRule" value="^[A-Z0-9-]+$"/></rules>
        <complex-values><field id="skuId" name="SKU ID" type="input"><value>valid lower</value></field></complex-values>
        <complex-values><field id="skuId" name="SKU ID" type="input"><value>SKU-2</value></field></complex-values>
      </field>
    </fields></itemSchema>`;
    const model = parseProductSchemaXml(xml);
    expect(at(model.fields, 0).instances).toHaveLength(2);
    const issues = validateProductSchemaModel(model);
    expect(issues.filter((issue) => issue.rule === 'regxRule')).toHaveLength(1);
    const roundTrip = parseProductSchemaXml(serializeProductSchemaXml(model));
    expect(at(roundTrip.fields, 0).instances).toHaveLength(2);
    expect(productSchemaFieldText(at(at(at(roundTrip.fields, 0).instances, 1).fields, 0))).toBe('SKU-2');
  });
});
