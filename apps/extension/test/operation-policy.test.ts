import { describe, expect, it } from 'vitest';

import { resolveExtensionOperationAvailability } from '../lib/operation-policy';

describe('extension operation policy', () => {
  it('distinguishes disabled real mutations, qualification gates and supported local writes', () => {
    expect(resolveExtensionOperationAvailability('publishProduct')).toMatchObject({
      allowed: false,
      reasonCode: 'REAL_MUTATION_DISABLED'
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
  });
});
