import { uiI18n, useUiI18n } from './index';
import { productPosting as zh } from './messages/zh-CN/productPosting';
import { productPosting as en } from './messages/en-US/productPosting';

uiI18n.global.mergeLocaleMessage('zh-CN', { productPosting: zh });
uiI18n.global.mergeLocaleMessage('en-US', { productPosting: en });
export function useProductPostingI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh) => t(`productPosting.${key}`);
}
