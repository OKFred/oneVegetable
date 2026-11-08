/** Device-local protection, not a password vault: profile compromise can still use this key. */
export class DeviceLocalKeyStore {
  constructor(
    private readonly databaseName: string,
    private readonly errorCode: string
  ) {}

  async key(create: boolean): Promise<CryptoKey | null> {
    const saved = await this.#operation();
    if (saved || !create) return saved;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt'
    ]);
    return this.#operation(key);
  }

  async removeKey(): Promise<void> {
    await this.#operation(null);
  }

  async #operation(value?: CryptoKey | null): Promise<CryptoKey | null> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error(this.errorCode));
      };
    });
    try {
      return await new Promise<CryptoKey | null>((resolve, reject) => {
        const transaction = database.transaction('keys', value === undefined ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('keys');
        const request = value === null ? store.delete('primary') : store.get('primary');
        let result: CryptoKey | null = null;
        request.onsuccess = () => {
          const candidate: unknown = request.result;
          result = candidate instanceof CryptoKey ? candidate : null;
          // Concurrent initializers serialize here; every caller gets the winning key.
          if (value && !result) {
            store.add(value, 'primary');
            result = value;
          }
        };
        transaction.oncomplete = () => {
          resolve(result);
        };
        transaction.onerror = transaction.onabort = () => {
          reject(new Error(this.errorCode));
        };
      });
    } finally {
      database.close();
    }
  }
}
