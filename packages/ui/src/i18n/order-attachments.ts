import { uiI18n, useUiI18n } from './index';
import { orderAttachments as zh } from './messages/zh-CN/orderAttachments';
import { orderAttachments as en } from './messages/en-US/orderAttachments';

uiI18n.global.mergeLocaleMessage('zh-CN', { orderAttachments: zh });
uiI18n.global.mergeLocaleMessage('en-US', { orderAttachments: en });

export function useOrderAttachmentsI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh) => t('orderAttachments.' + key);
}
