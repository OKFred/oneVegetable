// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
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

  it('keeps a non-dismissible dialog open when its overlay is clicked', async () => {
    const open = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          h(
            ModalDialog,
            {
              open: open.value,
              title: '登录已过期',
              dismissible: false,
              showClose: false,
              'onUpdate:open': (value: boolean) => {
                open.value = value;
              }
            },
            () => h('p', '请重新登录')
          );
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    document.body.querySelector<HTMLButtonElement>('.ov-dialog-overlay')?.click();
    await nextTick();

    expect(open.value).toBe(true);
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('请重新登录');
    wrapper.unmount();
  });

  it('places an earlier-mounted confirmation above a later-mounted configuration', async () => {
    const confirmationOpen = ref(false);
    const configurationOpen = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          h('div', [
            h(
              ModalDialog,
              {
                open: confirmationOpen.value,
                title: '确认清除',
                'onUpdate:open': (value: boolean) => {
                  confirmationOpen.value = value;
                }
              },
              () =>
                h(
                  'button',
                  {
                    onClick: () => {
                      confirmationOpen.value = false;
                    }
                  },
                  '取消清除'
                )
            ),
            h(
              ModalDialog,
              {
                open: configurationOpen.value,
                title: 'IOP 授权配置',
                'onUpdate:open': (value: boolean) => {
                  configurationOpen.value = value;
                }
              },
              () =>
                h(
                  'button',
                  {
                    onClick: () => {
                      confirmationOpen.value = true;
                    }
                  },
                  '清除配置'
                )
            )
          ]);
      }
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '清除配置')
      ?.click();
    await flushPromises();
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    const confirmation = dialogs.find((element) => element.textContent.includes('取消清除'));
    const configuration = dialogs.find((element) => element.textContent.includes('IOP 授权配置'));
    expect(confirmation).toBeDefined();
    expect(configuration).toBeDefined();
    expect(Number(confirmation?.style.zIndex)).toBeGreaterThan(Number(configuration?.style.zIndex));
    const overlay = [...document.querySelectorAll<HTMLElement>('.ov-dialog-overlay')].find(
      (element) => Number(element.style.zIndex) === Number(confirmation?.style.zIndex) - 1
    );
    expect(Number(overlay?.style.zIndex)).toBeGreaterThan(Number(configuration?.style.zIndex));
    confirmation?.querySelector<HTMLButtonElement>('button[aria-label]')?.click();
    await flushPromises();
    expect(confirmationOpen.value).toBe(false);
    expect(configurationOpen.value).toBe(true);
    wrapper.unmount();
  });
});
