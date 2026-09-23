import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { validationEqual } from '../../packages/core/src/validation-equal';
import {
  compactExtensionValidatorErrors as compact,
  compactExtensionValidatorStrings as poolStrings,
  extensionValidatorCompactionPlugin
} from './extension-validator-compaction';

const error =
  '{instancePath:"/item",schemaPath:"#/type",keyword:"type",params:{type:"string"},message:"must be string"}';
const repeated = `const errors=[${Array.from({ length: 5 }, () => error).join(',')}];`;

function evaluate(source: string): unknown {
  return runInNewContext(source, {}, { timeout: 1000 });
}

function errorBlock(value = error): string {
  return `{const err=${value};if(vErrors === null){vErrors=[err];}else{vErrors.push(err);}errors++;}`;
}

function errorFunction(block = errorBlock(), setup = ''): string {
  return `function validate(){let vErrors=null;let errors=0;${setup}
    ${Array.from({ length: 5 }, () => block).join('')}
    return {vErrors,errors};}`;
}

function exampleVariants(value: unknown): unknown[] {
  const variants: unknown[] = [value];
  if (!value || typeof value !== 'object') return variants;
  const queue: { value: object; path: string[] }[] = [{ value, path: [] }];
  // Corrupt one field at a time so valid envelopes still reach deep referenced schemas.
  for (const current of queue) {
    for (const [key, child] of Object.entries(current.value) as [string, unknown][]) {
      for (const replacement of [undefined, null, false, -1.5, '', [], {}, { unexpected: true }]) {
        const changed = structuredClone(value) as Record<string, unknown>;
        let target = changed;
        for (const part of current.path) target = target[part] as Record<string, unknown>;
        if (replacement === undefined) Reflect.deleteProperty(target, key);
        else target[key] = replacement;
        variants.push(changed);
      }
      if (child && typeof child === 'object' && current.path.length < 6) {
        queue.push({ value: child, path: [...current.path, key] });
      }
      if (variants.length >= 161) return variants;
    }
  }
  return variants;
}

