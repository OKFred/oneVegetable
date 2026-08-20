// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ModalDialog from '../src/components/ui/ModalDialog.vue';

describe('ModalDialog', () => {
  it('renders an accessible centered dialog and closes from its close action', async () => {
    const open = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          h(
            ModalDialog,
            {
              open: open.value,
              title: '上传图片到图库',
              description: '目标分组：商品主图',
              'onUpdate:open': (value: boolean) => {
                open.value = value;
              }
            },
            () => h('p', '上传内容')
          );
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('目标分组：商品主图');
    expect(dialog?.textContent).toContain('上传内容');

    document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭上传图片到图库"]')?.click();
    await nextTick();
    expect(open.value).toBe(false);
    wrapper.unmount();
  });
});
