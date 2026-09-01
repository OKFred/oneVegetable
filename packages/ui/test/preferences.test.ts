// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { APP_PREFERENCES_STORAGE_KEY, LEGACY_APP_PREFERENCES_STORAGE_KEY } from '@one-vegetable/core';

import { readAppPreferences, resolveBrowserUiLocale, useAppPreferences } from '../src/lib/preferences';

describe('interface preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the browser UI language and persists Alibaba language independently', () => {
    expect(readAppPreferences()).toEqual({
      uiLocale: 'en-US',
      alibabaLanguage: 'en_US',
      theme: 'system'
    });

    const { alibabaLanguage, uiLocale } = useAppPreferences();
    alibabaLanguage.value = 'zh_CN';
    uiLocale.value = 'zh-CN';

    expect(readAppPreferences()).toEqual({
      uiLocale: 'zh-CN',
      alibabaLanguage: 'zh_CN',
      theme: 'system'
    });
    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      uiLocale: 'zh-CN',
      alibabaLanguage: 'zh_CN',
      theme: 'system'
    });
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('falls back safely when stored data is invalid', () => {
    localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, '{invalid');
    expect(readAppPreferences()).toEqual({
      uiLocale: 'en-US',
      alibabaLanguage: 'en_US',
      theme: 'system'
    });
  });

  it('migrates V1 preferences while preserving a Chinese interface', () => {
    localStorage.setItem(
      LEGACY_APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ language: 'en_US', theme: 'dark' })
    );

    expect(readAppPreferences()).toEqual({
      uiLocale: 'zh-CN',
      alibabaLanguage: 'en_US',
      theme: 'dark'
    });
    expect(localStorage.getItem(LEGACY_APP_PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY)).not.toBeNull();
  });

  it('detects Chinese from the complete browser language list', () => {
    expect(resolveBrowserUiLocale(['en-US', 'zh-Hans-CN'])).toBe('zh-CN');
    expect(resolveBrowserUiLocale(['en-US', 'fr-FR'])).toBe('en-US');
  });
});
