// @vitest-environment jsdom

import { h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ActionTooltip from '../src/components/ActionTooltip.vue';
import ConfirmActionDialog from '../src/components/ConfirmActionDialog.vue';
import Button from '../src/components/ui/Button.vue';

class ResizeObserverMock implements ResizeObserver {
  observe(): void {
    return;
  }
  unobserve(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('action feedback primitives', () => {
  it('makes a disabled action reason keyboard accessible', async () => {
    const wrapper = mount(ActionTooltip, {
      attachTo: document.body,
      props: { disabled: true, reason: '请先选择商品' },
      slots: { default: () => h(Button, { disabled: true }, () => '导出') }
    });

    const trigger = wrapper.get('[tabindex="0"]');
    expect(trigger.attributes('aria-label')).toBe('请先选择商品');
    await trigger.trigger('focusin');
    await flushPromises();
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('请先选择商品');
  });

  it('emits confirmation and blocks closing while pending', async () => {
    const wrapper = mount(ConfirmActionDialog, {
      attachTo: document.body,
      props: {
        open: true,
        title: '确认真实操作',
        description: '提交前请确认影响。',
        confirmLabel: '继续',
        pending: false
      },
      slots: { default: '该操作会修改国际站数据。' }
    });

    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('确认真实操作');
    });
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].at(-1);
    expect(confirm?.textContent).toContain('继续');
    confirm?.click();
    expect(wrapper.emitted('confirm')).toHaveLength(1);

    await wrapper.setProps({ pending: true });
    const cancel = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent.trim() === '取消'
    );
    cancel?.click();
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });
});
