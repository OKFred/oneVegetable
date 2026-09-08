import { browser } from 'wxt/browser';
import { EXTENSION_S3_STORAGE_KEY } from './s3-protocol';
import type { S3LocalStore } from './s3-service';

const DATABASE = 'one-vegetable-local-s3-key';
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error('S3_KEY_STORAGE_FAILED'));
    };
  });
}

async function keyOperation(value?: CryptoKey | null): Promise<CryptoKey | null> {
  const database = await openDatabase();
  try {
    return await new Promise<CryptoKey | null>((resolve, reject) => {
      const transaction = database.transaction('keys', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('keys');
      const request =
        value === undefined
          ? store.get('primary')
          : value === null
            ? store.delete('primary')
            : store.put(value, 'primary');
      let result: CryptoKey | null = null;
      request.onsuccess = () => {
        const candidate: unknown = request.result;
        result = candidate instanceof CryptoKey ? candidate : null;
      };
      transaction.oncomplete = () => {
        resolve(value instanceof CryptoKey ? value : result);
      };
      transaction.onerror = transaction.onabort = () => {
        reject(new Error('S3_KEY_STORAGE_FAILED'));
      };
    });
  } finally {
    database.close();
  }
}

/** Device-local protection, not a password vault: profile compromise can still use this key. */
export const s3LocalStore: S3LocalStore = {
  async read() {
    return (await browser.storage.local.get(EXTENSION_S3_STORAGE_KEY))[EXTENSION_S3_STORAGE_KEY];
  },
  async write(value) {
    await browser.storage.local.set({ [EXTENSION_S3_STORAGE_KEY]: value });
  },
  async remove() {
    await browser.storage.local.remove(EXTENSION_S3_STORAGE_KEY);
  },
  async key(create) {
    const saved = await keyOperation();
    if (saved || !create) return saved;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt'
    ]);
    await keyOperation(key);
    return key;
  },
  async removeKey() {
    await keyOperation(null);
  }
};
