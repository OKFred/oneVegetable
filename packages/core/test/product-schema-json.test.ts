// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  productSchemaJsonToXml,
  productSchemaXmlToJson,
  resolveProductSchemaXml
} from '../src/product-schema-json';

describe('product Schema XML and JSON conversion', () => {
  it('preserves element order, repeated values, attributes, rich content, comments, and CDATA', () => {
    const xml =
      '<itemSchema version="trade.1.1"><!--keep--><field id="keywords" type="multiInput"><values><value inputValue="one">RAM &amp; memory</value><value inputValue="two"><![CDATA[SSD <fast>]]></value></values></field><field id="superText" type="input"><value><p data-kind="detail">Product <strong>details</strong></p></value></field></itemSchema>';

    const schemaJson = productSchemaXmlToJson(xml);
    const restoredXml = productSchemaJsonToXml(schemaJson);

    expect(productSchemaXmlToJson(restoredXml)).toEqual(schemaJson);
    expect(restoredXml.indexOf('inputValue="one"')).toBeLessThan(restoredXml.indexOf('inputValue="two"'));
    expect(restoredXml).toContain('<![CDATA[SSD <fast>]]>');
    expect(restoredXml).toContain('<p data-kind="detail">Product <strong>details</strong></p>');
  });

  it('resolves XML first and falls back to nested or stringified Schema JSON', () => {
    const firstXml =
      '<itemSchema><field id="first" type="input"><value>XML wins</value></field></itemSchema>';
    const fallbackXml =
      '<itemSchema><field id="fallback" type="input"><value>JSON fallback</value></field></itemSchema>';
    const schemaJson = productSchemaXmlToJson(fallbackXml);

    expect(resolveProductSchemaXml({ schemaXml: firstXml, schemaJson })).toBe(firstXml);
    expect(resolveProductSchemaXml({ result: { schemaJson } })).toContain('JSON fallback');
    expect(resolveProductSchemaXml({ schema_json: JSON.stringify(schemaJson) })).toContain('JSON fallback');
  });

  it('rejects unsafe XML and malformed Schema JSON instead of producing partial XML', () => {
    expect(() =>
      productSchemaXmlToJson('<!DOCTYPE itemSchema [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><itemSchema/>')
    ).toThrow('DOCTYPE');
    expect(() =>
      productSchemaJsonToXml({
        format: 'one-vegetable-product-schema',
        schemaVersion: 1,
        root: { type: 'element', name: 'bad name', attributes: {}, children: [] }
      })
    ).toThrow('元素名称无效');
  });
});
