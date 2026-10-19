import { inject, provide, type InjectionKey } from 'vue';

import {
  addDashboardTodo,
  clearCompletedDashboardTodos,
  loadDashboardTodos,
  removeDashboardTodo,
  saveDashboardTodos,
  updateDashboardTodoCompletion,
  DASHBOARD_TODOS_STORAGE_KEY,
  type DashboardTodo
} from './local-todos';

export interface TodoSnapshot {
  items: DashboardTodo[];
  status: 'loading' | 'local' | 'sync-ready' | 'pending' | 'unavailable' | 'error';
  migrationCount: number;
  problem: 'quota' | 'invalid' | 'conflict' | null;
}

export interface DashboardTodoRepository {
  readonly mode: 'local' | 'sync';
  snapshot(): TodoSnapshot;
  load(): Promise<void>;
  add(text: string): Promise<void>;
  setCompleted(id: string, completed: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  clearCompleted(): Promise<void>;
  migrateLegacy(): Promise<void>;
  retry(): Promise<void>;
  /** Reject on incomplete cleanup: callers must not acknowledge a successful reset. */
  clearAll(): Promise<void>;
  subscribe(listener: (snapshot: TodoSnapshot) => void): () => void;
  dispose(): void;
}

const todoRepositoryKey: InjectionKey<DashboardTodoRepository> = Symbol('dashboard-todos');

export function provideDashboardTodos(repository: DashboardTodoRepository): void {
  provide(todoRepositoryKey, repository);
}

export function useDashboardTodos(): DashboardTodoRepository | undefined {
  return inject(todoRepositoryKey, undefined);
}

export function browserTodoStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Web never discovers or uses chrome APIs, even when they exist on the page. */
export function createLocalTodoRepository(store = browserTodoStorage()): DashboardTodoRepository {
  let state: TodoSnapshot = { items: [], status: 'local', migrationCount: 0, problem: null };
  const listeners = new Set<(snapshot: TodoSnapshot) => void>();
  const snapshot = (): TodoSnapshot => structuredClone(state);
  const emit = (): void => {
    for (const listener of listeners) listener(snapshot());
  };
  const read = (): void => {
    try {
      if (!store) throw new Error('TODO_LOCAL_STORAGE_UNAVAILABLE');
      state = { ...state, items: loadDashboardTodos(store), status: 'local' };
    } catch {
      state.status = 'error';
    }
    emit();
  };
  const change = (update: (items: DashboardTodo[]) => DashboardTodo[]): Promise<void> => {
    // Re-read so two open Web tabs don't overwrite unrelated items from stale UI snapshots.
    if (state.status !== 'error') read();
    state.items = update(state.items);
    try {
      if (!store) throw new Error('TODO_LOCAL_STORAGE_UNAVAILABLE');
      saveDashboardTodos(store, state.items);
      state.status = 'local';
    } catch {
      state.status = 'error';
    }
    emit();
    return Promise.resolve();
  };
  const storageChanged = (event: StorageEvent): void => {
    if (event.key === DASHBOARD_TODOS_STORAGE_KEY || event.key === null) read();
  };
  // Browser hosts emit storage events; Node-based repository tests do not have this API.
  const events: Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>> = globalThis;
  events.addEventListener?.('storage', storageChanged);
  read();
  return {
    mode: 'local',
    snapshot,
    load: () => {
      read();
      return Promise.resolve();
    },
    add: (text) => change((items) => addDashboardTodo(items, text)),
    setCompleted: (id, completed) => change((items) => updateDashboardTodoCompletion(items, id, completed)),
    remove: (id) => change((items) => removeDashboardTodo(items, id)),
    clearCompleted: () => change(clearCompletedDashboardTodos),
    migrateLegacy: () => Promise.resolve(),
    retry: async () => {
      if (state.status === 'error') await change((items) => items);
      else read();
    },
    clearAll: () => {
      try {
        if (!store) throw new Error('TODO_LOCAL_STORAGE_UNAVAILABLE');
        store.removeItem(DASHBOARD_TODOS_STORAGE_KEY);
        state = { items: [], status: 'local', migrationCount: 0, problem: null };
        emit();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error('TODO_LOCAL_CLEAR_FAILED', { cause: error })
        );
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      listeners.clear();
      events.removeEventListener?.('storage', storageChanged);
    }
  };
}
