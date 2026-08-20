import { describe, expect, it } from 'vitest';

import {
  DEFAULT_APP_PREFERENCES,
  isAlibabaLanguage,
  parseAppPreferences,
  productListLanguage
} from '../src/preferences';

describe('application preferences', () => {
  it('accepts only the two supported Alibaba languages', () => {
    expect(parseAppPreferences({ language: 'zh_CN' })).toEqual({ language: 'zh_CN' });
    expect(parseAppPreferences({ language: 'en_US' })).toEqual({ language: 'en_US' });
    expect(parseAppPreferences({ language: 'zh_TW' })).toEqual(DEFAULT_APP_PREFERENCES);
    expect(isAlibabaLanguage('zh')).toBe(false);
  });

  it('maps the preference to the product list language enum', () => {
    expect(productListLanguage('zh_CN')).toBe('CHINESE');
    expect(productListLanguage('en_US')).toBe('ENGLISH');
  });
});
