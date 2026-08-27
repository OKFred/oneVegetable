import { createApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import {
  ALIBABA_GATEWAY,
  BffControlClient,
  BffGatewayClient,
  BffProductMutationJobClient,
  BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA,
  OPERATION_IDS,
  StaticOperationAvailabilityClient,
  type GatewaySettings,
  type SettingsRepository
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import {
  BffProductDescriptionTemplateClient,
  CompositeProductDescriptionTemplateClient,
  MemoryProductDescriptionTemplateClient
} from '@one-vegetable/core/templates';
import { OneVegetableApp } from '@one-vegetable/ui';
import '@one-vegetable/ui/styles.css';

import { readWebGatewayMode } from './runtime-config';

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

const gatewayMode = readWebGatewayMode(import.meta.env.VITE_GATEWAY_MODE);
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
const productMutationJobs =
  gatewayMode === 'bff'
    ? new BffProductMutationJobClient({
        baseUrl: bffBaseUrl,
        apiPrefix: import.meta.env.VITE_BFF_API_PREFIX,
        csrfToken: () => control?.csrfToken() ?? readCookie('ov_csrf')
      })
    : undefined;
const bundledTemplates = new MemoryProductDescriptionTemplateClient(
  BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates,
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
const operationAvailability =
  bffTemplates ??
  new StaticOperationAvailabilityClient(new Set(OPERATION_IDS), {
    allowedReasonCode: 'MOCK_OPERATION_ALLOWED'
  });

const app = createApp(OneVegetableApp, {
  gateway,
  settings,
  mode: gatewayMode,
  ...(control ? { control } : {}),
  ...(productDescriptionTemplates ? { productDescriptionTemplates } : {}),
  ...(productMutationJobs ? { productMutationJobs } : {}),
  operationAvailability
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
