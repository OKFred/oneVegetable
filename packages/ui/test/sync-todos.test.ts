import { afterEach, describe, expect, it } from 'vitest';
import {
  mockTodoLocalStorage,
  mockTodoSync,
  TODO_FIXTURE,
  TODO_TEXTS
} from '../../../mock/data/dashboard-todo-sync';
import {
  createSyncTodoRepository,
  TODO_SYNC_PREFIX,
  TODO_SYNC_RESET_KEY,
  TODO_SYNC_PENDING_PREFIX
} from '../src/lib/sync-todos';
import { createLocalTodoRepository, type DashboardTodoRepository } from '../src/lib/todo-repository';
import { DASHBOARD_TODOS_STORAGE_KEY, loadDashboardTodos, saveDashboardTodos } from '../src/lib/local-todos';

const repositories: DashboardTodoRepository[] = [];
function setup(cloud = mockTodoSync(), local = mockTodoLocalStorage(), client = 'a') {
  let counter = 0;
  const repository = createSyncTodoRepository({
    ...cloud,
    local,
    now: () => 200,
    id: () => `mock-${client}-${++counter}`
  });
  repositories.push(repository);
  return { cloud, local, repository };
}
function seed(cloud: ReturnType<typeof mockTodoSync>, id = TODO_FIXTURE.id) {
  const key = `${TODO_SYNC_PREFIX}item:initial:${id}`;
  cloud.data[key] = { version: 1, generation: 'initial', item: { ...TODO_FIXTURE, id } };
  return key;
}
afterEach(() => {
  repositories.splice(0).forEach((repo) => {
    repo.dispose();
  });
});

