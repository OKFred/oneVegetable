export const DASHBOARD_TODOS_STORAGE_KEY = 'one-vegetable:dashboard-todos:v1';
export const DASHBOARD_TODO_MAX_ITEMS = 100;
export const DASHBOARD_TODO_MAX_TEXT_LENGTH = 200;

export interface DashboardTodo {
  id: string;
  text: string;
  completed: boolean;
  createTimeUtc: number;
  updateTimeUtc: number;
}

interface DashboardTodoDocument {
  version: 1;
  items: DashboardTodo[];
}

export function loadDashboardTodos(storage: Storage): DashboardTodo[] {
  const raw = storage.getItem(DASHBOARD_TODOS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items)) {
      storage.removeItem(DASHBOARD_TODOS_STORAGE_KEY);
      return [];
    }

    const ids = new Set<string>();
    return parsed.items
      .filter(isDashboardTodo)
      .filter((item) => {
        if (ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
      })
      .slice(0, DASHBOARD_TODO_MAX_ITEMS);
  } catch {
    storage.removeItem(DASHBOARD_TODOS_STORAGE_KEY);
    return [];
  }
}

export function saveDashboardTodos(storage: Storage, items: readonly DashboardTodo[]): void {
  const document: DashboardTodoDocument = {
    version: 1,
    items: items.slice(0, DASHBOARD_TODO_MAX_ITEMS)
  };
  storage.setItem(DASHBOARD_TODOS_STORAGE_KEY, JSON.stringify(document));
}

export function addDashboardTodo(
  items: readonly DashboardTodo[],
  text: string,
  now = Date.now(),
  id = createDashboardTodoId()
): DashboardTodo[] {
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.length > DASHBOARD_TODO_MAX_TEXT_LENGTH) return [...items];
  if (items.length >= DASHBOARD_TODO_MAX_ITEMS) return [...items];

  return [
    ...items,
    {
      id,
      text: normalizedText,
      completed: false,
      createTimeUtc: now,
      updateTimeUtc: now
    }
  ];
}

export function updateDashboardTodoCompletion(
  items: readonly DashboardTodo[],
  id: string,
  completed: boolean,
  now = Date.now()
): DashboardTodo[] {
  return items.map((item) => (item.id === id ? { ...item, completed, updateTimeUtc: now } : item));
}

export function removeDashboardTodo(items: readonly DashboardTodo[], id: string): DashboardTodo[] {
  return items.filter((item) => item.id !== id);
}

export function clearCompletedDashboardTodos(items: readonly DashboardTodo[]): DashboardTodo[] {
  return items.filter((item) => !item.completed);
}

function createDashboardTodoId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isDashboardTodo(value: unknown): value is DashboardTodo {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 100 &&
    typeof value.text === 'string' &&
    value.text.trim() === value.text &&
    value.text.length > 0 &&
    value.text.length <= DASHBOARD_TODO_MAX_TEXT_LENGTH &&
    typeof value.completed === 'boolean' &&
    isUnixEpochMilliseconds(value.createTimeUtc) &&
    isUnixEpochMilliseconds(value.updateTimeUtc) &&
    value.updateTimeUtc >= value.createTimeUtc
  );
}

function isUnixEpochMilliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
