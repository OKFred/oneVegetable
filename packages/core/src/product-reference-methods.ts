/** Public native IOP methods, with no guessed TOP equivalents. */
import { IOP_PRODUCT_LOOKUP_METHOD } from './product-workbench-methods';
export const IOP_REFERENCE_METHODS = {
  predictCategory: '/alibaba/icbu/category/predict/v2',
  listCategories: '/alibaba/icbu/category/get/v2',
  getAttributes: '/alibaba/icbu/category/attribute/get/v2',
  getProduct: '/alibaba/icbu/product/get/v2',
  listShippingTemplates: '/alibaba/icbu/product/list/shipping/templates',
  searchProducts: IOP_PRODUCT_LOOKUP_METHOD,
  getProductStatus: '/alibaba/icbu/product/status/get/v2'
} as const;
const methods = new Set<string>(Object.values(IOP_REFERENCE_METHODS));
export function isProductReferenceMethod(
  value: unknown
): value is (typeof IOP_REFERENCE_METHODS)[keyof typeof IOP_REFERENCE_METHODS] {
  return typeof value === 'string' && methods.has(value);
}
