import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import {
  ALIBABA_GATEWAY,
  BffControlClient,
  BffGatewayClient,
  BffProductDescriptionTemplateClient,
  CompositeProductDescriptionTemplateClient,
  MemoryProductDescriptionTemplateClient,
  MockGatewayClient,
  PRODUCT_DESCRIPTION_TEMPLATE_MOCK_DATA,
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
const bffBaseUrl = import.meta.env.VITE_BFF_BASE_URL ?? globalThis.location.origin;
const control =
  gatewayMode === 'bff'
    ? new BffControlClient({
        baseUrl: bffBaseUrl,
        apiPrefix: import.meta.env.VITE_BFF_API_PREFIX,
        csrfToken: () => readCookie('ov_csrf')
      })
    : undefined;
const gateway =
  gatewayMode === 'bff'
    ? new BffGatewayClient({
        baseUrl: bffBaseUrl,
        apiPrefix: import.meta.env.VITE_BFF_API_PREFIX,
        csrfToken: () => control?.csrfToken() ?? readCookie('ov_csrf')
      })
    : new MockGatewayClient();
const bffTemplates =
  gatewayMode === 'bff'
    ? new BffProductDescriptionTemplateClient({
        baseUrl: bffBaseUrl,
        apiPrefix: import.meta.env.VITE_BFF_API_PREFIX,
        csrfToken: () => control?.csrfToken() ?? readCookie('ov_csrf')
      })
    : undefined;
const bundledTemplates = new MemoryProductDescriptionTemplateClient(
  PRODUCT_DESCRIPTION_TEMPLATE_MOCK_DATA.templates,
  { writable: false, actorId: 'system:bundled' }
);
const mockTemplates =
  gatewayMode === 'mock'
    ? new CompositeProductDescriptionTemplateClient(
        bundledTemplates,
        new MemoryProductDescriptionTemplateClient([], { writable: true })
      )
    : undefined;
const productDescriptionTemplates = bffTemplates
  ? new CompositeProductDescriptionTemplateClient(bundledTemplates, bffTemplates)
  : mockTemplates;

const app = createApp(OneVegetableApp, {
  gateway,
  settings,
  mode: gatewayMode,
  ...(control ? { control } : {}),
  ...(productDescriptionTemplates ? { productDescriptionTemplates } : {}),
  ...(bffTemplates ? { operationAvailability: bffTemplates } : {})
});
app.use(VueQueryPlugin, {
  queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
});
app.mount('#app');

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length));
  }
  return null;
}
