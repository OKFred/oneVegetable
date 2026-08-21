import { describe, expect, it } from 'vitest';

import {
  DEFAULT_APP_PREFERENCES,
  isAlibabaLanguage,
  isAppTheme,
  parseAppPreferences,
  productListLanguage
} from '../src/preferences';

describe('application preferences', () => {
  it('accepts only the two supported Alibaba languages', () => {
    expect(parseAppPreferences({ language: 'zh_CN' })).toEqual({ language: 'zh_CN', theme: 'system' });
    expect(parseAppPreferences({ language: 'en_US' })).toEqual({ language: 'en_US', theme: 'system' });
    expect(parseAppPreferences({ language: 'zh_TW' })).toEqual(DEFAULT_APP_PREFERENCES);
    expect(isAlibabaLanguage('zh')).toBe(false);
  });

  it('accepts system, light and dark themes while migrating older preferences', () => {
    expect(parseAppPreferences({ language: 'zh_CN', theme: 'dark' })).toEqual({
      language: 'zh_CN',
      theme: 'dark'
    });
    expect(parseAppPreferences({ language: 'zh_CN', theme: 'sepia' })).toEqual({
      language: 'zh_CN',
      theme: 'system'
    });
    expect(isAppTheme('light')).toBe(true);
    expect(isAppTheme('sepia')).toBe(false);
  });

  it('maps the preference to the product list language enum', () => {
    expect(productListLanguage('zh_CN')).toBe('CHINESE');
    expect(productListLanguage('en_US')).toBe('ENGLISH');
  });
});
