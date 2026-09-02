// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_PREFERENCES_STORAGE_KEY } from '@one-vegetable/core';

import LanguageToggle from '../src/components/LanguageToggle.vue';

describe('LanguageToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'system' })
    );
  });

  it('switches the interface language without changing the Alibaba language', async () => {
    const wrapper = mount(LanguageToggle);
    const trigger = wrapper.get('[data-testid="language-toggle"]');

    expect(trigger.text()).toBe('EN');
    expect(document.documentElement.lang).toBe('zh-CN');
    await trigger.trigger('click');
    expect(trigger.text()).toBe('中');
    expect(document.documentElement.lang).toBe('en-US');
    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      uiLocale: 'en-US',
      alibabaLanguage: 'en_US',
      theme: 'system'
    });
  });
});
