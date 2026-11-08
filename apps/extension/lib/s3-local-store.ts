import { browser } from 'wxt/browser';
import { EXTENSION_S3_STORAGE_KEY } from './s3-protocol';
import type { S3LocalStore } from './s3-service';
import { DeviceLocalKeyStore } from './device-local-key';

const deviceKey = new DeviceLocalKeyStore('one-vegetable-local-s3-key', 'S3_KEY_STORAGE_FAILED');

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
  key: (create) => deviceKey.key(create),
  removeKey: () => deviceKey.removeKey()
};
