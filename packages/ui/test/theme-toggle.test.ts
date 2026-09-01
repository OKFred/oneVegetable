// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_PREFERENCES_STORAGE_KEY } from '@one-vegetable/core';

import ThemeToggle from '../src/components/ThemeToggle.vue';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cycles through system, light and dark themes while persisting each selection', async () => {
    const wrapper = mount(ThemeToggle);
    const trigger = wrapper.get('[data-testid="theme-toggle"]');

    expect(trigger.attributes('aria-label')).toBe('界面主题：跟随系统；点击切换为浅色');
    await trigger.trigger('click');
    expect(trigger.attributes('aria-label')).toBe('界面主题：浅色；点击切换为深色');
    expect(document.documentElement.dataset.theme).toBe('light');

    await trigger.trigger('click');
    expect(trigger.attributes('aria-label')).toBe('界面主题：深色；点击切换为跟随系统');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await trigger.trigger('click');
    expect(trigger.attributes('aria-label')).toBe('界面主题：跟随系统；点击切换为浅色');
    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'en_US',
      theme: 'system'
    });
    wrapper.unmount();
  });
});
