import { computed, ref, type WritableComputedRef } from 'vue';

import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  parseAppPreferences,
  type AlibabaLanguage,
  type AppPreferences
} from '@one-vegetable/core';

const state = ref<AppPreferences>({ ...DEFAULT_APP_PREFERENCES });

export function useAppPreferences(): { language: WritableComputedRef<AlibabaLanguage> } {
  state.value = readAppPreferences();
  return {
    language: computed({
      get: () => state.value.language,
      set: (language) => {
        state.value = { ...state.value, language };
        persistAppPreferences(state.value);
      }
    })
  };
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
