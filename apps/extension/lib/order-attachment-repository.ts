import {
  orderAttachmentFail,
  parseOrderAttachmentRecord,
  type OrderAttachmentRecord,
  type OrderAttachmentRepository
} from '@one-vegetable/core/order-attachments';

export const ORDER_ATTACHMENT_DATABASE = 'one-vegetable-order-attachments-v1';
export class ExtensionOrderAttachmentRepository implements OrderAttachmentRepository {
  /** Explicit clear-local-data only. The background vault queue serializes this against sends. */
  async clearAll(): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('jobs', 'readwrite', { durability: 'strict' });
        transaction.objectStore('jobs').clear();
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onabort = transaction.onerror = () => {
          reject(new Error('ORDER_ATTACHMENT_STORAGE_FAILED'));
        };
      });
    } finally {
      db.close();
    }
  }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(ORDER_ATTACHMENT_DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('jobs', { keyPath: 'receipt.jobId' });
        store.createIndex('pendingContent', ['ownerId', 'context.gateway', 'receipt.sha256']);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = request.onblocked = () => {
        reject(new Error('ORDER_ATTACHMENT_STORAGE_FAILED'));
      };
    });
  }
  async get(jobId: string, ownerId: string): Promise<OrderAttachmentRecord | null> {
    const db = await this.open();
    try {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('jobs').objectStore('jobs').get(jobId);
        request.onsuccess = () => {
          resolve(request.result as unknown);
        };
        request.onerror = () => {
          reject(new Error('ORDER_ATTACHMENT_STORAGE_FAILED'));
        };
      });
      if (raw === undefined) return null;
      const record = parseOrderAttachmentRecord(raw);
      return record.ownerId === ownerId ? record : null;
    } finally {
      db.close();
    }
  }
  insert(record: OrderAttachmentRecord): Promise<boolean> {
    return this.write(record, true);
  }
  async finish(record: OrderAttachmentRecord): Promise<void> {
    await this.write(record, false);
  }
  private async write(value: OrderAttachmentRecord, insert: boolean): Promise<boolean> {
    const record = parseOrderAttachmentRecord(value);
    if (insert !== (record.receipt.status === 'sending'))
      orderAttachmentFail('ORDER_ATTACHMENT_RECORD_CORRUPT');
    const db = await this.open();
    try {
      return await new Promise<boolean>((resolve, reject) => {
        // Resolve only on durable transaction completion, not on a request's onsuccess.
        const transaction = db.transaction('jobs', 'readwrite', { durability: 'strict' });
        const store = transaction.objectStore('jobs');
        let result = false;
        let failure = 'ORDER_ATTACHMENT_STORAGE_FAILED';
        const request = store.get(record.receipt.jobId);
        request.onsuccess = () => {
          try {
            const raw: unknown = request.result;
            if (insert) {
              if (raw !== undefined) {
                parseOrderAttachmentRecord(raw);
                return;
              }
              const pending = store
                .index('pendingContent')
                .openCursor([record.ownerId, record.context.gateway, record.receipt.sha256]);
              pending.onsuccess = () => {
                try {
                  const cursor = pending.result;
                  if (cursor) {
                    if (
                      ['sending', 'unknown'].includes(
                        parseOrderAttachmentRecord(cursor.value as unknown).receipt.status
                      )
                    )
                      return;
                    cursor.continue();
                    return;
                  }
                  store.add(record);
                  result = true;
                } catch {
                  transaction.abort();
                }
              };
            } else {
              const old = parseOrderAttachmentRecord(raw);
              if (
                old.receipt.status !== 'sending' ||
                immutable(old) !== immutable(record) ||
                record.receipt.updatedTimeUtc < old.receipt.updatedTimeUtc
              ) {
                failure = 'ORDER_ATTACHMENT_REQUEST_CONFLICT';
                transaction.abort();
                return;
              }
              store.put(record);
              result = true;
            }
          } catch {
            transaction.abort();
          }
        };
        transaction.oncomplete = () => {
          resolve(result);
        };
        transaction.onabort = transaction.onerror = () => {
          reject(new Error(failure));
        };
      });
    } finally {
      db.close();
    }
  }
}
function immutable(record: OrderAttachmentRecord): string {
  const r = record.receipt;
  return JSON.stringify([
    record.ownerId,
    record.context.identity,
    record.context.gateway,
    record.context.storage,
    record.fingerprint,
    r.jobId,
    r.requestId,
    r.fileName,
    r.sha256,
    r.size,
    r.createdTimeUtc,
    r.gatewayId,
    r.protocol
  ]);
}
