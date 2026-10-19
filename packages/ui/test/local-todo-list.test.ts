// @vitest-environment jsdom

import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  mockTodoLocalStorage,
  mockTodoSync,
  TODO_FIXTURE,
  TODO_TEXTS
} from '../../../mock/data/dashboard-todo-sync';
import { provideDashboardTodos } from '../src/lib/todo-repository';
import { createSyncTodoRepository } from '../src/lib/sync-todos';
import { saveDashboardTodos } from '../src/lib/local-todos';

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

  it('shows extension sync copy, explicit migration and honest pending/retry status', async () => {
    uiI18n.global.locale.value = 'en-US';
    const cloud = mockTodoSync();
    const local = mockTodoLocalStorage();
    saveDashboardTodos(local, [TODO_FIXTURE]);
    const repository = createSyncTodoRepository({ ...cloud, local });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideDashboardTodos(repository);
          return () => h(LocalTodoList);
        }
      })
    );
    await flushPromises();
    expect(wrapper.text()).toContain('To-dos use Chrome Sync when available');
    expect(wrapper.get('[data-testid="todo-migration"]').text()).toContain('Import 1 local to-dos');
    expect(cloud.writes).toEqual([]);
    await wrapper.get('[data-testid="todo-migration"] button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(TODO_FIXTURE.text);
    expect(wrapper.find('[data-testid="todo-migration"]').exists()).toBe(false);
    cloud.state.writeFailure = true;
    await wrapper.get('[data-testid="todo-input"]').setValue(TODO_TEXTS[1]);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Saved locally; sync pending');
    expect(wrapper.text()).not.toContain('Saved to Chrome sync storage;');
    cloud.state.writeFailure = false;
    await wrapper.get('[data-testid="todo-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('other devices may not have received it yet');
    uiI18n.global.locale.value = 'zh-CN';
    await flushPromises();
    expect(wrapper.text()).toContain('送达取决于同步状态');
    wrapper.unmount();
    repository.dispose();
  });

  it('removes completed items and restores persisted items after remounting', async () => {
    const first = mount(LocalTodoList);
    await first.get('[data-testid="todo-input"]').setValue('Persist this item');
    await first.get('form').trigger('submit');
    first.unmount();

    const second = mount(LocalTodoList);
    await flushPromises();
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
