import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import fixture from '../../../mock/data/extension-s3.json';
import { DeviceLocalKeyStore } from '../lib/device-local-key';

const state = vi.hoisted<{ local: Record<string, unknown> }>(() => ({ local: {} }));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: structuredClone(state.local[key]) }),
        set: (items: Record<string, unknown>) => {
          Object.assign(state.local, structuredClone(items));
          return Promise.resolve();
        },
        remove: (key: string) => {
          Reflect.deleteProperty(state.local, key);
          return Promise.resolve();
        }
      }
    }
  }
}));
import { s3LocalStore } from '../lib/s3-local-store';
import { ExtensionS3Service } from '../lib/s3-service';
import { shippingServicesLocalStore } from '../lib/shipping-services-store';

beforeEach(() => {
  state.local = {};
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected real network')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function decryptWith(key: CryptoKey, ciphertext: ArrayBuffer, iv: Uint8Array<ArrayBuffer>) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
}

describe('device-local key compatibility and atomic initialization', () => {
  it('returns the same winning non-extractable key to simultaneous first-time callers across instances', async () => {
    const otherInstance = new DeviceLocalKeyStore('one-vegetable-local-s3-key', 'S3_KEY_STORAGE_FAILED');
    const keys = await Promise.all(
      Array.from({ length: 12 }, (_, index) => (index % 2 ? otherInstance.key(true) : s3LocalStore.key(true)))
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const saved = await s3LocalStore.key(false);
    expect(saved).not.toBeNull();
    if (!saved) throw new Error('Missing fixture key');
    for (const key of keys) {
      expect(key?.extractable).toBe(false);
      if (!key) throw new Error('Missing concurrent fixture key');
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode('fixture')
      );
      expect(await decryptWith(saved, ciphertext, iv)).toBe('fixture');
    }
    await expect(crypto.subtle.exportKey('raw', saved)).rejects.toThrow();
  });

  it('reads a pre-extraction S3 primary key unchanged and keeps shipping key deletion independent', async () => {
    const existing = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt'
    ]);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('one-vegetable-local-s3-key', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('Fixture database failed'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite');
      transaction.objectStore('keys').put(existing, 'primary');
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error('Fixture key save failed'));
      };
    });
    database.close();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      existing,
      new TextEncoder().encode('legacy')
    );
    const restored = await s3LocalStore.key(true);
    if (!restored) throw new Error('Missing restored fixture key');
    expect(await decryptWith(restored, ciphertext, iv)).toBe('legacy');
    const shipping = await shippingServicesLocalStore.key(true);
    if (!shipping) throw new Error('Missing shipping fixture key');
    await expect(decryptWith(shipping, ciphertext, iv)).rejects.toThrow();
    await shippingServicesLocalStore.removeKey();
    const retained = await s3LocalStore.key(false);
    if (!retained) throw new Error('S3 fixture key was incorrectly deleted');
    expect(await decryptWith(retained, ciphertext, iv)).toBe('legacy');
  });

  it('keeps the persisted S3 configuration decryptable after two first-save services race', async () => {
    const create = () => new ExtensionS3Service(s3LocalStore, () => Promise.resolve(true));
    const save = () => ({
      requestId: crypto.randomUUID(),
      operation: 'save',
      payload: {
        configuration: fixture.configuration,
        revision: null,
        remark: null
      }
    });
    expect(
      (await Promise.all([create().handle(save(), true), create().handle(save(), true)])).every(
        (result) => result.ok
      )
    ).toBe(true);
    expect(
      await create().handle({ requestId: crypto.randomUUID(), operation: 'summary', payload: {} }, true)
    ).toMatchObject({ ok: true, data: { configured: true, revision: 1 } });
    expect(JSON.stringify(state.local)).not.toContain(fixture.configuration.secretAccessKey);
    expect(fetch).not.toHaveBeenCalled();
  });
});
