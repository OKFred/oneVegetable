import { MAX_PRODUCT_TRANSFER_ITEMS } from '@one-vegetable/core';

export function retainCurrentPageSelection(
  selectedProductIds: readonly string[],
  currentPageProductIds: readonly string[]
): string[] {
  const currentIds = new Set(currentPageProductIds);
  return selectedProductIds.filter((productId) => currentIds.has(productId));
}

export function describeProductExportDisabled(selectedCount: number, busy: boolean): string {
  if (busy) return '商品传输任务正在执行';
  if (selectedCount === 0) return '请先选择要导出的商品';
  if (selectedCount > MAX_PRODUCT_TRANSFER_ITEMS) {
    return `单次最多导出 ${MAX_PRODUCT_TRANSFER_ITEMS} 个商品`;
  }
  return '';
}
