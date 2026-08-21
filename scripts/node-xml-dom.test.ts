import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectProductSchemaSerialization,
  markProductSchemaFieldTouched,
  parseProductSchemaXml,
  withProductSchemaFieldText
} from '../packages/core/src/index';
import { installNodeXmlDomGlobals } from './node-xml-dom';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe('Node XML DOM adapter', () => {
  it('supports the product Schema parse, patch and lossless round trip path', () => {
    restore = installNodeXmlDomGlobals();
    const model = parseProductSchemaXml(
      '<itemSchema><field id="subject" name="Title" type="input"><value>Before</value></field></itemSchema>'
    );
    const field = model.fields[0];
    if (!field) throw new Error('Fixture field is missing');
    const changed = markProductSchemaFieldTouched(
      { ...model, fields: [withProductSchemaFieldText(field, 'After')] },
      field.key
    );

    const inspection = inspectProductSchemaSerialization(changed);

    expect(inspection.safe).toBe(true);
    expect(inspection.xml).toContain('<value>After</value>');
    expect(parseProductSchemaXml(inspection.xml).fields[0]?.values[0]?.text).toBe('After');
  });
});
