import type { Product } from '@one-vegetable/core';

import { translateUi } from '../i18n';

export function productStatusLabel(status: Product['status']): string {
  return translateUi(`products.status.${status}`);
}
