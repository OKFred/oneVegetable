import { uiI18n, useUiI18n } from './index';
import { productMaintenance as zh } from './messages/zh-CN/productMaintenance';
import { productMaintenance as en } from './messages/en-US/productMaintenance';
uiI18n.global.mergeLocaleMessage('zh-CN', { productMaintenance: zh });
uiI18n.global.mergeLocaleMessage('en-US', { productMaintenance: en });
export function useProductMaintenanceI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`productMaintenance.${key}`, values);
}
