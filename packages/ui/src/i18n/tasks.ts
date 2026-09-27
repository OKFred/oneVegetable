import { uiI18n, useUiI18n } from './index';
import { tasks as zh } from './messages/zh-CN/tasks';
import { tasks as en } from './messages/en-US/tasks';
uiI18n.global.mergeLocaleMessage('zh-CN', { tasks: zh });
uiI18n.global.mergeLocaleMessage('en-US', { tasks: en });
export function useTaskI18n() {
  const { t } = useUiI18n();
  return (key: string, values?: Record<string, unknown>) => t(`tasks.${key}`, values);
}
