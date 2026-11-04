import { uiI18n, useUiI18n } from './index';
import { files as zh } from './messages/zh-CN/files';
import { files as en } from './messages/en-US/files';

uiI18n.global.mergeLocaleMessage('zh-CN', { files: zh });
uiI18n.global.mergeLocaleMessage('en-US', { files: en });

export function useFilesI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`files.${key}`, values);
}
