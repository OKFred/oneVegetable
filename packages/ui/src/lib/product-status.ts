import type { Product } from '@one-vegetable/core';

import { translateUi } from '../i18n';

export function productStatusLabel(status: Product['status']): string {
  return translateUi(`products.status.${status}`);
}

/** Match documented native values exactly; do not reinterpret unknown/case-drifted enums. */
export function productReferenceOnlineStateLabel(value: string | null): string {
  switch (value) {
    case 'online':
    case 'offline':
      return productStatusLabel(value);
    case 'deleted':
      return translateUi('productReference.stateDeleted');
    default:
      return value?.trim() ? value : '—';
  }
}

/** Audit approval is not the product's online/offline state. */
export function productReferenceAuditStateLabel(value: string | null): string {
  switch (value) {
    case 'approved':
      return translateUi('productReference.auditApproved');
    case 'pending':
      return translateUi('productReference.auditPending');
    case 'rejected':
      return translateUi('productReference.auditRejected');
    default:
      return value?.trim() ? value : '—';
  }
}
