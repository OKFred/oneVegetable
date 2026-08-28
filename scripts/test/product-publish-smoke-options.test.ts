import { describe, expect, it } from 'vitest';

import { shouldCleanupPublishedProduct } from '../lib/product-publish-smoke-options';

describe('product publish smoke options', () => {
  it('keeps a successfully published product online by default', () => {
    expect(shouldCleanupPublishedProduct({})).toBe(false);
    expect(shouldCleanupPublishedProduct({ ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_CLEANUP: '0' })).toBe(false);
  });

  it('only enables cleanup through the explicit cleanup flag', () => {
    expect(shouldCleanupPublishedProduct({ ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_CLEANUP: '1' })).toBe(true);
    expect(shouldCleanupPublishedProduct({ ONE_VEGETABLE_REAL_PRODUCT_PUBLISH_KEEP_ONLINE: '0' })).toBe(
      false
    );
  });
});
