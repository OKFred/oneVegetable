import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import {
  ALIBABA_GATEWAY,
  BffGatewayClient,
  MockGatewayClient,
  type GatewaySettings,
  type SettingsRepository
} from '@one-vegetable/core';
import { OneVegetableApp } from '@one-vegetable/ui';
import '@one-vegetable/ui/styles.css';

const SETTINGS_KEY = 'one-vegetable-mock-settings';
const defaults: GatewaySettings = {
  appKey: '',
  appSecret: '',
  accessToken: '',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
};
const settings: SettingsRepository = {
  load() {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return Promise.resolve(defaults);
    try {
      return Promise.resolve({ ...defaults, ...(JSON.parse(stored) as Partial<GatewaySettings>) });
    } catch {
      return Promise.resolve(defaults);
    }
  },
  save(value) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    return Promise.resolve();
  }
};

const gatewayMode = import.meta.env.VITE_GATEWAY_MODE === 'bff' ? 'bff' : 'mock';
const gateway =
  gatewayMode === 'bff'
    ? new BffGatewayClient({
        baseUrl: import.meta.env.VITE_BFF_BASE_URL ?? globalThis.location.origin,
        apiPrefix: import.meta.env.VITE_BFF_API_PREFIX
      })
    : new MockGatewayClient();

const app = createApp(OneVegetableApp, {
  gateway,
  settings,
  mode: gatewayMode
});
app.use(VueQueryPlugin, {
  queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
});
app.mount('#app');
