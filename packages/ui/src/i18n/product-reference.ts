import { uiI18n, useUiI18n } from './index';
import { productReference as zh } from './messages/zh-CN/productReference';
import { productReference as en } from './messages/en-US/productReference';

uiI18n.global.mergeLocaleMessage('zh-CN', { productReference: zh });
uiI18n.global.mergeLocaleMessage('en-US', { productReference: en });
export function useProductReferenceI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh) => t(`productReference.${key}`);
}
