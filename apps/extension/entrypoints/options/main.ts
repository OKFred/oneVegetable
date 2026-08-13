import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { browser } from 'wxt/browser';

import {
  GatewayException,
  migrateGatewaySettings,
  normalizeGatewayError,
  persistGatewaySettings,
  SETTINGS_STORAGE_KEY,
  type GatewayClient,
  type HostPermissionsRepository,
  type OperationId,
  type RequestOf,
  type ResponseOf,
  type RuntimeRequest,
  type RuntimeResponse,
  type SettingsRepository
} from '@one-vegetable/core/runtime';
import { OneVegetableApp } from '@one-vegetable/ui';
import '@one-vegetable/ui/styles.css';

const settings: SettingsRepository = {
  async load() {
    const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
    const migrated = migrateGatewaySettings(stored[SETTINGS_STORAGE_KEY]);
    if (migrated.migrated) {
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: migrated.persistedValue });
    }
    return migrated.settings;
  },
  async save(value) {
    await ensureOptionalHostPermission(value.endpoint, '自定义网关');
    await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: persistGatewaySettings(value) });
  }
};

const permissions: HostPermissionsRepository = {
  async list() {
    const granted = await browser.permissions.getAll();
    return (granted.origins ?? [])
      .filter((origin) => origin !== 'https://eco.taobao.com/*')
      .toSorted((left, right) => left.localeCompare(right));
  },
  revoke(origin) {
    return browser.permissions.remove({ origins: [origin] });
  }
};

class ExtensionGatewayClient implements GatewayClient {
  async request<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
    if (operation === 'transferPhotoFromUrl') {
      const transfer = payload as RequestOf<'transferPhotoFromUrl'>;
      await ensureOptionalHostPermission(transfer.url, '外部图片来源');
    }
    const message: RuntimeRequest<K> = {
      id: crypto.randomUUID(),
      kind: 'gateway-request',
      operation,
      payload
    };
    const response: RuntimeResponse<K> = await browser.runtime.sendMessage(message);
    if (!response.ok) throw new GatewayException(response.error);
    return response.data;
  }
}

async function ensureOptionalHostPermission(rawUrl: string, purpose: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new GatewayException({
      code: 'INVALID_HOST_PERMISSION',
      message: `${purpose}仅允许 HTTP(S) 地址`,
      retryable: false
    });
  }
  const officialGateway = url.protocol === 'https:' && url.hostname === 'eco.taobao.com';
  if (officialGateway) return;
  const origin = `${url.protocol}//${url.host}/*`;
  const permissions = { origins: [origin] };
  if (await browser.permissions.contains(permissions)) return;
  if (await browser.permissions.request(permissions)) return;
  throw new GatewayException({
    code: 'HOST_PERMISSION_DENIED',
    message: `未授予 ${purpose} ${url.hostname} 的访问权限`,
    retryable: false
  });
}

window.addEventListener('unhandledrejection', (event) => {
  const error = normalizeGatewayError(event.reason as unknown);
  console.error('[oneVegetable]', error.code, error.message);
});

const app = createApp(OneVegetableApp, {
  gateway: new ExtensionGatewayClient(),
  settings,
  permissions,
  mode: 'extension'
});
app.use(VueQueryPlugin, {
  queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
});
app.mount('#app');
