import { uiI18n, useUiI18n } from './index';
import { productValueMaintenance as zh } from './messages/zh-CN/productValueMaintenance';
import { productValueMaintenance as en } from './messages/en-US/productValueMaintenance';
uiI18n.global.mergeLocaleMessage('zh-CN', { productValueMaintenance: zh });
uiI18n.global.mergeLocaleMessage('en-US', { productValueMaintenance: en });
export function useProductValueMaintenanceI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh) => t(`productValueMaintenance.${key}`);
}
