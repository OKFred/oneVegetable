import { uiI18n, useUiI18n } from './index';
import { productLookup as zh } from './messages/zh-CN/productLookup';
import { productLookup as en } from './messages/en-US/productLookup';

uiI18n.global.mergeLocaleMessage('zh-CN', { productLookup: zh });
uiI18n.global.mergeLocaleMessage('en-US', { productLookup: en });
export function useProductLookupI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh) => t(`productLookup.${key}`);
}
