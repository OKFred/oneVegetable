// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import LocalTodoList from '../src/components/LocalTodoList.vue';
import { loadDashboardTodos } from '../src/lib/local-todos';

describe('LocalTodoList', () => {
  beforeEach(() => {
    localStorage.clear();
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
    expect(second.text()).not.toContain('Persist this item');
    expect(loadDashboardTodos(localStorage)).toEqual([]);
  });
});
