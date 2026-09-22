import {
  parseVideoUploadRecord,
  type VideoUploadRecord,
  type VideoUploadRepository
} from '@one-vegetable/core/video-upload-service';
import { videoUploadFail } from '@one-vegetable/core/video-upload';

export const VIDEO_UPLOAD_DATABASE = 'one-vegetable-video-uploads-v1';
export class ExtensionVideoUploadRepository implements VideoUploadRepository {
  /** Explicit clear-local-data only; never sends abort/delete requests to any remote provider. */
  async clearAll(): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('tasks', 'readwrite');
        const store = transaction.objectStore('tasks');
        const request = store.getAll();
        let active = false;
        request.onsuccess = () => {
          try {
            const raw: unknown = request.result;
            if (!Array.isArray(raw)) throw new Error('VIDEO_TASK_CORRUPT');
            active = raw.some(
              (item: unknown) => (parseVideoUploadRecord(item).busy?.until ?? 0) > Date.now()
            );
            if (active) transaction.abort();
            else store.clear();
          } catch {
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = transaction.onerror = () => {
          reject(new Error(active ? 'VIDEO_TASK_BUSY' : 'VIDEO_TASK_STORAGE_FAILED'));
        };
      });
    } finally {
      db.close();
    }
  }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(VIDEO_UPLOAD_DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('tasks', { keyPath: 'task.id' });
        store.createIndex('ownerId', 'ownerId');
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('VIDEO_TASK_STORAGE_FAILED'));
      };
      request.onblocked = () => {
        reject(new Error('VIDEO_TASK_STORAGE_FAILED'));
      };
    });
  }
  async get(id: string, ownerId: string): Promise<VideoUploadRecord | null> {
    const db = await this.open();
    try {
      const raw = await read(db.transaction('tasks').objectStore('tasks').get(id));
      if (raw === undefined) return null;
      const result = parseVideoUploadRecord(raw);
      return result.ownerId === ownerId ? result : null;
    } finally {
      db.close();
    }
  }
  async list(ownerId: string): Promise<VideoUploadRecord[]> {
    const db = await this.open();
    try {
      const raw = await read(
        db.transaction('tasks').objectStore('tasks').index('ownerId').getAll(ownerId, 100)
      );
      if (!Array.isArray(raw)) videoUploadFail('VIDEO_TASK_STORAGE_FAILED');
      return raw
        .map((value: unknown) => parseVideoUploadRecord(value))
        .sort((a, b) => b.task.updateTimeUtc - a.task.updateTimeUtc);
    } finally {
      db.close();
    }
  }
  async save(record: VideoUploadRecord, expectedRevision: number | null): Promise<void> {
    parseVideoUploadRecord(record);
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('tasks', 'readwrite');
        const store = transaction.objectStore('tasks');
        let conflict = false;
        const request = store.get(record.task.id);
        request.onsuccess = () => {
          const current: unknown = request.result;
          try {
            if (
              (current === undefined ? null : parseVideoUploadRecord(current).task.revision) !==
              expectedRevision
            ) {
              conflict = true;
              transaction.abort();
              return;
            }
            store.put(structuredClone(record));
          } catch {
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = transaction.onerror = () => {
          reject(new Error(conflict ? 'ENTITY_VERSION_CONFLICT' : 'VIDEO_TASK_STORAGE_FAILED'));
        };
      });
    } finally {
      db.close();
    }
  }
}
function read(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result as unknown);
    };
    request.onerror = () => {
      reject(new Error('VIDEO_TASK_STORAGE_FAILED'));
    };
  });
}
