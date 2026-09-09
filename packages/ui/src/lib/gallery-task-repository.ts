import {
  GalleryTaskError,
  GALLERY_TASK_LIMIT,
  GALLERY_TASK_RETENTION_MS,
  galleryTaskTerminal,
  validateGalleryTransferTask,
  type GalleryTransferTaskRepository,
  type GalleryTransferTaskV1
} from '@one-vegetable/core/gallery-transfer-task';

export const GALLERY_TASK_DATABASE = 'one-vegetable-gallery-transfers-v1';
export class IndexedDbGalleryTaskRepository implements GalleryTransferTaskRepository {
  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly now: () => number = Date.now
  ) {}
  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new GalleryTaskError('GALLERY_TASK_STORAGE'));
    const factory = this.factory;
    return new Promise((resolve, reject) => {
      const request = factory.open(GALLERY_TASK_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('tasks', { keyPath: 'id' });
        request.result.createObjectStore('quarantine', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new GalleryTaskError('GALLERY_TASK_STORAGE'));
      };
      request.onblocked = () => {
        reject(new GalleryTaskError('GALLERY_TASK_STORAGE'));
      };
    });
  }
  private async transaction<T>(
    run: (store: IDBObjectStore, tx: IDBTransaction, result: (value: T) => void) => void
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['tasks', 'quarantine'], 'readwrite');
      let value: T;
      let ready = false;
      tx.oncomplete = () => {
        db.close();
        if (ready) resolve(value);
        else reject(new GalleryTaskError('GALLERY_TASK_STORAGE'));
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(new GalleryTaskError('GALLERY_TASK_STORAGE'));
      };
      try {
        run(tx.objectStore('tasks'), tx, (result) => {
          value = result;
          ready = true;
        });
      } catch (error) {
        tx.abort();
        reject(error instanceof Error ? error : new GalleryTaskError('GALLERY_TASK_STORAGE'));
      }
    });
  }
  async list(): Promise<GalleryTransferTaskV1[]> {
    return this.transaction((store, tx, done) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const tasks: GalleryTransferTaskV1[] = [];
        const values: unknown[] = request.result;
        for (const value of values) {
          try {
            const task = validateGalleryTransferTask(value);
            if (galleryTaskTerminal(task) && task.updateTimeUtc < this.now() - GALLERY_TASK_RETENTION_MS)
              store.delete(task.id);
            else tasks.push(task);
          } catch {
            // Keep only a tombstone, not potentially sensitive malformed data.
            if (
              typeof value === 'object' &&
              value !== null &&
              'id' in value &&
              typeof value.id === 'string'
            ) {
              store.delete(value.id);
              tx.objectStore('quarantine').put({
                id: value.id,
                time: this.now(),
                code: 'GALLERY_TASK_INVALID'
              });
            }
          }
        }
        done(tasks.sort((a, b) => b.updateTimeUtc - a.updateTimeUtc));
      };
    });
  }
  async get(id: string): Promise<GalleryTransferTaskV1> {
    return this.transaction((store, tx, done) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          done(validateGalleryTransferTask(request.result));
        } catch {
          tx.abort();
        }
      };
    });
  }
  async create(task: GalleryTransferTaskV1): Promise<void> {
    validateGalleryTransferTask(task);
    await this.list();
    return this.transaction((store, tx, done) => {
      const count = store.count();
      count.onsuccess = () => {
        if (count.result >= GALLERY_TASK_LIMIT) {
          tx.abort();
          return;
        }
        store.add(task);
        done(undefined);
      };
    });
  }
  async update(id: string, change: (task: GalleryTransferTaskV1) => void): Promise<GalleryTransferTaskV1> {
    return this.transaction((store, tx, done) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const task = validateGalleryTransferTask(request.result);
          change(task);
          task.updateTimeUtc = this.now();
          task.revision += 1;
          store.put(validateGalleryTransferTask(task));
          done(task);
        } catch {
          tx.abort();
        }
      };
    });
  }
  async remove(id: string): Promise<void> {
    return this.transaction((store, tx, done) => {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const task = validateGalleryTransferTask(request.result);
          if (task.status === 'running') {
            tx.abort();
            return;
          }
          store.delete(id);
          done(undefined);
        } catch {
          tx.abort();
        }
      };
    });
  }
}
