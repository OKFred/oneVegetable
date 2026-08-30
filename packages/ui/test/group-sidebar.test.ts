// @vitest-environment jsdom

import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GroupSidebar from '../src/components/GroupSidebar.vue';

describe('GroupSidebar', () => {
  it('keeps the toggle available while expanded and collapsed', async () => {
    const Host = defineComponent({
      setup() {
        const collapsed = ref(false);
        return () =>
          h(
            GroupSidebar,
            {
              title: '商品分组',
              collapsed: collapsed.value,
              'onUpdate:collapsed': (value: boolean) => {
                collapsed.value = value;
              }
            },
            () => h('div', '分组内容')
          );
      }
    });
    const wrapper = mount(Host);
    const sidebar = wrapper.getComponent(GroupSidebar);

    expect(sidebar.classes()).toEqual(expect.arrayContaining(['lg:sticky', 'lg:top-20']));
    expect(wrapper.text()).toContain('分组内容');
    await wrapper.get('button[aria-label="收起商品分组"]').trigger('click');
    expect(wrapper.text()).not.toContain('分组内容');
    await wrapper.get('button[aria-label="展开商品分组"]').trigger('click');
    expect(wrapper.text()).toContain('分组内容');
  });
});
