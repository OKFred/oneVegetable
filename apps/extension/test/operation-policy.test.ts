import { describe, expect, it } from 'vitest';

import { resolveExtensionOperationAvailability } from '../lib/operation-policy';

describe('extension operation policy', () => {
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
