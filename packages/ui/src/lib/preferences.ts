import { computed, ref, type WritableComputedRef } from 'vue';

import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  parseAppPreferences,
  type AlibabaLanguage,
  type AppPreferences,
  type AppTheme
} from '@one-vegetable/core';

const state = ref<AppPreferences>({ ...DEFAULT_APP_PREFERENCES });

export function useAppPreferences(): {
  language: WritableComputedRef<AlibabaLanguage>;
  theme: WritableComputedRef<AppTheme>;
} {
  state.value = readAppPreferences();
  applyAppTheme(state.value.theme);
  return {
    language: computed({
      get: () => state.value.language,
      set: (language) => {
        state.value = { ...state.value, language };
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
  if (!storage) return { ...DEFAULT_APP_PREFERENCES };
  const raw = storage.getItem(APP_PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_APP_PREFERENCES };
  try {
    return parseAppPreferences(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

function persistAppPreferences(preferences: AppPreferences): void {
  browserStorage()?.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function browserStorage(): Storage | undefined {
  try {
    return 'localStorage' in globalThis ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}
