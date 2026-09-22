// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import ListFilterDialog from '../src/components/ListFilterDialog.vue';

describe('ListFilterDialog', () => {
  it('requires apply explicitly and keeps reset separate from applying', async () => {
    const wrapper = mount(ListFilterDialog, {
      props: { open: true, activeCount: 2 },
      slots: { default: () => h('input', { value: 'draft' }) },
      attachTo: document.body
    });
    await flushPromises();
    expect(wrapper.text()).toContain('· 2');
    const button = (label: string) =>
      [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
    button('重置')?.click();
    await flushPromises();
    expect(wrapper.emitted('reset')).toHaveLength(1);
    expect(wrapper.emitted('apply')).toBeUndefined();
    button('取消')?.click();
    await flushPromises();
    expect(wrapper.emitted('update:open')).toContainEqual([false]);
    expect(wrapper.emitted('apply')).toBeUndefined();
    await wrapper.setProps({ invalid: true });
    expect(button('应用筛选')?.disabled).toBe(true);
    wrapper.unmount();
  });
});
