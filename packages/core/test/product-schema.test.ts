// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  cloneProductSchemaInstance,
  parseProductSchemaXml,
  productSchemaFieldText,
  serializeProductSchemaXml,
  validateProductSchemaModel,
  withProductSchemaFieldText
} from '../src/product-schema';

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
    second[0] = withProductSchemaFieldText(at(second, 0), 'SKU-2');
    sku.instances.push(second);
    let roundTrip = parseProductSchemaXml(serializeProductSchemaXml(model));
    expect(at(roundTrip.fields, 5).instances).toHaveLength(2);
    expect(productSchemaFieldText(at(at(at(roundTrip.fields, 5).instances, 1), 0))).toBe('SKU-2');
    at(roundTrip.fields, 5).instances.splice(0, 1);
    roundTrip = parseProductSchemaXml(serializeProductSchemaXml(roundTrip));
    expect(at(roundTrip.fields, 5).instances).toHaveLength(1);
  });

  it('validates local rules and never executes server expressions', () => {
    const model = parseProductSchemaXml(XML);
    model.fields[0] = withProductSchemaFieldText(at(model.fields, 0), '');
    at(model.fields, 4).instances[0] = [
      withProductSchemaFieldText(at(at(at(model.fields, 4).instances, 0), 0), '101')
    ];
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
        attributes: { fileId: 'photo-1', inputValue: 'cover', img: 'true' }
      }
    ]);

    image.values[0] = {
      text: 'https://photobank.example/updated.jpg',
      attributes: { ...at(image.values, 0).attributes }
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

    title.values[0] = { text: 'a中', attributes: {} };
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
    expect(productSchemaFieldText(at(at(at(roundTrip.fields, 0).instances, 1), 0))).toBe('SKU-2');
  });
});
