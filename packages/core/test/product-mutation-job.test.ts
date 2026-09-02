import { describe, expect, it } from 'vitest';

import {
  isProductMutationJob,
  productMutationJobHasResolvedProductId,
  type ProductMutationJob,
  type ProductMutationJobOperation
} from '../src';

describe('product mutation jobs', () => {
  it.each<ProductMutationJobOperation>([
    'publishProduct',
    'saveProductDraft',
    'updateProduct',
    'updateProductDisplay'
  ])('accepts the %s operation', (operation) => {
    expect(isProductMutationJob(job(operation))).toBe(true);
  });

  it('distinguishes a persisted pre-submit target from an Alibaba product id', () => {
    expect(productMutationJobHasResolvedProductId(job('publishProduct'))).toBe(true);
    expect(
      productMutationJobHasResolvedProductId({
        ...job('publishProduct'),
        productId: `pending:${'a'.repeat(64)}`
      })
    ).toBe(false);
  });
});

function job(operation: ProductMutationJobOperation): ProductMutationJob {
  return {
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    productId: '1600000000001',
    operation,
    status: 'submitted',
    categoryId: operation === 'updateProductDisplay' ? null : 100,
    language: operation === 'updateProductDisplay' ? null : 'en_US',
    payloadFingerprint: 'a'.repeat(64),
    fieldExpectations: [],
    encryptedProductId: operation === 'updateProductDisplay' ? 'encrypted' : null,
    targetDisplay: operation === 'updateProductDisplay' ? 'offline' : null,
    originalDisplay: operation === 'updateProductDisplay' ? 'online' : null,
    traceId: null,
    reasonCode: null,
    message: null,
    submittedTimeUtc: 1,
    lastCheckedTimeUtc: null,
    completedTimeUtc: null,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    creatorId: 'test',
    updaterId: 'test',
    revision: 1,
    remark: null
  };
}
