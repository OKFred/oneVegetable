import { uiI18n, useUiI18n } from './index';
import { templateComposition as zh } from './messages/zh-CN/templateComposition';
import { templateComposition as en } from './messages/en-US/templateComposition';

uiI18n.global.mergeLocaleMessage('zh-CN', { templateComposition: zh });
uiI18n.global.mergeLocaleMessage('en-US', { templateComposition: en });
export function useTemplateCompositionI18n() {
  const { t } = useUiI18n();
  return (key: keyof typeof zh, values?: Record<string, unknown>) => t(`templateComposition.${key}`, values);
}
