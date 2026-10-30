import type { ProductPriceDraft } from '../../packages/core/src/product-maintenance-api';
import type { ProductOperationContext } from '../../packages/core/src/product-operation-context';

/** Parent-attested creation of one new unbranded formal test product; never a source or draft. */
export interface ProductPriceCreationProof {
  schemaVersion: 1;
  purpose: 'product-price-maintenance-test';
  context: ProductOperationContext;
  createdTimeUtc: number;
  product: { id: string; creationReceiptId: string; unbranded: true };
}

/** Explicit, isolated price-only scope. Inventory and draft deletion are not implicitly skipped. */
export interface ProductPricePlan {
  schemaVersion: 1;
  price: ProductPriceDraft;
}
