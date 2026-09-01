import type { Product } from '@one-vegetable/core';

const PRODUCT_STATUS_LABELS = {
  online: '在线',
  offline: '已下架',
  draft: '草稿',
  auditing: '审核中',
  rejected: '已驳回'
} satisfies Record<Product['status'], string>;

export function productStatusLabel(status: Product['status']): string {
  return PRODUCT_STATUS_LABELS[status];
}
