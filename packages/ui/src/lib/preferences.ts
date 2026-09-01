import { computed, ref, type WritableComputedRef } from 'vue';

import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  LEGACY_APP_PREFERENCES_STORAGE_KEY,
  parseAppPreferences,
  type AlibabaLanguage,
  type AppPreferences,
  type AppTheme,
  type UiLocale
} from '@one-vegetable/core';

const state = ref<AppPreferences>({ ...DEFAULT_APP_PREFERENCES });
const uiLocaleListeners = new Set<(locale: UiLocale) => void>();

export function useAppPreferences(): {
  uiLocale: WritableComputedRef<UiLocale>;
  alibabaLanguage: WritableComputedRef<AlibabaLanguage>;
  theme: WritableComputedRef<AppTheme>;
} {
  state.value = readAppPreferences();
  applyAppTheme(state.value.theme);
  applyUiLocale(state.value.uiLocale);
  return {
    uiLocale: computed({
      get: () => state.value.uiLocale,
      set: (uiLocale) => {
        state.value = { ...state.value, uiLocale };
        persistAppPreferences(state.value);
        applyUiLocale(uiLocale);
      }
    }),
    alibabaLanguage: computed({
      get: () => state.value.alibabaLanguage,
      set: (alibabaLanguage) => {
        state.value = { ...state.value, alibabaLanguage };
        persistAppPreferences(state.value);
      }
    }),
    theme: computed({
      get: () => state.value.theme,
      set: (theme) => {
        state.value = { ...state.value, theme };
        persistAppPreferences(state.value);
        applyAppTheme(theme);
      }
    })
  };
}

export function applyAppTheme(theme: AppTheme): 'light' | 'dark' {
  const resolved =
    theme === 'system' && typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme === 'dark'
        ? 'dark'
        : 'light';
  if ('document' in globalThis) {
    globalThis.document.documentElement.classList.toggle('dark', resolved === 'dark');
    globalThis.document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

export function readAppPreferences(): AppPreferences {
  const storage = browserStorage();
  const fallback = initialAppPreferences();
  if (!storage) return fallback;
  const current = storage.getItem(APP_PREFERENCES_STORAGE_KEY);
  if (current) {
    try {
      const preferences = parseAppPreferences(JSON.parse(current) as unknown, fallback.uiLocale);
      persistAppPreferences(preferences, storage);
      return preferences;
    } catch {
      persistAppPreferences(fallback, storage);
      return fallback;
    }
  }

  const legacy = storage.getItem(LEGACY_APP_PREFERENCES_STORAGE_KEY);
  if (legacy) {
    try {
      const preferences = parseAppPreferences(JSON.parse(legacy) as unknown, 'zh-CN');
      persistAppPreferences(preferences, storage);
      storage.removeItem(LEGACY_APP_PREFERENCES_STORAGE_KEY);
      return preferences;
    } catch {
      storage.removeItem(LEGACY_APP_PREFERENCES_STORAGE_KEY);
    }
  }

  persistAppPreferences(fallback, storage);
  return fallback;
}

export function resolveBrowserUiLocale(languages?: readonly string[]): UiLocale {
  const candidates = languages ?? browserLanguages();
  return candidates.some((value) => value.toLowerCase().includes('zh')) ? 'zh-CN' : 'en-US';
}

export function applyUiLocale(locale: UiLocale): void {
  if ('document' in globalThis) globalThis.document.documentElement.lang = locale;
  for (const listener of uiLocaleListeners) listener(locale);
}

export function subscribeUiLocale(listener: (locale: UiLocale) => void): () => void {
  uiLocaleListeners.add(listener);
  return () => uiLocaleListeners.delete(listener);
}

export function clearAppPreferences(): void {
  const storage = browserStorage();
  storage?.removeItem(APP_PREFERENCES_STORAGE_KEY);
  storage?.removeItem(LEGACY_APP_PREFERENCES_STORAGE_KEY);
  state.value = initialAppPreferences();
  applyAppTheme(state.value.theme);
  applyUiLocale(state.value.uiLocale);
}

function initialAppPreferences(): AppPreferences {
  return { ...DEFAULT_APP_PREFERENCES, uiLocale: resolveBrowserUiLocale() };
}

function browserLanguages(): readonly string[] {
  try {
    return 'navigator' in globalThis ? globalThis.navigator.languages : [];
  } catch {
    return [];
  }
}

function persistAppPreferences(preferences: AppPreferences, storage = browserStorage()): void {
  storage?.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function browserStorage(): Storage | undefined {
  try {
    return 'localStorage' in globalThis ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}
