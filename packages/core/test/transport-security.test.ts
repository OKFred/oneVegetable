import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  assertAlibabaBusinessParameters,
  capabilityRequiresSession,
  hasAlibabaTransportParameters
} from '../src/transport-security';
import { CAPABILITY_AUTH_NONE_METHODS } from '../src/generated/capability-auth';

describe('lightweight transport security', () => {
  it('keeps the signing runtime graph free of capability registries, schemas and validators', () => {
    const root = new URL('../src/', import.meta.url);
    const visited = new Set<string>();
    const visit = (url: URL) => {
      const name = url.href.slice(root.href.length);
      if (visited.has(name)) return;
      visited.add(name);
      const source = readFileSync(url, 'utf8');
      expect(source, name).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
      const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
      for (const statement of parsed.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
        )
          continue;
        if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        const specifier = statement.moduleSpecifier;
        if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
        visit(new URL(`${specifier.text}.ts`, url));
      }
    };
    visit(new URL('signing.ts', root));
    expect([...visited].sort()).toEqual([
      'errors.ts',
      'generated/capability-auth.ts',
      'signing.ts',
      'transport-security.ts'
    ]);
  });

  it('requires session by default and only omits it for generated auth:none methods', () => {
    for (const method of ['', 'unknown.method', '__proto__', 'constructor', 'alibaba.icbu.product.list']) {
      expect(capabilityRequiresSession(method), method).toBe(true);
    }
    expect(CAPABILITY_AUTH_NONE_METHODS.length).toBeGreaterThan(0);
    for (const method of CAPABILITY_AUTH_NONE_METHODS) {
      expect(capabilityRequiresSession(method), method).toBe(false);
    }
  });

  it('protects only root transport parameters, preserving nested translation format', () => {
    const parameters = { icbu_translate_task_dto: [{ format: 'text', source_text: 'hello' }] };
    expect(hasAlibabaTransportParameters(parameters)).toBe(false);
    expect(() => {
      assertAlibabaBusinessParameters(parameters);
    }).not.toThrow();
    expect(() => {
      assertAlibabaBusinessParameters({ ...parameters, format: 'xml' });
    }).toThrow();
    expect(hasAlibabaTransportParameters(Object.create({ format: 'xml' }) as object)).toBe(false);
  });
});
