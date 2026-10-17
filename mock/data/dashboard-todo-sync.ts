import type { TodoStorageChanges, TodoSyncStorage } from '../../packages/ui/src/lib/sync-todos';
import type { DashboardTodo } from '../../packages/ui/src/lib/local-todos';

export const TODO_FIXTURE: DashboardTodo = {
  id: 'mock-todo-one',
  text: 'Review mock product',
  completed: false,
  createTimeUtc: 100,
  updateTimeUtc: 100
};
export const TODO_TEXTS = ['Review mock product', 'Review mock order', 'Review mock photo'] as const;

export function mockTodoLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
}

/** Entirely in-memory Chrome stand-in. No extension API or network access. */
export function mockTodoSync() {
  type Listener = Parameters<TodoStorageChanges['addListener']>[0];
  const listeners = new Set<Listener>();
  const data: Record<string, unknown> = {};
  const writes: Record<string, unknown>[] = [];
  const removed: string[][] = [];
  const state = {
    readFailure: false,
    writeFailure: false,
    removeFailure: false,
    accessFailure: false,
    extraBytes: 0,
    prepares: 0,
    reads: 0,
    beforeSet: undefined as (() => void | Promise<void>) | undefined
  };
  const emit = (event: Parameters<Listener>[0], area = 'sync'): void => {
    for (const listener of listeners) listener(event, area);
  };
  const sync: TodoSyncStorage = {
    get(keys) {
      state.reads++;
      if (state.readFailure) return Promise.reject(new Error('MOCK_READ_UNAVAILABLE'));
      if (keys === null) return Promise.resolve(structuredClone(data));
      return Promise.resolve(
        structuredClone(
          Object.fromEntries(
            (typeof keys === 'string' ? [keys] : keys)
              .filter((key) => key in data)
              .map((key) => [key, data[key]])
          )
        )
      );
    },
    async set(batch) {
      await state.beforeSet?.();
      if (state.writeFailure) throw new Error('MOCK_QUOTA_WRITE_RATE');
      const event: Parameters<Listener>[0] = {};
      for (const [key, value] of Object.entries(batch)) {
        event[key] = { oldValue: data[key], newValue: value };
        data[key] = structuredClone(value);
      }
      writes.push(structuredClone(batch));
      emit(event);
    },
    remove(keys) {
      if (state.removeFailure) return Promise.reject(new Error('MOCK_REMOVE_UNAVAILABLE'));
      const event: Parameters<Listener>[0] = {};
      for (const key of keys) {
        event[key] = { oldValue: data[key] };
        Reflect.deleteProperty(data, key);
      }
      removed.push([...keys]);
      emit(event);
      return Promise.resolve();
    },
    getBytesInUse() {
      return Promise.resolve(
        state.extraBytes +
          Object.entries(data).reduce(
            (sum, [key, value]) => sum + new TextEncoder().encode(key + JSON.stringify(value)).length,
            0
          )
      );
    }
  };
  const changes: TodoStorageChanges = {
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    }
  };
  const prepare = (): Promise<void> => {
    state.prepares++;
    if (state.accessFailure) return Promise.reject(new Error('MOCK_ACCESS_LEVEL_UNAVAILABLE'));
    return Promise.resolve();
  };
  return { sync, changes, prepare, state, data, writes, removed, emit, listeners };
}
