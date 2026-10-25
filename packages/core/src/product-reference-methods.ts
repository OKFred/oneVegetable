/** Public native IOP methods, with no guessed TOP equivalents. */
export const IOP_REFERENCE_METHODS = {
  predictCategory: '/alibaba/icbu/category/predict/v2',
  listCategories: '/alibaba/icbu/category/get/v2',
  getAttributes: '/alibaba/icbu/category/attribute/get/v2',
  getProduct: '/alibaba/icbu/product/get/v2',
  listShippingTemplates: '/alibaba/icbu/product/list/shipping/templates'
} as const;
const methods = new Set<string>(Object.values(IOP_REFERENCE_METHODS));
export function isProductReferenceMethod(
  value: unknown
): value is (typeof IOP_REFERENCE_METHODS)[keyof typeof IOP_REFERENCE_METHODS] {
  return typeof value === 'string' && methods.has(value);
}
