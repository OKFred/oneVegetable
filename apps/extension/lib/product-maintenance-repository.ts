import {
  canonicalizeProductMaintenanceDraft,
  createProductMaintenanceIntent
} from '../../../packages/core/src/product-maintenance-api';
import {
  parseProductMaintenanceRecord,
  productMaintenanceIsTerminal,
  productMaintenanceLockEntities,
  type ProductMaintenanceRecord,
  type ProductMaintenanceRepository
} from '../../../packages/core/src/product-maintenance-service';

export const PRODUCT_MAINTENANCE_DATABASE = 'one-vegetable-product-maintenance-v1';
function fail(code: string): never {
  throw new Error(code);
}
function parse(value: unknown): ProductMaintenanceRecord {
  const record = parseProductMaintenanceRecord(value);
  canonicalizeProductMaintenanceDraft(record.task.intent.draft);
  if (JSON.stringify(record).length > 100_000) fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  return record;
}
async function validated(value: unknown): Promise<ProductMaintenanceRecord> {
  try {
    const record = parse(value);
    const expected = await createProductMaintenanceIntent(record.task.intent.draft);
    if (JSON.stringify(expected) !== JSON.stringify(record.task.intent))
      return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    return record;
  } catch {
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  }
}
function assertNext(current: ProductMaintenanceRecord, next: ProductMaintenanceRecord): void {
  const old = current.task;
  const task = next.task;
  if (
    current.ownerId !== next.ownerId ||
    old.id !== task.id ||
    JSON.stringify(old.context) !== JSON.stringify(task.context) ||
    JSON.stringify(old.intent) !== JSON.stringify(task.intent) ||
    JSON.stringify(old.baseline) !== JSON.stringify(task.baseline) ||
    old.requestId !== task.requestId ||
    old.createTimeUtc !== task.createTimeUtc ||
    task.updateTimeUtc < old.updateTimeUtc ||
    (old.submitAttempted && !task.submitAttempted) ||
    (productMaintenanceIsTerminal(old.status) && old.status !== task.status)
  )
    fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
}
function read(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result as unknown);
    };
    request.onerror = () => {
      reject(new Error('PRODUCT_MAINTENANCE_STORAGE_FAILED'));
    };
  });
}

/** CAS and all account/context/entity lock checks share one IndexedDB readwrite transaction. */
export class ExtensionProductMaintenanceRepository implements ProductMaintenanceRepository {
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(PRODUCT_MAINTENANCE_DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('tasks', { keyPath: ['ownerId', 'task.id'] });
        store.createIndex('ownerId', 'ownerId');
        store.createIndex('context', ['ownerId', 'task.context.identity', 'task.context.gateway']);
      };
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
        };
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('PRODUCT_MAINTENANCE_STORAGE_FAILED'));
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error('PRODUCT_MAINTENANCE_STORAGE_FAILED'));
      };
    });
  }
  async get(id: string, ownerId: string): Promise<ProductMaintenanceRecord | null> {
    const db = await this.open();
    try {
      const raw = await read(db.transaction('tasks').objectStore('tasks').get([ownerId, id]));
      if (raw === undefined) return null;
      const record = await validated(raw);
      if (record.ownerId !== ownerId || record.task.id !== id) fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
      return record;
    } finally {
      db.close();
    }
  }
  async list(ownerId: string): Promise<ProductMaintenanceRecord[]> {
    const db = await this.open();
    try {
      const raw = await read(db.transaction('tasks').objectStore('tasks').index('ownerId').getAll(ownerId));
      if (!Array.isArray(raw)) return fail('PRODUCT_MAINTENANCE_STORAGE_FAILED');
      const records = await Promise.all((raw as unknown[]).map(validated));
      if (records.some((record) => record.ownerId !== ownerId)) fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
      return records
        .sort((a, b) => b.task.updateTimeUtc - a.task.updateTimeUtc || a.task.id.localeCompare(b.task.id))
        .slice(0, 100);
    } finally {
      db.close();
    }
  }
  async save(value: ProductMaintenanceRecord, expectedRevision: number | null): Promise<void> {
    const record = await validated(value);
    if (
      expectedRevision === null
        ? record.task.revision !== 1
        : !Number.isSafeInteger(expectedRevision) ||
          expectedRevision < 1 ||
          record.task.revision !== expectedRevision + 1
    )
      return fail('ENTITY_VERSION_CONFLICT');
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('tasks', 'readwrite');
        const store = transaction.objectStore('tasks');
        let code = 'PRODUCT_MAINTENANCE_STORAGE_FAILED';
        const abort = (cause: unknown) => {
          if (
            cause instanceof Error &&
            [
              'ENTITY_VERSION_CONFLICT',
              'PRODUCT_MAINTENANCE_TASK_CORRUPT',
              'PRODUCT_MAINTENANCE_ENTITY_BUSY'
            ].includes(cause.message)
          )
            code = cause.message;
          transaction.abort();
        };
        const existing = store.get([record.ownerId, record.task.id]);
        existing.onsuccess = () => {
          try {
            const current: unknown = existing.result;
            const previous = current === undefined ? null : parse(current);
            if ((previous?.task.revision ?? null) !== expectedRevision) fail('ENTITY_VERSION_CONFLICT');
            if (previous) assertNext(previous, record);
            const scoped = store.index('ownerId').getAll(record.ownerId);
            scoped.onsuccess = () => {
              try {
                const raw: unknown = scoped.result;
                if (!Array.isArray(raw)) fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
                const entities = new Set(productMaintenanceLockEntities(record.task));
                for (const value of raw as unknown[]) {
                  const other = parse(value);
                  if (other.ownerId !== record.ownerId) fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
                  const sameContext =
                    other.task.context.identity === record.task.context.identity &&
                    other.task.context.gateway === record.task.context.gateway;
                  if (
                    sameContext &&
                    other.task.id !== record.task.id &&
                    !productMaintenanceIsTerminal(record.task.status) &&
                    !productMaintenanceIsTerminal(other.task.status) &&
                    productMaintenanceLockEntities(other.task).some((entity) => entities.has(entity))
                  )
                    fail('PRODUCT_MAINTENANCE_ENTITY_BUSY');
                }
                store.put(structuredClone(record));
              } catch (cause: unknown) {
                abort(cause);
              }
            };
          } catch (cause: unknown) {
            abort(cause);
          }
        };
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = transaction.onerror = () => {
          reject(new Error(code));
        };
      });
    } finally {
      db.close();
    }
  }
  /** Explicit local clearing only. Never erase unresolved receipts or call a provider. */
  async clearAll(): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('tasks', 'readwrite');
        const store = transaction.objectStore('tasks');
        let code = 'PRODUCT_MAINTENANCE_STORAGE_FAILED';
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const raw: unknown = request.result;
            if (!Array.isArray(raw)) fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
            const records = (raw as unknown[]).map(parse);
            if (records.some((record) => !productMaintenanceIsTerminal(record.task.status))) {
              code = 'PRODUCT_MAINTENANCE_ENTITY_BUSY';
              transaction.abort();
            } else store.clear();
          } catch {
            code = 'PRODUCT_MAINTENANCE_TASK_CORRUPT';
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = transaction.onerror = () => {
          reject(new Error(code));
        };
      });
    } finally {
      db.close();
    }
  }
}
