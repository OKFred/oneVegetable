import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { browser } from 'wxt/browser';

import {
  ALIBABA_GATEWAY,
  GatewayException,
  normalizeGatewayError,
  type GatewayClient,
  type GatewaySettings,
  type OperationId,
  type RequestOf,
  type ResponseOf,
  type RuntimeRequest,
  type RuntimeResponse,
  type SettingsRepository
} from '@one-vegetable/core';
import { OneVegetableApp } from '@one-vegetable/ui';
import '@one-vegetable/ui/styles.css';

const defaults: GatewaySettings = {
  appKey: '',
  appSecret: '',
  accessToken: '',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
};

const settings: SettingsRepository = {
  async load() {
    const stored = await browser.storage.local.get('gatewaySettings');
    const value = stored.gatewaySettings;
    return isPartialSettings(value) ? { ...defaults, ...value } : defaults;
  },
  async save(value) {
    await ensureOptionalHostPermission(value.endpoint, '自定义网关');
    await browser.storage.local.set({ gatewaySettings: value });
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
  const origin = `${url.protocol}//${url.hostname}/*`;
  const permissions = { origins: [origin] };
  if (await browser.permissions.contains(permissions)) return;
  if (await browser.permissions.request(permissions)) return;
  throw new GatewayException({
    code: 'HOST_PERMISSION_DENIED',
    message: `未授予 ${purpose} ${url.hostname} 的访问权限`,
    retryable: false
  });
}

function isPartialSettings(value: unknown): value is Partial<GatewaySettings> {
  if (typeof value !== 'object' || value === null) return false;
  return !('endpoint' in value) || typeof value.endpoint === 'string';
}

window.addEventListener('unhandledrejection', (event) => {
  const error = normalizeGatewayError(event.reason as unknown);
  console.error('[oneVegetable]', error.code, error.message);
});

const app = createApp(OneVegetableApp, {
  gateway: new ExtensionGatewayClient(),
  settings,
  mode: 'extension'
});
app.use(VueQueryPlugin, {
  queryClient: new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })
});
app.mount('#app');
