export interface SocialMediaStoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface SocialMediaStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<SocialMediaStoredObject | null>;
  delete(key: string): Promise<void>;
}

export class MemorySocialMediaStore implements SocialMediaStore {
  readonly #objects = new Map<string, SocialMediaStoredObject>();

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.#objects.set(key, { bytes: bytes.slice(), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<SocialMediaStoredObject | null> {
    const value = this.#objects.get(key);
    return Promise.resolve(value ? { bytes: value.bytes.slice(), contentType: value.contentType } : null);
  }

  delete(key: string): Promise<void> {
    this.#objects.delete(key);
    return Promise.resolve();
  }
}
