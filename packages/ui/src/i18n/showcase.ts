import { uiI18n, useUiI18n } from './index';
import { showcase as zh } from './messages/zh-CN/showcase';
import { showcase as en } from './messages/en-US/showcase';

// Loaded with the product workspace, not the global shell translation chunk.
uiI18n.global.mergeLocaleMessage('zh-CN', { showcase: zh });
uiI18n.global.mergeLocaleMessage('en-US', { showcase: en });
export function useShowcaseI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`showcase.${key}`, values);
}
