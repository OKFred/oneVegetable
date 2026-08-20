// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Sheet from '../src/components/ui/Sheet.vue';

describe('Sheet', () => {
  it('renders an accessible modal and closes from its close action', async () => {
    const open = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          h(
            Sheet,
            {
              open: open.value,
              title: '订单详情',
              description: '只读聚合信息',
              'onUpdate:open': (value: boolean) => {
                open.value = value;
              }
            },
            () => h('p', '订单内容')
          );
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('订单内容');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]');
    close?.click();
    await nextTick();
    expect(open.value).toBe(false);
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('data-state')).toBe('closed');
    wrapper.unmount();
  });
});
