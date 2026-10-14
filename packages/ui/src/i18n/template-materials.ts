import { uiI18n, useUiI18n } from './index';
import { templateMaterials as zh } from './messages/zh-CN/templateMaterials';
import { templateMaterials as en } from './messages/en-US/templateMaterials';

// Loaded with the transfer dialog, not the application-wide message bundle.
uiI18n.global.mergeLocaleMessage('zh-CN', { templateMaterials: zh, errors: { codes: zh.codes } });
uiI18n.global.mergeLocaleMessage('en-US', { templateMaterials: en, errors: { codes: en.codes } });

export function useTemplateMaterialsI18n() {
  const { t } = useUiI18n();
  return (key: Exclude<keyof typeof zh, 'codes'>, values?: Record<string, unknown>) =>
    t(`templateMaterials.${key}`, values);
}
