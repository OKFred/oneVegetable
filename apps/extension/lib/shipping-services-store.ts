import { browser } from 'wxt/browser';
import { DeviceLocalKeyStore } from './device-local-key';
import { EXTENSION_SHIPPING_SERVICES_STORAGE_KEY } from './shipping-services-protocol';
import type { ShippingServicesLocalStore } from './shipping-services-service';

const deviceKey = new DeviceLocalKeyStore('one-vegetable-shipping-services-key', 'SHIPPING_SERVICES_FAILED');

export const shippingServicesLocalStore: ShippingServicesLocalStore = {
  async read() {
    return (await browser.storage.local.get(EXTENSION_SHIPPING_SERVICES_STORAGE_KEY))[
      EXTENSION_SHIPPING_SERVICES_STORAGE_KEY
    ];
  },
  write: (value) => browser.storage.local.set({ [EXTENSION_SHIPPING_SERVICES_STORAGE_KEY]: value }),
  remove: () => browser.storage.local.remove(EXTENSION_SHIPPING_SERVICES_STORAGE_KEY),
  key: (create) => deviceKey.key(create),
  removeKey: () => deviceKey.removeKey()
};
