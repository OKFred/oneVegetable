export const ALIBABA_LANGUAGES = ['zh_CN', 'en_US'] as const;
export type AlibabaLanguage = (typeof ALIBABA_LANGUAGES)[number];
export const UI_LOCALES = ['zh-CN', 'en-US'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const APP_THEMES = ['system', 'light', 'dark'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export interface AppPreferences {
  uiLocale: UiLocale;
  alibabaLanguage: AlibabaLanguage;
  theme: AppTheme;
}

export const APP_PREFERENCES_STORAGE_KEY = 'one-vegetable:preferences:v2';
export const LEGACY_APP_PREFERENCES_STORAGE_KEY = 'one-vegetable:preferences:v1';
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  uiLocale: 'en-US',
  alibabaLanguage: 'en_US',
  theme: 'system'
};

export function parseAppPreferences(
  value: unknown,
  fallbackUiLocale: UiLocale = DEFAULT_APP_PREFERENCES.uiLocale
): AppPreferences {
  const record = asRecord(value);
  const isLegacy = 'language' in record && !('alibabaLanguage' in record);
  return {
    uiLocale: isUiLocale(record.uiLocale) ? record.uiLocale : isLegacy ? 'zh-CN' : fallbackUiLocale,
    alibabaLanguage: isAlibabaLanguage(record.alibabaLanguage)
      ? record.alibabaLanguage
      : isAlibabaLanguage(record.language)
        ? record.language
        : DEFAULT_APP_PREFERENCES.alibabaLanguage,
    theme: isAppTheme(record.theme) ? record.theme : DEFAULT_APP_PREFERENCES.theme
  };
}

export function isAlibabaLanguage(value: unknown): value is AlibabaLanguage {
  return ALIBABA_LANGUAGES.some((language) => language === value);
}

export function isUiLocale(value: unknown): value is UiLocale {
  return UI_LOCALES.some((locale) => locale === value);
}

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.some((theme) => theme === value);
}

export function productListLanguage(language: AlibabaLanguage): 'CHINESE' | 'ENGLISH' {
  return language === 'zh_CN' ? 'CHINESE' : 'ENGLISH';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
