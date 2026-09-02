import { MAX_PRODUCT_TRANSFER_ITEMS } from '@one-vegetable/core';

import { translateUi } from '../i18n';

export function retainCurrentPageSelection(
  selectedProductIds: readonly string[],
  currentPageProductIds: readonly string[]
): string[] {
  const currentIds = new Set(currentPageProductIds);
  return selectedProductIds.filter((productId) => currentIds.has(productId));
}

export function describeProductExportDisabled(selectedCount: number, busy: boolean): string {
  if (busy) return translateUi('products.selection.busy');
  if (selectedCount === 0) return translateUi('products.selection.chooseForExport');
  if (selectedCount > MAX_PRODUCT_TRANSFER_ITEMS) {
    return translateUi('products.selection.exportLimit', { maximum: MAX_PRODUCT_TRANSFER_ITEMS });
  }
  return '';
}
