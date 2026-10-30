import { uiI18n, useUiI18n } from './index';
import { productReadTools as zh } from './messages/zh-CN/productReadTools';
import { productReadTools as en } from './messages/en-US/productReadTools';

uiI18n.global.mergeLocaleMessage('zh-CN', { productReadTools: zh });
uiI18n.global.mergeLocaleMessage('en-US', { productReadTools: en });
export function useProductReadToolsI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh) => t(`productReadTools.${key}`);
}
