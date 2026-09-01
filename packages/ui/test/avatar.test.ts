// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Avatar from '../src/components/ui/Avatar.vue';

describe('Avatar', () => {
  it('renders an accessible fallback without requiring a remote image', () => {
    const wrapper = mount(Avatar, {
      attrs: { 'aria-label': 'Current user: local-admin', role: 'img' },
      slots: { default: '<span data-slot="avatar-fallback">LA</span>' }
    });

    expect(wrapper.attributes('aria-label')).toBe('Current user: local-admin');
    expect(wrapper.attributes('role')).toBe('img');
    expect(wrapper.get('[data-slot="avatar-fallback"]').text()).toBe('LA');
  });
});
