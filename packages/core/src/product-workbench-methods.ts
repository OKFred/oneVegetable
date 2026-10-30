/** Lightweight protocol identifiers, safe to import from startup and MV3 modules. */
export const PRODUCT_MAINTENANCE_METHODS = {
  setPrice: '/icbu/product/edit-price',
  setInventory: '/icbu/product/edit-inventory',
  deleteDraft: '/alibaba/icbu/draft/delete'
} as const;
export const IOP_PRODUCT_LOOKUP_METHOD = '/alibaba/icbu/product/search/v2';
export function isProductWorkbenchMethod(method: unknown): boolean {
  return (
    method === IOP_PRODUCT_LOOKUP_METHOD ||
    (typeof method === 'string' && (Object.values(PRODUCT_MAINTENANCE_METHODS) as string[]).includes(method))
  );
}
