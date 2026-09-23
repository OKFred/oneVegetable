// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ActionTooltip from '../src/components/ActionTooltip.vue';

describe('disabled action explanations', () => {
  it('keeps a keyboard and pointer target outside the native disabled button', () => {
    const wrapper = mount(ActionTooltip, {
      props: { disabled: true, reason: 'Permission required' },
      slots: { default: '<button disabled>Search</button>' }
    });
    const trigger = wrapper.get('span[tabindex="0"]');
    expect(trigger.attributes('aria-label')).toBe('Permission required');
    expect(trigger.classes()).toContain('[&_button:disabled]:pointer-events-none');
    expect(trigger.get('button').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('does not intercept enabled actions', () => {
    const wrapper = mount(ActionTooltip, {
      props: { disabled: false, reason: '' },
      slots: { default: '<button>Search</button>' }
    });
    expect(wrapper.find('[tabindex]').exists()).toBe(false);
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    expect(wrapper.html()).not.toContain('pointer-events-none');
    wrapper.unmount();
  });
});
