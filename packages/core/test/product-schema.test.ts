// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  cloneProductSchemaInstance,
  parseProductSchemaXml,
  serializeProductSchemaXml,
  validateProductSchemaModel
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
    at(model.fields, 0).value = '<Solar & Storage>';
    const serialized = serializeProductSchemaXml(model);
    expect(serialized).toContain('keep="yes"');
    expect(serialized).toContain('&lt;Solar &amp; Storage&gt;');
    expect(at(parseProductSchemaXml(serialized).fields, 0).value).toBe('<Solar & Storage>');
  });

  it('adds and removes multiComplex instances', () => {
    const model = parseProductSchemaXml(XML);
    const sku = at(model.fields, 5);
    const second = cloneProductSchemaInstance(sku);
    at(second, 0).value = 'SKU-2';
    sku.instances.push(second);
    let roundTrip = parseProductSchemaXml(serializeProductSchemaXml(model));
    expect(at(roundTrip.fields, 5).instances).toHaveLength(2);
    expect(at(at(at(roundTrip.fields, 5).instances, 1), 0).value).toBe('SKU-2');
    at(roundTrip.fields, 5).instances.splice(0, 1);
    roundTrip = parseProductSchemaXml(serializeProductSchemaXml(roundTrip));
    expect(at(roundTrip.fields, 5).instances).toHaveLength(1);
  });

  it('validates local rules and never executes server expressions', () => {
    const model = parseProductSchemaXml(XML);
    at(model.fields, 0).value = '';
    at(at(at(model.fields, 4).instances, 0), 0).value = '101';
    const issues = validateProductSchemaModel(model);
    expect(issues.some((issue) => issue.rule === 'requiredRule' && issue.severity === 'error')).toBe(true);
    expect(issues.some((issue) => issue.rule === 'maxValueRule' && issue.severity === 'error')).toBe(true);
    expect(issues.some((issue) => issue.rule === 'serverBizRule' && issue.severity === 'warning')).toBe(true);
  });
});
