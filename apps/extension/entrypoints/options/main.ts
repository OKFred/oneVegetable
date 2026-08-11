import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { browser } from 'wxt/browser';

import {
  ALIBABA_GATEWAY,
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
    await browser.storage.local.set({ gatewaySettings: value });
  }
};

class ExtensionGatewayClient implements GatewayClient {
  async request<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
    const message: RuntimeRequest<K> = {
      id: crypto.randomUUID(),
      kind: 'gateway-request',
      operation,
      payload
    };
    const response = (await browser.runtime.sendMessage(message)) as RuntimeResponse<K>;
    if (!response.ok) throw response.error;
    return response.data;
  }
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
