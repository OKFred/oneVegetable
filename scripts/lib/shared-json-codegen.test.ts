import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sharedJsonSource } from './shared-json-codegen';

describe('immutable registry JSON sharing', () => {
  it('preserves all values, stable ordering and nested references without runtime code generation', () => {
    const value = { text: 'Long repeated registry metadata '.repeat(8), list: [{ amount: 1, flag: false }] };
    const input = { first: value, second: value, quote: '"\n</script>', nil: null };
    const result = sharedJsonSource(input);
    expect(result).toEqual(sharedJsonSource(input));
    const source = `${result.declarations}\nJSON.stringify(${result.expression});`;
    const javascript = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    expect(JSON.parse(runInNewContext(javascript) as string)).toEqual(input);
    expect(source.length).toBeLessThan(JSON.stringify(input).length);
    expect(source).not.toMatch(/eval|new Function/);
  });
});
