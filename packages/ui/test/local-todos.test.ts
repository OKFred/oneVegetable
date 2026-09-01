// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  addDashboardTodo,
  clearCompletedDashboardTodos,
  DASHBOARD_TODOS_STORAGE_KEY,
  loadDashboardTodos,
  removeDashboardTodo,
  saveDashboardTodos,
  updateDashboardTodoCompletion
} from '../src/lib/local-todos';

describe('local dashboard todos', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds, persists, completes, and removes items', () => {
    const added = addDashboardTodo([], '  Check product score  ', 100, 'todo-1');
    expect(added).toEqual([
      {
        id: 'todo-1',
        text: 'Check product score',
        completed: false,
        createTimeUtc: 100,
        updateTimeUtc: 100
      }
    ]);

    const completed = updateDashboardTodoCompletion(added, 'todo-1', true, 200);
    saveDashboardTodos(localStorage, completed);
    expect(loadDashboardTodos(localStorage)).toEqual([
      expect.objectContaining({ id: 'todo-1', completed: true, updateTimeUtc: 200 })
    ]);
    expect(clearCompletedDashboardTodos(completed)).toEqual([]);
    expect(removeDashboardTodo(added, 'todo-1')).toEqual([]);
  });

  it('discards malformed storage without leaking invalid items', () => {
    localStorage.setItem(DASHBOARD_TODOS_STORAGE_KEY, '{broken');
    expect(loadDashboardTodos(localStorage)).toEqual([]);
    expect(localStorage.getItem(DASHBOARD_TODOS_STORAGE_KEY)).toBeNull();

    localStorage.setItem(
      DASHBOARD_TODOS_STORAGE_KEY,
      JSON.stringify({ version: 1, items: [{ id: 'bad', text: '', completed: false }] })
    );
    expect(loadDashboardTodos(localStorage)).toEqual([]);
  });
});
