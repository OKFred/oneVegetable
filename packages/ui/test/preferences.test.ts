// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { APP_PREFERENCES_STORAGE_KEY } from '@one-vegetable/core';

import { readAppPreferences, useAppPreferences } from '../src/lib/preferences';

describe('interface preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to en_US and persists a supported selection', () => {
    expect(readAppPreferences()).toEqual({ language: 'en_US', theme: 'system' });

    const { language } = useAppPreferences();
    language.value = 'zh_CN';

    expect(readAppPreferences()).toEqual({ language: 'zh_CN', theme: 'system' });
    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'zh_CN',
      theme: 'system'
    });
  });

  it('falls back safely when stored data is invalid', () => {
    localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, '{invalid');
    expect(readAppPreferences()).toEqual({ language: 'en_US', theme: 'system' });
  });
});
