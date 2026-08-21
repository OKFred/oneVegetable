export const ALIBABA_LANGUAGES = ['zh_CN', 'en_US'] as const;
export type AlibabaLanguage = (typeof ALIBABA_LANGUAGES)[number];
export const APP_THEMES = ['system', 'light', 'dark'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export interface AppPreferences {
  language: AlibabaLanguage;
  theme: AppTheme;
}

export const APP_PREFERENCES_STORAGE_KEY = 'one-vegetable:preferences:v1';
export const DEFAULT_APP_PREFERENCES: AppPreferences = { language: 'en_US', theme: 'system' };

export function parseAppPreferences(value: unknown): AppPreferences {
  const record = asRecord(value);
  return {
    language: isAlibabaLanguage(record.language) ? record.language : DEFAULT_APP_PREFERENCES.language,
    theme: isAppTheme(record.theme) ? record.theme : DEFAULT_APP_PREFERENCES.theme
  };
}

export function isAlibabaLanguage(value: unknown): value is AlibabaLanguage {
  return ALIBABA_LANGUAGES.some((language) => language === value);
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
