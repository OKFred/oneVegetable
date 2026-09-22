import type { ProductMutationJob } from '@one-vegetable/core';
import { hasUiTranslation, translateUi } from '../i18n';

/** Localize project reason codes; preserve unknown platform messages verbatim. */
export function productMutationMessage(job: ProductMutationJob): string {
  if (job.reasonCode) {
    const reasonKey = `products.view.mutationReason.${job.reasonCode}`;
    if (hasUiTranslation(reasonKey)) {
      const display = job.targetDisplay ?? job.originalDisplay;
      return translateUi(reasonKey, {
        productId: job.productId,
        display: display
          ? translateUi(
              display === 'online' ? 'products.view.feedback.online' : 'products.view.feedback.offline'
            )
          : ''
      });
    }
    const errorKey = `errors.codes.${job.reasonCode}`;
    if (hasUiTranslation(errorKey)) return translateUi(errorKey);
  }
  return job.message ?? translateUi('products.view.page.awaitingCheck');
}
