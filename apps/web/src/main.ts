import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import {
  ALIBABA_GATEWAY,
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
  async load() {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return defaults;
    try {
      return { ...defaults, ...(JSON.parse(stored) as Partial<GatewaySettings>) };
    } catch {
      return defaults;
    }
  },
  async save(value) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  }
};

const app = createApp(OneVegetableApp, {
  gateway: new MockGatewayClient(),
  settings,
  mode: 'mock'
});
app.use(VueQueryPlugin, {
  queryClient: new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })
});
app.mount('#app');
