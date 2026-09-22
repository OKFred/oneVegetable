import type { Product } from '@one-vegetable/core';
import { platformDateFilter, validFilterRange } from '../lib/list-filters';

export interface ProductListFilters {
  productId: string;
  categoryId: string;
  groupId: string;
  groupLevel: '1' | '2' | '3';
  modifiedFrom: string;
  modifiedTo: string;
  status: string;
}
export function emptyProductListFilters(): ProductListFilters {
  return {
    productId: '',
    categoryId: '',
    groupId: '',
    groupLevel: '1',
    modifiedFrom: '',
    modifiedTo: '',
    status: ''
  };
}
export function productFilterCount(filters: ProductListFilters): number {
  return [
    filters.productId,
    filters.categoryId,
    filters.groupId,
    filters.modifiedFrom || filters.modifiedTo,
    filters.status
  ].filter(Boolean).length;
}
export function invalidProductFilters(filters: ProductListFilters): boolean {
  return (
    [filters.productId, filters.categoryId, filters.groupId].some(
      (id) => id !== '' && (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))
    ) || !validFilterRange(filters.modifiedFrom, filters.modifiedTo)
  );
}
export function productFilterPayload(filters: ProductListFilters) {
  return {
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.categoryId ? { categoryId: Number(filters.categoryId) } : {}),
    ...(filters.groupId
      ? { groupId: Number(filters.groupId), groupLevel: Number(filters.groupLevel) as 1 | 2 | 3 }
      : {}),
    ...(filters.modifiedFrom ? { modifiedDateStart: platformDateFilter(filters.modifiedFrom) } : {}),
    ...(filters.modifiedTo ? { modifiedDateEnd: platformDateFilter(filters.modifiedTo, true) } : {})
  };
}
export function filterCurrentPageProducts(products: Product[], filters: ProductListFilters): Product[] {
  return filters.status ? products.filter((product) => product.status === filters.status) : products;
}