describe('extension-only standalone validator compaction', () => {
  it('preserves error contents, key order and independent mutable objects', () => {
    const source = `${repeated}
      const independent=errors[0]!==errors[1] && errors[0].params!==errors[1].params;
      errors[0].params.type='changed';
      JSON.stringify({errors,independent,keys:Object.keys(errors[0])});`;
    expect(evaluate(compact(source))).toBe(evaluate(source));
    expect(compact(source)).toContain('__extensionAjvError(');
    expect(compact(source)).not.toMatch(/\beval\(|new Function|\brequire\(/u);
  });

  it('preserves expression evaluation order and comma expressions', () => {
    const source = `const seen=[];const value=(key)=>(seen.push(key),key);
      const errors=[${Array.from(
        { length: 5 },
        () =>
          '{instancePath:(value("first"),value("path")),schemaPath:value("schema"),keyword:value("keyword"),params:value("params"),message:value("message")}'
      ).join(',')}];JSON.stringify({seen,errors});`;
    expect(evaluate(compact(source))).toBe(evaluate(source));
  });

  it('compacts shorthand root paths without changing error keys or property order', () => {
    const source = `const instancePath='';${repeated.replaceAll('instancePath:"/item"', 'instancePath')}
      JSON.stringify(errors);`;
    expect(compact(source)).toContain('__extensionAjvError((instancePath),');
    expect(evaluate(compact(source))).toBe(evaluate(source));
    expect(compact(compact(source))).toBe(compact(source));
  });

  it('shares append scaffolding while retaining array identity, fresh objects and counters', () => {
    const source = `${errorFunction()}
      const first=validate(),second=validate();
      const independent=first.vErrors!==second.vErrors && first.vErrors[0]!==first.vErrors[1]
        && first.vErrors[0].params!==first.vErrors[1].params
        && first.vErrors[0]!==second.vErrors[0];
      first.vErrors[0].params.type='changed';
      JSON.stringify({first,second,independent});`;
    const output = compact(source);
    expect(output).toContain('vErrors=__extensionAjvAppendError(');
    expect(output).not.toContain('function __extensionAjvError(');
    expect(output).not.toMatch(/\beval\(|new Function|\brequire\(/u);
    expect(evaluate(output)).toBe(evaluate(source));
    expect(compact(output)).toBe(output);

    const nonNull = `${errorFunction(errorBlock(), 'const initial=[];vErrors=initial;').replace(
      'return {vErrors,errors}',
      'return {vErrors,errors,same:initial===vErrors}'
    )}
      JSON.stringify(validate());`;
    expect(evaluate(compact(nonNull))).toBe(evaluate(nonNull));
    expect(evaluate(compact(nonNull))).toContain('"same":true');
  });

  it('evaluates fields before reading the error array and ignores the push return value', () => {
    const value =
      '{instancePath:(seen.push("path"),"/"),schemaPath:(seen.push("schema"),"#"),' +
      'keyword:(seen.push("keyword"),"type"),params:(seen.push("params"),{type:"string"}),' +
      'message:(seen.push("message"),vErrors=next,"must be string")}';
    const source = `const seen=[];const next=[];
      next.push=function(value){seen.push("push");this[this.length]=value;return -100;};
      ${errorFunction(errorBlock(value))}JSON.stringify({result:validate(),seen});`;
    expect(compact(source)).toContain('vErrors=__extensionAjvAppendError(');
    expect(evaluate(compact(source))).toBe(evaluate(source));
  });

  it('retains counter rollback, array truncation, nested merges and custom error params', () => {
    const block = errorBlock(
      '{instancePath:"/items/0",schemaPath:"#/anyOf",keyword:"errorMessage",' +
        'params:{errors:vErrors === null ? [] : vErrors.slice()},message:"custom message"}'
    );
    const source = `function validate(){let vErrors=null;let errors=0;
      ${errorBlock()}const initial=vErrors;const previousErrors=errors;
      ${Array.from({ length: 5 }, () => block).join('')}
      const failed=vErrors.slice();errors=previousErrors;vErrors.length=previousErrors;
      const same=initial===vErrors;vErrors=vErrors.concat(failed);errors=vErrors.length;
      ${block}return {vErrors,errors,same};}JSON.stringify(validate());`;
    expect(compact(source)).toContain('vErrors=__extensionAjvAppendError(');
    expect(evaluate(compact(source))).toBe(evaluate(source));
  });

  it('only fuses canonical blocks with an unshadowed mutable local array', () => {
    const original = errorFunction();
    for (const source of [
      original.replace('let vErrors=null', 'const vErrors=[]'),
      original.replace('let vErrors=null;', ''),
      original.replace('let vErrors=null;', 'let vErrors=null;{const vErrors=[];}'),
      original.replace('let vErrors=null;', 'let vErrors=null;try{}catch(vErrors){}'),
      original.replace('let vErrors=null;', 'let vErrors=null;for(const {vErrors} of []){}'),
      original.replace('let vErrors=null;', 'let vErrors=null;function nested(vErrors){}'),
      errorFunction(errorBlock().replace('vErrors === null', 'vErrors == null')),
      errorFunction(errorBlock().replace('vErrors.push(err)', 'vErrors.unshift(err)')),
      errorFunction(errorBlock().replace('vErrors.push(err)', 'vErrors?.push(err)')),
      errorFunction(errorBlock().replace('vErrors.push(err)', 'vErrors.push(...err)')),
      errorFunction(errorBlock().replace('errors++;', 'errors+=1;')),
      errorFunction(errorBlock().replace('errors++;', 'errors++;observe(err);')),
      errorFunction(errorBlock().replace('params:{type:"string"}', 'params:{get self(){return err;}}')),
      errorFunction(errorBlock().replace('const err=', 'let err='))
    ]) {
      expect(compact(source), source).not.toContain('__extensionAjvAppendError');
    }
    const captured = `${errorFunction(
      errorBlock().replace('params:{type:"string"}', 'params:{get self(){return err.instancePath;}}')
    )}JSON.stringify(validate());`;
    expect(evaluate(compact(captured))).toBe(evaluate(captured));
  });

  it('keeps append helper names collision-free and mixed helper output idempotent', () => {
    const source = `"use strict";const __extensionAjvAppendError='occupied';
      ${repeated}${errorFunction()}JSON.stringify(validate());`;
    const output = compact(source);
    expect(output.startsWith('"use strict";')).toBe(true);
    expect(output).toContain('function __extensionAjvAppendError_(');
    expect(output).toContain('function __extensionAjvError(');
    expect(evaluate(output)).toBe(evaluate(source));
    expect(compact(output)).toBe(output);
  });

  it('keeps directives, avoids name collisions and is idempotent', () => {
    const source = `"use strict";const __extensionAjvError="occupied";${repeated}`;
    const output = compact(source);
    expect(output.startsWith('"use strict";')).toBe(true);
    expect(output).toContain('function __extensionAjvError_(');
    expect(compact(output)).toBe(output);
  });

  it('leaves small modules and unfamiliar error shapes unchanged', () => {
    expect(compact(`const error=${error};`)).toBe(`const error=${error};`);
    for (const other of [
      '{instancePath,schemaPath,keyword,params,message}',
      '{...base,instancePath:"/",schemaPath:"#",keyword:"x",params:{},message:"x"}',
      '{instancePath:"/",schemaPath:"#",keyword:"x",params:{},message:"x",extra:true}',
      '{schemaPath:"#",instancePath:"/",keyword:"x",params:{},message:"x"}'
    ]) {
      const source = `const errors=[${Array.from({ length: 5 }, () => other).join(',')}];`;
      expect(compact(source)).toBe(source);
    }
  });

  it('only transforms generated validators inside the extension build', () => {
    const plugin = extensionValidatorCompactionPlugin();
    expect(plugin.apply).toBe('build');
    expect(
      plugin.transform(repeated, 'D:\\repo\\packages\\core\\src\\generated\\validators-core.ts')
    ).not.toBeNull();
    for (const id of ['/repo/packages/core/src/video.ts', '/repo/other/generated/validators-core.ts']) {
      expect(plugin.transform(repeated, id)).toBeNull();
    }
  });

  it('pools profitable strings while preserving directives, evaluation and fresh objects', () => {
    const value = '#/properties/a-long-property-name/additionalProperties';
    const literal = JSON.stringify(value);
    const source = `// @ts-nocheck\n"use strict";const __extensionAjvStrings0="occupied";
      const calls=[];const read=(value)=>(calls.push(value),value);
      function result(){return [${Array.from({ length: 4 }, () => `{value:read(${literal})}`).join(',')}]}
      const first=result(),second=result();first[0].value="changed";
      JSON.stringify({calls,first,second,same:first[0]===second[0]});`;
    const output = poolStrings(source);
    expect(output.startsWith('// @ts-nocheck\n"use strict";')).toBe(true);
    expect(output).toContain('const __extensionAjvStrings_0=');
    expect(output.split(literal)).toHaveLength(2);
    expect(evaluate(output)).toBe(evaluate(source));
    expect(poolStrings(output)).toBe(output);
  });

  it('uses a net saving threshold instead of pooling every duplicate', () => {
    for (const source of [
      'const values=["short","short","short","short"];',
      'const values=["string","string"];',
      'const values=["this long value is unique and must stay inline"];'
    ])
      expect(poolStrings(source)).toBe(source);
    const value = 'A sufficiently long repeated string may profit even with only two uses';
    const source = `const values=[${JSON.stringify(value)},${JSON.stringify(value)}];JSON.stringify(values);`;
    expect(poolStrings(source)).toContain('const __extensionAjvStrings0=');
    expect(evaluate(poolStrings(source))).toBe(evaluate(source));
    const frequent = `const values=[${Array.from({ length: 20 }, () => '"string"').join(',')}];JSON.stringify(values);`;
    expect(poolStrings(frequent)).toContain('const __extensionAjvStrings0=');
    expect(evaluate(poolStrings(frequent))).toBe(evaluate(frequent));
  });

  it('pools small but profitable constants without changing values or idempotence', () => {
    const source = 'JSON.stringify(["abcdefgh","abcdefgh","abcdefgh","abcdefgh","abcdefgh"]);';
    const result = poolStrings(source);
    expect(result).toContain('const __extensionAjvStrings0=');
    expect(evaluate(result)).toBe(evaluate(source));
    expect(poolStrings(result)).toBe(result);
  });

  it('keeps exact unicode, escaped characters and plain template values', () => {
    for (const value of [
      '字段/请求/校验路径/字段/请求/校验路径',
      '#/properties/escaped-"quote"-\\-line\n\r\t-😀-\ud800',
      '#/properties/literal-${notAnExpression}/type'
    ]) {
      const source = `const values=[${Array.from({ length: 4 }, () => JSON.stringify(value)).join(',')}];JSON.stringify(values);`;
      expect(poolStrings(source)).toContain('__extensionAjvStrings');
      expect(evaluate(poolStrings(source))).toBe(evaluate(source));
    }
    const source =
      'const values=[`long ordinary template string`,`long ordinary template string`,`long ordinary template string`,`long ordinary template string`];JSON.stringify(values);';
    expect(evaluate(poolStrings(source))).toBe(evaluate(source));
  });

  it('never rewrites module syntax, property names, directives, types or tagged templates', () => {
    const literal = JSON.stringify('a-very-long-literal-that-is-shared-by-many-syntax-kinds');
    const prefix = `// @ts-nocheck\n"use strict";import value from ${literal};`;
    const excluded = [
      `export {value} from ${literal};`,
      `type Value=${literal};`,
      `const load=()=>import(${literal});`,
      `const legacy=()=>require(${literal});`,
      `const object={${literal}:1,${literal}(){},get ${literal}(){return 1},set ${literal}(value){}};`,
      `class Example{${literal}=1;}`,
      `const {${literal}: bound}=object;`,
      `tag\`a-very-long-literal-that-is-shared-by-many-syntax-kinds\`;`
    ];
    const source = `${prefix}\n${excluded.join('\n')}\nexport const values=[${Array.from({ length: 4 }, () => literal).join(',')}];`;
    const output = poolStrings(source);
    expect(output.startsWith(prefix)).toBe(true);
    for (const original of excluded) expect(output).toContain(original);
    expect(output).toContain('const __extensionAjvStrings0=');
    expect(poolStrings(output)).toBe(output);
  });

  describe('generated validator parity', () => {
    type Validator = ((value: unknown) => boolean) & { errors?: unknown; evaluated?: unknown };
    function load(source: string): Record<string, Validator> {
      const exports: Record<string, Validator> = {};
      const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
      }).outputText;
      runInNewContext(code, {
        exports,
        require: (specifier: string) => {
          if (specifier !== '../validation-equal') throw new Error(`Unexpected import: ${specifier}`);
          return { validationEqual };
        }
      });
      return exports;
    }
    const document = JSON.parse(
      readFileSync(new URL('../../openapi/one-vegetable.json', import.meta.url), 'utf8')
    ) as Record<string, unknown>;
    const examples = new Map<string, unknown>([
      ['validateSchemaPublishRequest', { categoryId: 1, language: 'en_US', schemaXml: '' }],
      ['validateProductSchemaRequest', { categoryId: 1, language: 'en_US', market: 'icbu' }]
    ]);
    for (const domain of [
      'product',
      'rfq',
      'trade',
      'logistics',
      'insights',
      'photo',
      'platform',
      'free-api'
    ]) {
      const capabilities = document[`x-${domain}-capabilities`] as Record<
        string,
        { requestExample: unknown; responseExample: unknown }
      >;
      const prefix = domain === 'free-api' ? 'FreeApi' : `${domain[0]?.toUpperCase()}${domain.slice(1)}`;
      for (const [index, definition] of Object.values(capabilities).entries()) {
        examples.set(`validate${prefix}Capability${index}Request`, definition.requestExample);
        examples.set(`validate${prefix}Capability${index}Response`, definition.responseExample);
      }
    }
    const counts = { files: 0, validators: 0, cases: 0, valid: 0, invalid: 0, examples: 0 };
    const directory = new URL('../../packages/core/src/generated/', import.meta.url);
    const files = readdirSync(directory).filter((name) => /^validators-.*\.ts$/u.test(name));

    afterAll(() => {
      expect(counts.files).toBe(files.length);
      expect(counts.examples).toBe(examples.size);
      expect(counts.valid).toBeGreaterThan(100);
      expect(counts.invalid).toBeGreaterThan(100);
      console.info('Validator compaction parity:', counts);
    });

    // Keep the full comparison for every module, but give each domain its own timeout.
    // A monolithic synchronous test can exceed 30 seconds under whole-suite CPU contention.
    it.each(files)(
      'preserves full errors, aliases and input/evaluated state: %s',
      (file) => {
        counts.files++;
        const source = readFileSync(new URL(file, directory), 'utf8');
        const before = load(source);
        const code = compact(source);
        const after = load(code);
        expect(compact(code), file).toBe(code);
        expect(code, file).not.toMatch(/\beval\(|new Function|\brequire\(/u);
        expect(Object.keys(after), file).toEqual(Object.keys(before));
        const aliases = new Map<Validator, string>();
        for (const [name, original] of Object.entries(before)) {
          counts.validators++;
          const optimized = after[name];
          if (!optimized) throw new Error(`Missing validator: ${name}`);
          const canonical = aliases.get(original);
          if (canonical) expect(optimized, `${file}:${name} alias`).toBe(after[canonical]);
          else aliases.set(original, name);
          const inputs: unknown[] = [
            undefined,
            null,
            false,
            0,
            -1,
            1,
            1.5,
            NaN,
            Infinity,
            '',
            '1',
            '😀',
            [],
            [1],
            {},
            { unexpected: true }
          ];
          if (examples.has(name)) {
            counts.examples++;
            inputs.push(...exampleVariants(examples.get(name)));
          }
          for (const [index, value] of inputs.entries()) {
            counts.cases++;
            const inputBefore = structuredClone(value);
            const inputAfter = structuredClone(value);
            const expected = original(inputBefore);
            if (expected) counts.valid++;
            else counts.invalid++;
            const label = `${file}:${name}:${index}`;
            expect(optimized(inputAfter), label).toBe(expected);
            expect(JSON.stringify(optimized.errors), label).toBe(JSON.stringify(original.errors));
            expect(JSON.stringify(optimized.evaluated), label).toBe(JSON.stringify(original.evaluated));
            expect(inputAfter, label).toEqual(inputBefore);
          }
        }
      },
      30_000
    );
  });
});
