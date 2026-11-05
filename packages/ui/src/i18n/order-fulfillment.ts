import { uiI18n, useUiI18n } from './index';
import { orderFulfillment as zh } from './messages/zh-CN/orderFulfillment';
import { orderFulfillment as en } from './messages/en-US/orderFulfillment';

uiI18n.global.mergeLocaleMessage('zh-CN', { orderFulfillment: zh });
uiI18n.global.mergeLocaleMessage('en-US', { orderFulfillment: en });

export const orderFulfillmentMessages = { 'zh-CN': zh, 'en-US': en };
export function useOrderFulfillmentI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh): string => t('orderFulfillment.' + key);
}
