import { describe, expect, it } from 'vitest';
import { compactStandaloneSchemaConstants as compact } from './standalone-schema-constants';

describe('standalone schema constant compaction', () => {
  it('keeps only statically read branches without changing validation statements', () => {
    const input =
      'const schema1 = {"type":"object","required":["x"],"properties":{"x":{"enum":[1,2]},"y":{"type":"string"}}}; for(const key of schema1.required){ check(data[key]); } check(schema1.properties.x.enum);';
    expect(compact(input)).toBe(
      'const schema1 = {"required":["x"],"properties":{"x":{"enum":[1,2]}}}; for(const key of schema1.required){ check(data[key]); } check(schema1.properties.x.enum);'
    );
  });
  it('preserves dynamic reads, arrays and direct root references', () => {
    for (const access of ['schema1[key]', 'check(schema1)', 'Object.keys(schema1)']) {
      const source = `const schema1 = {"type":"object","required":["x","y"]}; ${access};`;
      expect(compact(source)).toBe(source);
    }
    expect(
      compact('const schema1 = {"type":"object","required":["x","y"]}; check(schema1["required"][index]);')
    ).toContain('{"required":["x","y"]}');
  });
  it('leaves unexpected or non-JSON initializers intact', () => {
    for (const source of [
      'const schema1 = {type: "string"}; check(schema1.type);',
      'const schema1 = {"type":"object"}; check(schema1.missing);'
    ])
      expect(compact(source)).toBe(source);
  });
});
