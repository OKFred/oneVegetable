import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { resolveExtensionOperationAvailability } from '../lib/operation-policy';
import {
  createExtensionOperationAvailabilityClient,
  resolveExtensionStaticOperationAvailability
} from '../lib/operation-availability';
import { iopOperationReason } from '@one-vegetable/core/alibaba-iop-business';
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
    expect(runtimeImports('../lib/operation-availability.ts')).toEqual([
      '@one-vegetable/core/runtime',
      '@one-vegetable/core/alibaba-iop-business'
    ]);
  });
  it('keeps legacy and explicit TOP decisions identical for every operation', () => {
    for (const operation of OPERATION_IDS) {
      expect(resolveExtensionStaticOperationAvailability(operation, 'top')).toEqual(
        resolveExtensionStaticOperationAvailability(operation)
      );
      expect(resolveExtensionOperationAvailability(operation, {}, 'top')).toEqual(
        resolveExtensionOperationAvailability(operation)
      );
    }
  });
  it('follows the shared IOP mapping/account verification policy, not TOP write permissions', () => {
    for (const operation of OPERATION_IDS) {
      const staticDecision = resolveExtensionStaticOperationAvailability(operation, 'iop');
      expect(staticDecision.allowed, operation).toBe(iopOperationReason(operation) === null);
      expect(resolveExtensionOperationAvailability(operation, {}, 'iop')).toEqual(staticDecision);
    }
    for (const operation of [
      'publishProduct',
      'updateProduct',
      'uploadPhoto',
      'createProductGroup'
    ] as const) {
      const reason = iopOperationReason(operation);
      expect(resolveExtensionOperationAvailability(operation, {}, 'iop').allowed).toBe(reason === null);
      if (reason) expect(resolveExtensionOperationAvailability(operation, {}, 'iop').reasonCode).toBe(reason);
    }
  });
  it.each([
    'listProductGroups',
    'listPhotoGroups',
    'getProductSchema',
    'getProductLevelSchema',
    'listProductCategories',
    'mapProductCategory',
    'getProductScore',
    'listTradeOrders',
    'getTradeOrderLogistics',
    'getTradeOrderAggregate'
  ] as const)('allows the mapped IOP read operation ID %s', (operation) => {
    expect(resolveExtensionStaticOperationAvailability(operation, 'iop').allowed).toBe(true);
  });
  it.each(['listRfqs', 'listRecommendedRfqs', 'getRfq', 'getTradeOrderFund'] as const)(
    'keeps undocumented or non-equivalent IOP read %s closed',
    (operation) => {
      expect(resolveExtensionStaticOperationAvailability(operation, 'iop')).toMatchObject({
        allowed: false,
        reasonCode: 'ALIBABA_IOP_METHOD_UNSUPPORTED'
      });
    }
  );
  it.each([
    'alibaba.icbu.product.schema.add',
    'alibaba.icbu.product.schema.add.draft',
    'alibaba.icbu.product.schema.update'
  ])('allows the verified IOP mapping %s without bypassing generic authorization', (method) => {
    expect(iopOperationReason('callCapability', method)).toBeNull();
    const decision = resolveExtensionOperationAvailability(
      'callCapability',
      { method, parameters: {} },
      'iop'
    );
    expect(decision).toEqual(
      resolveExtensionOperationAvailability('callCapability', { method, parameters: {} }, 'top')
    );
  });
  it.each(['publishProduct', 'saveProductDraft', 'updateProduct'] as const)(
    'allows verified IOP operation %s through current safe status',
    async (operation) => {
      expect(iopOperationReason(operation)).toBeNull();
      expect(resolveExtensionOperationAvailability(operation, {}, 'iop')).toMatchObject({ allowed: true });
      const client = createExtensionOperationAvailabilityClient(
        vi.fn().mockResolvedValue({ state: 'unlocked', protocol: 'iop' })
      );
      expect((await client.get([operation])).items[0]).toMatchObject({ operation, allowed: true });
    }
  );
  it.each([
    'alibaba.icbu.product.list',
    'alibaba.icbu.product.group.get',
    'alibaba.icbu.product.schema.render',
    'alibaba.icbu.product.schema.render.draft',
    'alibaba.icbu.photobank.group.list',
    'alibaba.icbu.photobank.list'
  ])('checks the targeted IOP read %s without bypassing generic authorization', (method) => {
    expect(
      resolveExtensionOperationAvailability('callCapability', { method, parameters: {} }, 'iop').allowed
    ).toBe(true);
    expect(resolveExtensionOperationAvailability('callCapability', { method }, 'iop').allowed).toBe(false);
    expect(
      resolveExtensionOperationAvailability(
        'callCapability',
        {
          method,
          parameters: { sign: 'forbidden' }
        },
        'iop'
      ).allowed
    ).toBe(false);
  });
  it.each(['alibaba.icbu.product.get', 'unknown', undefined])(
    'rejects unmapped IOP capability %s before a TOP policy could allow it',
    (method) => {
      expect(
        resolveExtensionOperationAvailability('callCapability', { method, parameters: {} }, 'iop')
      ).toMatchObject({ allowed: false, reasonCode: 'ALIBABA_IOP_METHOD_UNSUPPORTED' });
    }
  );
  it('reads current safe vault status asynchronously on each options request', async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: 'unlocked' })
      .mockResolvedValueOnce({ state: 'unlocked', protocol: 'iop' })
      .mockResolvedValueOnce({ state: 'unlocked', protocol: 'top' });
    const client = createExtensionOperationAvailabilityClient(readStatus);
    const operations = ['listProducts', 'publishProduct', 'callCapability'] as const;
    expect((await client.get(operations)).items.map((item) => item.allowed)).toEqual([true, true, false]);
    expect((await client.get(operations)).items.map((item) => item.allowed)).toEqual(
      operations.map((operation) => resolveExtensionStaticOperationAvailability(operation, 'iop').allowed)
    );
    expect((await client.get(operations)).items.map((item) => item.allowed)).toEqual([true, true, false]);
    expect(readStatus).toHaveBeenCalledTimes(3);
  });
  it.each(['locked', 'invalid', 'unknown'])('fails closed for %s safe status', async (state) => {
    const client = createExtensionOperationAvailabilityClient(vi.fn().mockResolvedValue({ state }));
    expect((await client.get(['publishProduct'])).items[0]).toMatchObject({ allowed: false });
  });
  it('fails closed when safe status is unavailable or malformed', async () => {
    for (const read of [
      vi.fn().mockRejectedValue(new Error('offline')),
      vi.fn().mockResolvedValue({ state: 'unlocked', protocol: 'invalid' })
    ]) {
      expect(
        (await createExtensionOperationAvailabilityClient(read).get(['publishProduct'])).items[0]
      ).toMatchObject({ allowed: false, reasonCode: 'OPERATION_AVAILABILITY_UNAVAILABLE' });
    }
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
