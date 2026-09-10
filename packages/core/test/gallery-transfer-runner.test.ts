import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/gallery-transfer-task.json';
import { GalleryTransferRunner, type GalleryTransferDriver } from '../src/gallery-transfer-runner';
import {
  validateGalleryTransferTask,
  recoverGalleryTask,
  type GalleryTransferTaskRepository,
  type GalleryTransferTaskV1
} from '../src/gallery-transfer-task';

class Repository implements GalleryTransferTaskRepository {
  task = validateGalleryTransferTask(structuredClone(fixture));
  failRunning = false;
  list() {
    return Promise.resolve([structuredClone(this.task)]);
  }
  get() {
    return Promise.resolve(structuredClone(this.task));
  }
  create(task: GalleryTransferTaskV1) {
    this.task = structuredClone(task);
    return Promise.resolve();
  }
  update(_id: string, change: (task: GalleryTransferTaskV1) => void) {
    const next = structuredClone(this.task);
    change(next);
    if (this.failRunning && next.items.some((i) => i.status === 'running')) throw new Error('quota');
    this.task = next;
    return Promise.resolve(structuredClone(next));
  }
  remove() {
    return Promise.resolve();
  }
}
function setup() {
  const repository = new Repository();
  let calls = 0;
  const driver: GalleryTransferDriver = {
    context() {
      return Promise.resolve(repository.task.context);
    },
    prepare(_task, item) {
      return Promise.resolve(item);
    },
    execute(_task, item) {
      expect(repository.task.items[0]?.status).toBe('running');
      calls++;
      return Promise.resolve({ ...item, status: 'unconfirmed', fileId: 'photo-result' });
    },
    verify(_task, item) {
      return Promise.resolve({ ...item, status: 'confirmed' });
    },
    release() {
      return;
    }
  };
  const runner = new GalleryTransferRunner(repository, driver, async (action) => {
    await action();
    return true;
  });
  return { repository, driver, runner, calls: () => calls };
}
describe('durable gallery runner', () => {
  it('commits before mutation and never repeats success', async () => {
    const s = setup();
    await s.runner.run('task-test');
    await s.runner.run('task-test');
    expect(s.calls()).toBe(1);
    expect(s.repository.task.status).toBe('completed');
  });
  it('does not send when running marker cannot persist', async () => {
    const s = setup();
    s.repository.failRunning = true;
    await s.runner.run('task-test');
    expect(s.calls()).toBe(0);
  });
  it('never retries an unknown mutation', async () => {
    const s = setup();
    s.driver.execute = () => Promise.reject(new Error('timeout'));
    s.driver.verify = (_t, i) => Promise.resolve(i);
    await s.runner.run('task-test');
    expect(s.repository.task.items[0]?.status).toBe('unknown');
    let sends = 0;
    s.driver.execute = (_t, i) => {
      sends++;
      return Promise.resolve(i);
    };
    await s.runner.run('task-test');
    expect(sends).toBe(0);
    expect(s.repository.task.status).toBe('attention');
  });
  it('recovers in-flight writes as unknown and requires manual run', async () => {
    const s = setup();
    s.repository.task.status = 'running';
    if (s.repository.task.items[0]) s.repository.task.items[0].status = 'running';
    await s.runner.recover();
    expect(s.repository.task.status).toBe('paused');
    expect(s.repository.task.items[0]?.status).toBe('unknown');
    expect(s.calls()).toBe(0);
  });
  it('pauses during preparation without sending', async () => {
    const s = setup();
    s.driver.prepare = async (_t, i) => {
      await s.runner.command('task-test', 'pause');
      return i;
    };
    await s.runner.run('task-test');
    expect(s.calls()).toBe(0);
    expect(s.repository.task.status).toBe('paused');
  });
  it('rejects context changes before execution', async () => {
    const s = setup();
    s.driver.context = () => Promise.resolve({ ...s.repository.task.context, gateway: 'other' });
    await expect(s.runner.run('task-test')).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(s.calls()).toBe(0);
  });
  it('does not acquire or normalize another window task', async () => {
    const s = setup();
    const other = new GalleryTransferRunner(s.repository, s.driver, () => Promise.resolve(false));
    await expect(other.run('task-test')).rejects.toThrow('GALLERY_TASK_BUSY');
    expect(s.calls()).toBe(0);
  });
  it('rejects unknown fields and signed URLs in persisted input', () => {
    expect(() => validateGalleryTransferTask({ ...fixture, token: 'secret' })).toThrow();
    const bad = structuredClone(fixture);
    Object.assign(bad.items[0] ?? {}, { sourceUrl: 'https://example.com/a?token=secret' });
    expect(() => validateGalleryTransferTask(bad)).toThrow();
  });
  it('does not normalize confirmed receipts on recovery', () => {
    const s = setup();
    if (s.repository.task.items[0]) s.repository.task.items[0].status = 'unconfirmed';
    expect(recoverGalleryTask(s.repository.task).items[0]?.status).toBe('unconfirmed');
  });
});
