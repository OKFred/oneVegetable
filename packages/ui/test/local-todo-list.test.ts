// @vitest-environment jsdom

import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import LocalTodoList from '../src/components/LocalTodoList.vue';
import { loadDashboardTodos } from '../src/lib/local-todos';
import ConfirmActionDialog from '../src/components/ConfirmActionDialog.vue';
import { uiI18n } from '../src/i18n';

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
    (item) => item.textContent.trim() === label
  );
  if (!button) throw new Error(`Missing dialog button ${label}`);
  return button;
}

describe('LocalTodoList', () => {
  beforeEach(() => {
    localStorage.clear();
    uiI18n.global.locale.value = 'zh-CN';
  });
  afterEach(() => {
    document.body.innerHTML = '';
    uiI18n.global.locale.value = 'zh-CN';
  });

  it('persists additions and completion locally', async () => {
    const wrapper = mount(LocalTodoList);
    await wrapper.get('[data-testid="todo-input"]').setValue('Review RFQ permissions');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.text()).toContain('Review RFQ permissions');
    expect(loadDashboardTodos(localStorage)).toMatchObject([
      { text: 'Review RFQ permissions', completed: false }
    ]);

    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(loadDashboardTodos(localStorage)[0]?.completed).toBe(true);
    expect(wrapper.find('[data-testid="todo-clear-completed"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('removes completed items and restores persisted items after remounting', async () => {
    const first = mount(LocalTodoList);
    await first.get('[data-testid="todo-input"]').setValue('Persist this item');
    await first.get('form').trigger('submit');
    first.unmount();

    const second = mount(LocalTodoList);
    expect(second.text()).toContain('Persist this item');
    await second.get('input[type="checkbox"]').setValue(true);
    await second.get('[data-testid="todo-clear-completed"]').trigger('click');
    await flushPromises();
    expect(second.text()).toContain('Persist this item');
    expect(loadDashboardTodos(localStorage)).toHaveLength(1);
    dialogButton('确认清除').click();
    await flushPromises();
    expect(second.text()).not.toContain('Persist this item');
    expect(loadDashboardTodos(localStorage)).toEqual([]);
    second.unmount();
  });

  it('keeps completed items when cancelled and translates the confirmation and title', async () => {
    const wrapper = mount(LocalTodoList);
    expect(wrapper.text()).toContain('待办');
    expect(wrapper.text()).not.toContain('本地待办');
    expect(wrapper.text()).toContain('仅保存在当前浏览器');
    await wrapper.get('[data-testid="todo-input"]').setValue('Keep until confirmed');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-testid="todo-clear-completed"]').trigger('click');
    const confirmation = wrapper.getComponent(ConfirmActionDialog);
    expect(confirmation.props('open')).toBe(true);
    expect(confirmation.props('description')).toContain('1');
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('To-do');
    expect(confirmation.props('title')).toBe('Clear completed to-dos?');
    dialogButton('Cancel').click();
    await flushPromises();
    expect(confirmation.props('open')).toBe(false);
    expect(loadDashboardTodos(localStorage)).toHaveLength(1);
    wrapper.unmount();
  });
});
