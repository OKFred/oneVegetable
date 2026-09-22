import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { resolveExtensionOperationAvailability } from '../lib/operation-policy';
import { resolveExtensionStaticOperationAvailability } from '../lib/operation-availability';
import { OPERATION_IDS } from '../../../packages/core/src/operation-id';

describe('extension operation policy', () => {
  it('keeps options startup on the static availability boundary rather than the core registry barrel', () => {
    const runtimeImports = (path: string) => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      return ts
        .createSourceFile(path, source, ts.ScriptTarget.Latest, true)
        .statements.flatMap((statement) => {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
          if (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
          return [statement.moduleSpecifier.text];
        });
    };
    const optionsImports = runtimeImports('../entrypoints/options/main.ts');
    expect(optionsImports).toContain('../../lib/operation-availability');
    expect(optionsImports).not.toContain('../../lib/operation-policy');
    expect(optionsImports).not.toContain('@one-vegetable/core');
    expect(runtimeImports('../lib/operation-availability.ts')).toEqual(['@one-vegetable/core/runtime']);
  });
  it('keeps options availability identical for every operation ID without importing target authorization', () => {
    for (const operation of OPERATION_IDS) {
      expect(resolveExtensionStaticOperationAvailability(operation), operation).toEqual(
        resolveExtensionOperationAvailability(operation)
      );
    }
  });
  it('keeps video writes closed while allowing readback', () => {
    expect(resolveExtensionOperationAvailability('associateProductVideo')).toMatchObject({
      allowed: false,
      reasonCode: 'REAL_MUTATION_DISABLED'
    });
    expect(resolveExtensionOperationAvailability('verifyProductVideoAssociation').allowed).toBe(true);
  });
  it.each([
    'getProductShowcase',
    'addShowcaseProducts',
    'removeShowcaseProducts',
    'sortShowcaseProduct',
    'replaceShowcaseProduct'
  ] as const)('allows dedicated showcase operation %s', (operation) => {
    expect(resolveExtensionOperationAvailability(operation).allowed).toBe(true);
  });
  it('distinguishes disabled real mutations, qualification gates and supported local writes', () => {
    expect(resolveExtensionOperationAvailability('publishProduct')).toMatchObject({
      allowed: true,
      reasonCode: 'EXTENSION_OPERATION_ALLOWED'
    });
    expect(resolveExtensionOperationAvailability('saveProductDraft')).toMatchObject({
      allowed: true,
      reasonCode: 'EXTENSION_OPERATION_ALLOWED'
    });
    expect(resolveExtensionOperationAvailability('updateProduct')).toMatchObject({
      allowed: true,
      reasonCode: 'EXTENSION_OPERATION_ALLOWED'
    });
    expect(resolveExtensionOperationAvailability('calculateLogisticsQuote')).toMatchObject({
      allowed: false,
      reasonCode: 'LOGISTICS_QUALIFICATION_REQUIRED'
    });
    expect(resolveExtensionOperationAvailability('uploadPhoto')).toMatchObject({
      allowed: true,
      reasonCode: 'EXTENSION_OPERATION_ALLOWED'
    });
    expect(resolveExtensionOperationAvailability('updateProductDisplay')).toMatchObject({
      allowed: true,
      reasonCode: 'EXTENSION_OPERATION_ALLOWED'
    });
    expect(resolveExtensionOperationAvailability('createProductGroup')).toMatchObject({
      allowed: true,
      reasonCode: 'EXTENSION_OPERATION_ALLOWED'
    });
  });
});
