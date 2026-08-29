// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TriStateCheckbox from '../src/components/TriStateCheckbox.vue';

describe('TriStateCheckbox', () => {
  it('synchronizes native and accessible indeterminate state', async () => {
    const wrapper = mount(TriStateCheckbox, {
      props: {
        checked: false,
        indeterminate: true,
        label: '选择本页全部商品'
      }
    });
    const input = wrapper.get('input').element;

    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('mixed');

    await wrapper.setProps({ checked: true, indeterminate: false });
    expect(input.indeterminate).toBe(false);
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
  });

  it('emits changes and exposes its disabled state', async () => {
    const wrapper = mount(TriStateCheckbox, {
      props: {
        checked: false,
        disabled: false,
        label: '选择商品'
      }
    });

    await wrapper.get('input').setValue(true);
    expect(wrapper.emitted('update:checked')).toEqual([[true]]);

    await wrapper.setProps({ disabled: true });
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
  });
});