describe('dashboard Chrome sync repository (in-memory only)', () => {
  it('keeps Web local without touching the Chrome adapter', async () => {
    const cloud = mockTodoSync();
    const local = mockTodoLocalStorage();
    const repository = createLocalTodoRepository(local);
    repositories.push(repository);
    await repository.add(TODO_TEXTS[0]);
    expect(repository.mode).toBe('local');
    expect(loadDashboardTodos(local)).toHaveLength(1);
    expect(cloud.state.reads).toBe(0);
    expect(cloud.writes).toEqual([]);
  });

  it('restricts access before reads and fails closed when restriction fails', async () => {
    const { cloud, repository } = setup();
    cloud.state.accessFailure = true;
    await repository.load();
    await repository.add(TODO_TEXTS[0]);
    expect(cloud.state.prepares).toBeGreaterThan(0);
    expect(cloud.state.reads).toBe(0);
    expect(cloud.writes).toEqual([]);
    expect(repository.snapshot().status).toBe('pending');
  });

  it('writes independent small keys and preserves concurrent additions across clients', async () => {
    const { cloud, repository } = setup();
    const second = setup(cloud, mockTodoLocalStorage(), 'b').repository;
    await Promise.all([repository.load(), second.load()]);
    await Promise.all([repository.add(TODO_TEXTS[0]), second.add(TODO_TEXTS[1])]);
    await Promise.all([repository.load(), second.load()]);
    expect(repository.snapshot().items).toHaveLength(2);
    expect(second.snapshot().items).toHaveLength(2);
    for (const batch of cloud.writes) {
      expect(Object.keys(batch)).toHaveLength(1);
      for (const [key, value] of Object.entries(batch))
        expect(new TextEncoder().encode(key + JSON.stringify(value)).length).toBeLessThan(8192);
    }
  });

  it('consumes onChanged updates, ignores other areas, and unsubscribes', async () => {
    const { cloud, repository } = setup();
    await repository.load();
    let notifications = 0;
    const unsubscribe = repository.subscribe(() => {
      notifications++;
    });
    const key = seed(cloud);
    cloud.emit({ [key]: { newValue: cloud.data[key] } }, 'local');
    await Promise.resolve();
    expect(notifications).toBe(0);
    cloud.emit({ [key]: { newValue: cloud.data[key] } });
    await repository.load();
    expect(repository.snapshot().items).toHaveLength(1);
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
    repository.dispose();
    expect(cloud.listeners.size).toBe(0);
  });

  it('retains durable pending edits after quota failure and retries after reopening', async () => {
    const { cloud, local, repository } = setup();
    cloud.state.writeFailure = true;
    await repository.add(TODO_TEXTS[0]);
    expect(repository.snapshot()).toMatchObject({ status: 'pending', problem: 'quota' });
    expect(local.length).toBeGreaterThan(0);
    repository.dispose();
    cloud.state.writeFailure = false;
    const reopened = setup(cloud, local, 'b').repository;
    await reopened.load();
    expect(reopened.snapshot()).toMatchObject({ status: 'sync-ready', problem: null });
    expect(reopened.snapshot().items).toHaveLength(1);
    expect(
      Array.from({ length: local.length }, (_, i) => local.key(i)).filter((key) =>
        key?.startsWith(TODO_SYNC_PENDING_PREFIX)
      )
    ).toEqual([]);
  });

  it('reports unsaved changes when both local persistence and sync fail', async () => {
    const { cloud, local, repository } = setup();
    local.setItem = () => {
      throw new Error('MOCK_LOCAL_QUOTA');
    };
    cloud.state.writeFailure = true;
    await repository.add(TODO_TEXTS[0]);
    expect(repository.snapshot().items).toHaveLength(1);
    expect(repository.snapshot().status).toBe('error');
    cloud.state.writeFailure = false;
    await repository.retry();
    expect(repository.snapshot().status).toBe('sync-ready');
  });

  it('preflights total bytes including unrelated keys without modifying them', async () => {
    const { cloud, repository } = setup();
    cloud.data.unrelated = { setting: 'mock-only' };
    cloud.state.extraBytes = 102400;
    await repository.add(TODO_TEXTS[0]);
    expect(cloud.writes).toEqual([]);
    expect(repository.snapshot()).toMatchObject({ status: 'pending', problem: 'quota' });
    expect(cloud.data.unrelated).toEqual({ setting: 'mock-only' });
  });

  it('honors the Chrome key-count limit', async () => {
    const { cloud, repository } = setup();
    for (let i = 0; i < 512; i++) cloud.data[`mock-foreign-${i}`] = 0;
    await repository.add(TODO_TEXTS[0]);
    expect(cloud.writes).toEqual([]);
    expect(repository.snapshot().problem).toBe('quota');
  });

  it('loads legacy local data without automatically uploading or deleting it', async () => {
    const { cloud, local, repository } = setup();
    saveDashboardTodos(local, [TODO_FIXTURE]);
    const source = local.getItem(DASHBOARD_TODOS_STORAGE_KEY);
    await repository.load();
    expect(repository.snapshot().migrationCount).toBe(1);
    expect(cloud.writes).toEqual([]);
    expect(local.getItem(DASHBOARD_TODOS_STORAGE_KEY)).toBe(source);
  });

  it('migrates explicitly, strips non-todo fields, and only removes source after save', async () => {
    const { cloud, local, repository } = setup();
    local.setItem(
      DASHBOARD_TODOS_STORAGE_KEY,
      JSON.stringify({ version: 1, items: [{ ...TODO_FIXTURE, credential: 'mock-field-never-upload' }] })
    );
    cloud.state.writeFailure = true;
    await repository.migrateLegacy();
    expect(local.getItem(DASHBOARD_TODOS_STORAGE_KEY)).not.toBeNull();
    cloud.state.writeFailure = false;
    await repository.migrateLegacy();
    expect(repository.snapshot().items).toEqual([TODO_FIXTURE]);
    expect(local.getItem(DASHBOARD_TODOS_STORAGE_KEY)).toBeNull();
    expect(JSON.stringify(cloud.writes)).not.toContain('credential');
  });

  it('does not delete a changed legacy source during migration', async () => {
    const { cloud, local, repository } = setup();
    saveDashboardTodos(local, [TODO_FIXTURE]);
    cloud.state.beforeSet = () => {
      saveDashboardTodos(local, [{ ...TODO_FIXTURE, text: TODO_TEXTS[1] }]);
    };
    await repository.migrateLegacy();
    expect(loadDashboardTodos(local)[0]?.text).toBe(TODO_TEXTS[1]);
  });

  it('rejects invalid legacy/sync records without overwriting them', async () => {
    const { cloud, local, repository } = setup();
    local.setItem(DASHBOARD_TODOS_STORAGE_KEY, '{mock-broken');
    const badKey = `${TODO_SYNC_PREFIX}item:initial:bad`;
    cloud.data[badKey] = {
      version: 1,
      generation: 'initial',
      item: { ...TODO_FIXTURE, id: 'bad', completed: 'yes' }
    };
    await repository.load();
    await repository.migrateLegacy();
    expect(repository.snapshot()).toMatchObject({ items: [], problem: 'invalid' });
    expect(local.getItem(DASHBOARD_TODOS_STORAGE_KEY)).toBe('{mock-broken');
    expect(cloud.writes).toEqual([]);
    expect(cloud.data[badKey]).toBeDefined();
  });

  it('retains conflicting legacy items instead of silently replacing or deleting either copy', async () => {
    const { cloud, local, repository } = setup();
    seed(cloud);
    saveDashboardTodos(local, [{ ...TODO_FIXTURE, text: TODO_TEXTS[1] }]);
    await repository.migrateLegacy();
    expect(repository.snapshot().problem).toBe('conflict');
    expect(loadDashboardTodos(local)[0]?.text).toBe(TODO_TEXTS[1]);
    expect(repository.snapshot().items[0]?.text).toBe(TODO_FIXTURE.text);
    expect(cloud.writes).toEqual([]);
  });

  it('does not overwrite a malformed generation marker', async () => {
    const { cloud, repository } = setup();
    cloud.data[TODO_SYNC_RESET_KEY] = { version: 99 };
    await repository.add(TODO_TEXTS[0]);
    expect(cloud.writes).toEqual([]);
    expect(repository.snapshot().problem).toBe('invalid');
  });

  it('prevents a stale offline edit or legacy migration from resurrecting a deletion', async () => {
    const { cloud, repository } = setup();
    const key = seed(cloud);
    const otherLocal = mockTodoLocalStorage();
    const other = setup(cloud, otherLocal, 'b').repository;
    await Promise.all([repository.load(), other.load()]);
    cloud.state.writeFailure = true;
    await other.setCompleted(TODO_FIXTURE.id, true);
    cloud.state.writeFailure = false;
    await repository.remove(TODO_FIXTURE.id);
    // Even a late sync delivery on the old item key cannot beat its separate tombstone.
    await cloud.sync.set({ [key]: { version: 1, generation: 'initial', item: TODO_FIXTURE } });
    saveDashboardTodos(otherLocal, [TODO_FIXTURE]);
    await other.retry();
    await other.migrateLegacy();
    expect(other.snapshot().items).toEqual([]);
    await repository.load();
    expect(repository.snapshot().items).toEqual([]);
  });

  it('clears only todo keys, invalidates offline work, and keeps a content-free reset marker', async () => {
    const { cloud, repository, local } = setup();
    seed(cloud);
    cloud.data['mock-unrelated-preference'] = { value: 'keep' };
    local.setItem('mock-unrelated-local', 'keep');
    const other = setup(cloud, mockTodoLocalStorage(), 'b').repository;
    await other.load();
    cloud.state.writeFailure = true;
    await other.add(TODO_TEXTS[1]);
    cloud.state.writeFailure = false;
    await repository.clearAll();
    await other.retry();
    expect(other.snapshot().items).toEqual([]);
    expect(Object.keys(cloud.data).filter((key) => key.startsWith(TODO_SYNC_PREFIX))).toEqual([
      TODO_SYNC_RESET_KEY
    ]);
    expect(JSON.stringify(cloud.data[TODO_SYNC_RESET_KEY])).not.toContain(TODO_FIXTURE.text);
    expect(cloud.data['mock-unrelated-preference']).toEqual({ value: 'keep' });
    expect(local.getItem('mock-unrelated-local')).toBe('keep');
    await repository.add(TODO_TEXTS[2]);
    expect(repository.snapshot().items).toHaveLength(1);
  });

  it('ignores stale in-flight writes after full reset, including a cold reopened client', async () => {
    const { cloud, repository } = setup();
    const key = seed(cloud);
    const oldRecord = cloud.data[key];
    await repository.clearAll();
    await cloud.sync.set({ [key]: oldRecord });
    const reopened = setup(cloud, mockTodoLocalStorage(), 'c').repository;
    await reopened.load();
    expect(reopened.snapshot().items).toEqual([]);
  });

  it('rejects failed full cleanup and keeps legacy data if the reset was not saved', async () => {
    const { cloud, local, repository } = setup();
    saveDashboardTodos(local, [TODO_FIXTURE]);
    cloud.state.writeFailure = true;
    await expect(repository.clearAll()).rejects.toThrow('TODO_SYNC_CLEAR_FAILED');
    expect(loadDashboardTodos(local)).toEqual([TODO_FIXTURE]);
    cloud.state.writeFailure = false;
    seed(cloud);
    cloud.state.removeFailure = true;
    await expect(repository.clearAll()).rejects.toThrow('TODO_SYNC_CLEAR_FAILED');
  });

  it('enforces text and item limits without silently truncating concurrent remote items', async () => {
    const { cloud, repository } = setup();
    await repository.add(' ');
    await repository.add('x'.repeat(201));
    expect(cloud.writes).toEqual([]);
    for (let i = 0; i < 101; i++) seed(cloud, `mock-item-${i}`);
    await repository.load();
    expect(repository.snapshot().items).toHaveLength(101);
    await repository.add(TODO_TEXTS[0]);
    expect(cloud.writes).toEqual([]);
  });
});
