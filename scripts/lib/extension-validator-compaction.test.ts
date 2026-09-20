import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { validationEqual } from '../../packages/core/src/validation-equal';
import {
  compactExtensionValidatorErrors as compact,
  extensionValidatorCompactionPlugin
} from './extension-validator-compaction';

const error =
  '{instancePath:"/item",schemaPath:"#/type",keyword:"type",params:{type:"string"},message:"must be string"}';
const repeated = `const errors=[${Array.from({ length: 5 }, () => error).join(',')}];`;

function evaluate(source: string): unknown {
  return runInNewContext(source, {}, { timeout: 1000 });
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

  it('preserves all generated validators and their full error arrays on representative inputs', () => {
    type Validator = ((value: unknown) => boolean) & { errors?: unknown };
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
    const directory = new URL('../../packages/core/src/generated/', import.meta.url);
    for (const file of readdirSync(directory).filter((name) => /^validators-.*\.ts$/u.test(name))) {
      const source = readFileSync(new URL(file, directory), 'utf8');
      const before = load(source);
      const after = load(compact(source));
      expect(Object.keys(after), file).toEqual(Object.keys(before));
      for (const [name, original] of Object.entries(before)) {
        const optimized = after[name];
        if (!optimized) throw new Error(`Missing validator: ${name}`);
        for (const value of [undefined, null, false, 0, 1, '', '1', [], [1], {}, { unexpected: true }]) {
          expect(optimized(structuredClone(value)), `${file}:${name}`).toBe(original(structuredClone(value)));
          expect(JSON.stringify(optimized.errors), `${file}:${name}`).toBe(JSON.stringify(original.errors));
        }
      }
    }
  }, 30_000);
});
