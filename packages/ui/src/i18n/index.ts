import { computed, type ComputedRef } from 'vue';
import { createI18n } from 'vue-i18n';

import type { UiLocale } from '@one-vegetable/core';

import { applyUiLocale, readAppPreferences, subscribeUiLocale } from '../lib/preferences';
import { enUS } from './messages/en-US';
import { zhCN } from './messages/zh-CN';

export const uiI18n = createI18n({
  legacy: false,
  locale: readAppPreferences().uiLocale,
  fallbackLocale: 'zh-CN',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
});

subscribeUiLocale((locale) => {
  uiI18n.global.locale.value = locale;
});
applyUiLocale(uiI18n.global.locale.value);

export function useUiI18n(): {
  locale: ComputedRef<UiLocale>;
  t: (key: string, values?: Record<string, unknown>) => string;
} {
  return {
    locale: computed(() => uiI18n.global.locale.value),
    t: translateUi
  };
}

export function translateUi(key: string, values?: Record<string, unknown>): string {
  return uiI18n.global.t(key, values ?? {});
}
