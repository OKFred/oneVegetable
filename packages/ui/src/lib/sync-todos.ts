import {
  createDashboardTodoId,
  DASHBOARD_TODO_MAX_ITEMS,
  DASHBOARD_TODO_MAX_TEXT_LENGTH,
  DASHBOARD_TODOS_STORAGE_KEY,
  isDashboardTodo,
  type DashboardTodo
} from './local-todos';
import type { DashboardTodoRepository, TodoSnapshot } from './todo-repository';

export const TODO_SYNC_PREFIX = 'one-vegetable:dashboard-todos:sync:v1:';
export const TODO_SYNC_RESET_KEY = `${TODO_SYNC_PREFIX}generation`;
export const TODO_SYNC_CACHE_KEY = 'one-vegetable:dashboard-todos:sync-cache:v1';
export const TODO_SYNC_PENDING_PREFIX = 'one-vegetable:dashboard-todos:pending:v1:';
const INITIAL_GENERATION = 'initial';
const MAX_BYTES = 102_400;
const MAX_ITEM_BYTES = 8_192;
const MAX_KEYS = 512;

export interface TodoSyncStorage {
  get(keys: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  getBytesInUse(keys: null): Promise<number>;
}
type ChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string
) => void;
export interface TodoStorageChanges {
  addListener(listener: ChangeListener): void;
  removeListener(listener: ChangeListener): void;
}
interface ItemRecord {
  version: 1;
  generation: string;
  item: DashboardTodo;
}
interface DeleteRecord {
  version: 1;
  generation: string;
  id: string;
  deleted: true;
}
type TodoRecord = ItemRecord | DeleteRecord;
interface SyncOptions {
  sync: TodoSyncStorage;
  changes: TodoStorageChanges;
  local?: Storage;
  /** Must establish TRUSTED_CONTEXTS before any sync access; failure stays local. */
  prepare: () => Promise<void>;
  now?: () => number;
  id?: () => string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function generation(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
function itemKey(epoch: string, id: string): string {
  return `${TODO_SYNC_PREFIX}item:${epoch}:${encodeURIComponent(id)}`;
}
function deleteKey(epoch: string, id: string): string {
  return `${TODO_SYNC_PREFIX}deleted:${epoch}:${encodeURIComponent(id)}`;
}
function plainTodo(item: DashboardTodo): DashboardTodo {
  // Never spread imported data: legacy records may contain fields that must not leave this device.
  return {
    id: item.id,
    text: item.text,
    completed: item.completed,
    createTimeUtc: item.createTimeUtc,
    updateTimeUtc: item.updateTimeUtc
  };
}
function record(key: string, value: unknown): TodoRecord | undefined {
  if (!object(value) || value.version !== 1 || !generation(value.generation)) return;
  if (isDashboardTodo(value.item) && key === itemKey(value.generation, value.item.id)) {
    return { version: 1, generation: value.generation, item: plainTodo(value.item) };
  }
  if (
    value.deleted === true &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 100 &&
    key === deleteKey(value.generation, value.id)
  ) {
    return { version: 1, generation: value.generation, id: value.id, deleted: true };
  }
  return undefined;
}
function bytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}
function pendingKey(key: string): string {
  return TODO_SYNC_PENDING_PREFIX + key;
}

/** Per-item writes, separate permanent tombstones, and reset generations; no full-list sync writes.
 * Same-item edits use Chrome's last write; deletes win independently of edit timestamps.
 * Tombstones are retained until clearAll rotates the generation. Quota errors remain explicit.
 */
export function createSyncTodoRepository(options: SyncOptions): DashboardTodoRepository {
  const { sync, local, changes } = options;
  const now = options.now ?? Date.now;
  const newId = options.id ?? createDashboardTodoId;
  let epoch = INITIAL_GENERATION;
  let remote: Record<string, TodoRecord> = {};
  let remoteRaw: Record<string, unknown> = {};
  let pending: Record<string, TodoRecord> = {};
  const volatile = new Map<string, TodoRecord>();
  let status: TodoSnapshot['status'] = 'loading';
  let problem: TodoSnapshot['problem'] = null;
  let available = false;
  let journalReadable = true;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<(snapshot: TodoSnapshot) => void>();

  function localKeys(): string[] {
    if (!local) return [];
    return Array.from({ length: local.length }, (_, i) => local.key(i)).filter(
      (key): key is string => key !== null
    );
  }
  function legacy(): { raw: string | null; items: DashboardTodo[]; valid: boolean } {
    try {
      const raw = local?.getItem(DASHBOARD_TODOS_STORAGE_KEY) ?? null;
      if (!raw) return { raw, items: [], valid: true };
      const value: unknown = JSON.parse(raw);
      if (
        !object(value) ||
        value.version !== 1 ||
        !Array.isArray(value.items) ||
        !value.items.every(isDashboardTodo) ||
        value.items.length > DASHBOARD_TODO_MAX_ITEMS ||
        new Set(value.items.map((item) => item.id)).size !== value.items.length
      ) {
        return { raw, items: [], valid: false };
      }
      return { raw, items: value.items.map(plainTodo), valid: true };
    } catch {
      return { raw: null, items: [], valid: false };
    }
  }
  function readPending(): void {
    pending = {};
    journalReadable = true;
    try {
      for (const key of localKeys().filter((key) => key.startsWith(TODO_SYNC_PENDING_PREFIX))) {
        const syncKey = key.slice(TODO_SYNC_PENDING_PREFIX.length);
        let value: unknown;
        try {
          const raw = local?.getItem(key);
          if (raw === null || raw === undefined) continue;
          value = JSON.parse(raw);
        } catch {
          problem = 'invalid';
          continue;
        }
        const parsed = record(syncKey, value);
        if (parsed?.generation === epoch) pending[syncKey] = parsed;
        else if (parsed && available) local?.removeItem(key);
        else if (!parsed) problem = 'invalid';
      }
    } catch {
      journalReadable = false;
      status = 'error';
    }
    for (const [key, value] of volatile) {
      if (value.generation === epoch) pending[key] = value;
      else if (available) volatile.delete(key);
    }
  }
  function items(): DashboardTodo[] {
    const values = { ...remote, ...pending };
    return Object.values(values)
      .filter(
        (value): value is ItemRecord =>
          'item' in value && value.generation === epoch && !values[deleteKey(epoch, value.item.id)]
      )
      .map((value) => ({ ...value.item }))
      .sort((a, b) => a.createTimeUtc - b.createTimeUtc || a.id.localeCompare(b.id));
  }
  function snapshot(): TodoSnapshot {
    return {
      items: items(),
      status,
      problem,
      migrationCount: epoch === INITIAL_GENERATION ? legacy().items.length : 0
    };
  }
  function emit(): void {
    if (!disposed) {
      for (const listener of listeners) listener(snapshot());
    }
  }
  function serial(action: () => Promise<void>): Promise<void> {
    const result = queue.then(async () => {
      if (!disposed) await action();
    });
    queue = result.catch(() => undefined);
    return result;
  }
  function failure(error: unknown): void {
    if (error instanceof Error && /QUOTA|MAX_WRITE|MAX_ITEMS/i.test(error.message)) problem = 'quota';
    status =
      !journalReadable || volatile.size > 0
        ? 'error'
        : Object.keys(pending).length
          ? 'pending'
          : 'unavailable';
  }
  function settled(): void {
    status =
      !journalReadable || volatile.size > 0
        ? 'error'
        : Object.keys(pending).length
          ? 'pending'
          : available
            ? 'sync-ready'
            : 'unavailable';
  }
  function cache(): void {
    try {
      local?.setItem(TODO_SYNC_CACHE_KEY, JSON.stringify({ version: 1, generation: epoch, records: remote }));
    } catch {
      /* A cache failure does not undo an acknowledged sync-storage write. */
    }
  }
  function remember(key: string, value: TodoRecord): void {
    pending[key] = value;
    try {
      if (!local) throw new Error('TODO_LOCAL_STORAGE_UNAVAILABLE');
      local.setItem(pendingKey(key), JSON.stringify(value));
      volatile.delete(key);
    } catch {
      volatile.set(key, value);
    }
  }
  function forget(key: string, value: TodoRecord): void {
    const serialized = JSON.stringify(value);
    try {
      // Do not erase an edit another tab queued while the async write was in flight.
      if (local?.getItem(pendingKey(key)) === serialized) local.removeItem(pendingKey(key));
    } catch {
      /* Safe to replay an acknowledged per-item write. */
    }
    if (JSON.stringify(volatile.get(key)) === serialized) volatile.delete(key);
    pending = Object.fromEntries(Object.entries(pending).filter(([entryKey]) => entryKey !== key));
  }
  async function refresh(): Promise<boolean> {
    try {
      await options.prepare();
      const data = await sync.get(null);
      const reset = data[TODO_SYNC_RESET_KEY];
      if (reset !== undefined && (!object(reset) || reset.version !== 1 || !generation(reset.generation))) {
        problem = 'invalid';
        throw new Error('TODO_INVALID_GENERATION');
      }
      epoch = object(reset) ? (reset.generation as string) : INITIAL_GENERATION;
      remoteRaw = data;
      remote = {};
      problem = null;
      for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith(TODO_SYNC_PREFIX) || key === TODO_SYNC_RESET_KEY) continue;
        const parsed = record(key, value);
        if (!parsed) problem = 'invalid';
        else if (parsed.generation === epoch) remote[key] = parsed;
      }
      available = true;
      // A successful reset invalidates pre-reset pending work and legacy migration on all devices.
      if (epoch !== INITIAL_GENERATION) local?.removeItem(DASHBOARD_TODOS_STORAGE_KEY);
      readPending();
      if (!legacy().valid) problem = 'invalid';
      cache();
      settled();
      return true;
    } catch (error) {
      available = false;
      readPending();
      failure(error);
      return false;
    }
  }
  async function save(batch: Record<string, TodoRecord>): Promise<void> {
    const entries = Object.entries(batch);
    if (!entries.length) return;
    const total = await sync.getBytesInUse(null);
    let projected = total;
    let count = Object.keys(remoteRaw).length;
    for (const [key, value] of entries) {
      const size = bytes(key, value);
      if (size > MAX_ITEM_BYTES) throw new Error('TODO_QUOTA_BYTES_PER_ITEM');
      projected += size - (key in remoteRaw ? bytes(key, remoteRaw[key]) : 0);
      if (!(key in remoteRaw)) count += 1;
    }
    // Leave room for a content-free reset marker even when our own records approach quota.
    if (projected > MAX_BYTES - 512 || count > MAX_KEYS - Number(!(TODO_SYNC_RESET_KEY in remoteRaw)))
      throw new Error('TODO_QUOTA_BYTES_OR_ITEMS');
    // Chrome remains the final authority when another context races this preflight.
    await sync.set(batch);
    for (const [key, value] of entries) {
      remote[key] = value;
      remoteRaw[key] = value;
      forget(key, value);
    }
    cache();
  }
  async function flush(): Promise<void> {
    if (!available) return;
    const batch: Record<string, TodoRecord> = {};
    for (const [key, value] of Object.entries(pending)) {
      if (
        'item' in value &&
        (remote[deleteKey(epoch, value.item.id)] || pending[deleteKey(epoch, value.item.id)])
      ) {
        forget(key, value);
        continue;
      }
      batch[key] = value;
    }
    try {
      await save(batch);
      // Keep tombstones but remove deleted text. A late old write is still hidden by the tombstone.
      const deletedItems = Object.values(remote)
        .filter((value): value is DeleteRecord => 'deleted' in value)
        .map((value) => itemKey(value.generation, value.id))
        .filter((key) => key in remoteRaw);
      if (deletedItems.length) {
        await sync.remove(deletedItems);
        const deletedKeys = new Set(deletedItems);
        remote = Object.fromEntries(Object.entries(remote).filter(([key]) => !deletedKeys.has(key)));
        remoteRaw = Object.fromEntries(Object.entries(remoteRaw).filter(([key]) => !deletedKeys.has(key)));
        cache();
      }
      readPending();
      settled();
    } catch (error) {
      failure(error);
    }
  }
  function mutate(change: () => void): Promise<void> {
    return serial(async () => {
      await refresh();
      change();
      settled();
      emit();
      await flush();
      emit();
    });
  }
  function erase(id: string): void {
    remember(deleteKey(epoch, id), { version: 1, generation: epoch, id, deleted: true });
  }
  const onChanged: ChangeListener = (event, area) => {
    if (area !== 'sync' || !Object.keys(event).some((key) => key.startsWith(TODO_SYNC_PREFIX))) return;
    // Never replay cached snapshots or automatically retry failed writes on an event loop.
    void serial(async () => {
      await refresh();
      emit();
    });
  };
  changes.addListener(onChanged);
  try {
    const cached: unknown = JSON.parse(local?.getItem(TODO_SYNC_CACHE_KEY) ?? 'null');
    if (object(cached) && cached.version === 1 && generation(cached.generation) && object(cached.records)) {
      epoch = cached.generation;
      for (const [key, value] of Object.entries(cached.records)) {
        const parsed = record(key, value);
        if (parsed?.generation === epoch) remote[key] = parsed;
      }
    }
  } catch {
    /* Invalid caches never become sync writes. */
  }
  readPending();

  return {
    mode: 'sync',
    snapshot,
    load: () =>
      serial(async () => {
        await refresh();
        await flush();
        emit();
      }),
    retry: () =>
      serial(async () => {
        await refresh();
        await flush();
        emit();
      }),
    add: (text) =>
      mutate(() => {
        const normalized = text.trim();
        if (
          !normalized ||
          normalized.length > DASHBOARD_TODO_MAX_TEXT_LENGTH ||
          items().length >= DASHBOARD_TODO_MAX_ITEMS
        )
          return;
        const id = newId();
        if (
          remote[itemKey(epoch, id)] ||
          pending[itemKey(epoch, id)] ||
          remote[deleteKey(epoch, id)] ||
          pending[deleteKey(epoch, id)]
        )
          return;
        const time = now();
        const item = { id, text: normalized, completed: false, createTimeUtc: time, updateTimeUtc: time };
        if (isDashboardTodo(item)) remember(itemKey(epoch, id), { version: 1, generation: epoch, item });
      }),
    setCompleted: (id, completed) =>
      mutate(() => {
        const item = items().find((item) => item.id === id);
        if (!item) return;
        remember(itemKey(epoch, id), {
          version: 1,
          generation: epoch,
          item: { ...item, completed, updateTimeUtc: Math.max(now(), item.updateTimeUtc) }
        });
      }),
    remove: (id) =>
      mutate(() => {
        if (items().some((item) => item.id === id)) erase(id);
      }),
    clearCompleted: () =>
      mutate(() => {
        for (const item of items()) {
          if (item.completed) erase(item.id);
        }
      }),
    migrateLegacy: () =>
      serial(async () => {
        if (!(await refresh()) || epoch !== INITIAL_GENERATION || problem) {
          emit();
          return;
        }
        const source = legacy();
        if (!source.valid || !source.raw) {
          emit();
          return;
        }
        const batch: Record<string, TodoRecord> = {};
        const current = { ...remote, ...pending };
        for (const item of source.items) {
          const existing = current[itemKey(epoch, item.id)];
          if (
            existing &&
            'item' in existing &&
            !current[deleteKey(epoch, item.id)] &&
            JSON.stringify(existing.item) !== JSON.stringify(item)
          ) {
            problem = 'conflict';
            emit();
            return;
          }
          if (current[itemKey(epoch, item.id)] || current[deleteKey(epoch, item.id)]) continue;
          batch[itemKey(epoch, item.id)] = { version: 1, generation: epoch, item };
        }
        if (items().length + Object.keys(batch).length > DASHBOARD_TODO_MAX_ITEMS) {
          problem = 'quota';
          status = 'unavailable';
          emit();
          return;
        }
        try {
          // Explicit migration is atomic from our perspective: leave the legacy source untouched on failure.
          await save(batch);
          if (Object.keys(pending).length) {
            settled();
            emit();
            return;
          }
          if (local?.getItem(DASHBOARD_TODOS_STORAGE_KEY) === source.raw)
            local.removeItem(DASHBOARD_TODOS_STORAGE_KEY);
          settled();
        } catch (error) {
          failure(error);
        }
        emit();
      }),
    clearAll: () =>
      serial(async () => {
        if (!(await refresh())) {
          emit();
          throw new Error('TODO_SYNC_CLEAR_UNAVAILABLE');
        }
        const next = newId();
        if (!generation(next) || next === epoch) throw new Error('TODO_INVALID_GENERATION');
        try {
          // Keep only this non-content reset marker. Old offline items cannot become visible again.
          await sync.set({ [TODO_SYNC_RESET_KEY]: { version: 1, generation: next } });
          epoch = next;
          remote = {};
          pending = {};
          volatile.clear();
          const data = await sync.get(null);
          const obsolete = Object.keys(data).filter(
            (key) =>
              key.startsWith(TODO_SYNC_PREFIX) &&
              key !== TODO_SYNC_RESET_KEY &&
              record(key, data[key])?.generation !== next
          );
          if (obsolete.length) await sync.remove(obsolete);
          for (const key of localKeys()) {
            if (
              key === DASHBOARD_TODOS_STORAGE_KEY ||
              key === TODO_SYNC_CACHE_KEY ||
              key.startsWith(TODO_SYNC_PENDING_PREFIX)
            )
              local?.removeItem(key);
          }
          status = 'sync-ready';
          problem = null;
          emit();
        } catch (error) {
          failure(error);
          emit();
          throw new Error('TODO_SYNC_CLEAR_FAILED', { cause: error });
        }
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      changes.removeListener(onChanged);
      listeners.clear();
    }
  };
}
