import { uiI18n, useUiI18n } from './index';
import { inventory as zh } from './messages/zh-CN/inventory';
import { inventory as en } from './messages/en-US/inventory';
uiI18n.global.mergeLocaleMessage('zh-CN', { inventory: zh });
uiI18n.global.mergeLocaleMessage('en-US', { inventory: en });
export function useInventoryI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`inventory.${key}`, values);
}
