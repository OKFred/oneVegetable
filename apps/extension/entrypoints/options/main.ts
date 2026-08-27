import { browser } from 'wxt/browser';

import {
  GatewayException,
  BundledProductDescriptionTemplateClient,
  BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA,
  approximateStorageBytes,
  APP_PREFERENCES_STORAGE_KEY,
  completeOnboarding,
  createLocalDataInventory,
  normalizeGatewayError,
  ONBOARDING_STORAGE_KEY,
  readOnboardingState,
  SETTINGS_STORAGE_KEY,
  StaticOperationAvailabilityClient,
  type CredentialVaultOperation,
  type CredentialVaultRepository,
  type CredentialVaultRequest,
  type CredentialVaultResponse,
  type CredentialVaultStatus,
  type GatewayClient,
  type GatewaySettings,
  type HostPermissionsRepository,
  type LocalDataCategory,
  type LocalDataRepository,
  type OnboardingRepository,
  type OperationId,
  type RequestOf,
  type ResponseOf,
  type RuntimeRequest,
  type RuntimeResponse,
  type SettingsRepository
} from '@one-vegetable/core/runtime';
import '@one-vegetable/ui/styles.css';
import { resolveExtensionOperationAvailability } from '../../lib/operation-policy';

const operationAvailability = new StaticOperationAvailabilityClient((operation) =>
  resolveExtensionOperationAvailability(operation)
);

const settings: SettingsRepository = {
  load: () => requestVault('get-settings', undefined),
  async save(value) {
    await ensureOptionalHostPermission(value.endpoint, '自定义网关');
    await requestVault('save', value);
  }
};

const vault: CredentialVaultRepository = {
  status: () => requestVault('status', undefined),
  create: async (passphrase, value) => {
    await ensureOptionalHostPermission(value.endpoint, '自定义网关');
    return requestVault('create', { passphrase, settings: value });
  },
  migrate: (passphrase) => requestVault('migrate', { passphrase }),
  unlock: (passphrase) => requestVault('unlock', { passphrase }),
  lock: () => requestVault('lock', undefined),
  rotate: (newPassphrase) => requestVault('rotate', { newPassphrase }),
  updatePolicy: (idleTimeoutMinutes) => requestVault('update-policy', { idleTimeoutMinutes })
};

interface VaultOperationMap {
  status: { request: undefined; response: CredentialVaultStatus };
  'get-settings': { request: undefined; response: GatewaySettings };
  create: {
    request: { passphrase: string; settings: GatewaySettings };
    response: CredentialVaultStatus;
  };
  migrate: { request: { passphrase: string }; response: CredentialVaultStatus };
  unlock: { request: { passphrase: string }; response: CredentialVaultStatus };
  lock: { request: undefined; response: CredentialVaultStatus };
  save: { request: GatewaySettings; response: CredentialVaultStatus };
  rotate: { request: { newPassphrase: string }; response: CredentialVaultStatus };
  'update-policy': {
    request: { idleTimeoutMinutes: number };
    response: CredentialVaultStatus;
  };
}

async function requestVault<K extends CredentialVaultOperation>(
  operation: K,
  payload: VaultOperationMap[K]['request']
): Promise<VaultOperationMap[K]['response']> {
  const message: CredentialVaultRequest = {
    requestId: crypto.randomUUID(),
    kind: 'credential-vault-request',
    operation,
    ...(payload === undefined ? {} : { payload })
  };
  const response: CredentialVaultResponse = await browser.runtime.sendMessage(message);
  if (response.requestId !== message.requestId) {
    throw new GatewayException({
      code: 'INVALID_RUNTIME_RESPONSE',
      message: '保险库响应 requestId 不匹配',
      retryable: false
    });
  }
  if (!response.ok) throw new GatewayException(response.error);
  return response.data as VaultOperationMap[K]['response'];
}

const permissions: HostPermissionsRepository = {
  async list() {
    const granted = await browser.permissions.getAll();
    return (granted.origins ?? [])
      .filter((origin) => !REQUIRED_HOST_PERMISSIONS.has(origin))
      .toSorted((left, right) => left.localeCompare(right));
  },
  revoke(origin) {
    return browser.permissions.remove({ origins: [origin] });
  }
};

const onboarding: OnboardingRepository = {
  async load() {
    const stored = await browser.storage.local.get(ONBOARDING_STORAGE_KEY);
    return readOnboardingState(stored[ONBOARDING_STORAGE_KEY]);
  },
  async complete() {
    const state = completeOnboarding();
    await browser.storage.local.set({ [ONBOARDING_STORAGE_KEY]: state });
    return state;
  }
};

const localData: LocalDataRepository = {
  async inspect() {
    const [local, session] = await Promise.all([
      browser.storage.local.get(null),
      browser.storage.session.get(null)
    ]);
    const localEntries = localStorageEntries();
    const drafts = localEntries.filter(([key]) => isDraftKey(key));
    const preferences = Object.fromEntries([
      ...Object.entries(local).filter(([key]) => key !== SETTINGS_STORAGE_KEY),
      ...localEntries.filter(([key]) => key === APP_PREFERENCES_STORAGE_KEY)
    ]);
    const categories: LocalDataCategory[] = [
      {
        id: 'credentials',
        label: '加密凭证保险库与网关设置',
        storage: 'chrome.storage.local',
        itemCount: SETTINGS_STORAGE_KEY in local ? 1 : 0,
        approximateBytes: approximateStorageBytes(local[SETTINGS_STORAGE_KEY]),
        sensitive: true,
        retention: '保留到用户覆盖、清除扩展数据或卸载扩展'
      },
      {
        id: 'drafts',
        label: '商品与 RFQ 本地草稿',
        storage: 'localStorage',
        itemCount: drafts.length,
        approximateBytes: approximateStorageBytes(Object.fromEntries(drafts)),
        sensitive: true,
        retention: '保留到草稿被删除、清除扩展数据或卸载扩展'
      },
      {
        id: 'diagnostics',
        label: '脱敏会话诊断',
        storage: 'chrome.storage.session',
        itemCount: Array.isArray(session.diagnosticEntries) ? session.diagnosticEntries.length : 0,
        approximateBytes: approximateStorageBytes(session),
        sensitive: false,
        retention: '仅当前浏览器会话，最多 100 条'
      },
      {
        id: 'preferences',
        label: '首次使用与界面偏好',
        storage: 'chrome.storage.local',
        itemCount: Object.keys(preferences).length,
        approximateBytes: approximateStorageBytes(preferences),
        sensitive: false,
        retention: '保留到清除扩展数据或卸载扩展'
      }
    ];
    return createLocalDataInventory(categories);
  },
  async clearAll() {
    const granted = await permissions.list();
    await Promise.all([
      browser.storage.local.clear(),
      browser.storage.session.clear(),
      ...granted.map((origin) => browser.permissions.remove({ origins: [origin] }))
    ]);
    globalThis.localStorage.clear();
  }
};

const REQUIRED_HOST_PERMISSIONS = new Set(['https://eco.taobao.com/*', 'https://*.alibaba.com/*']);

function localStorageEntries(): [string, string][] {
  return Array.from({ length: globalThis.localStorage.length }, (_, index) => {
    const key = globalThis.localStorage.key(index) ?? '';
    return [key, globalThis.localStorage.getItem(key) ?? ''] as [string, string];
  }).filter(([key]) => key !== '');
}

function isDraftKey(key: string): boolean {
  return key === 'one-vegetable-product-schema-draft' || key.startsWith('one-vegetable:rfq-draft:');
}

class ExtensionGatewayClient implements GatewayClient {
  async request<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
    if (operation === 'transferPhotoFromUrl') {
      const transfer = payload as RequestOf<'transferPhotoFromUrl'>;
      await ensureOptionalHostPermission(transfer.url, '外部图片来源');
    }
    const message: RuntimeRequest<K> = {
      requestId: crypto.randomUUID(),
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

async function mountOptionsApp(): Promise<void> {
  const [{ createApp }, { QueryClient, VueQueryPlugin }, { OneVegetableApp }] = await Promise.all([
    import('vue'),
    import('@tanstack/vue-query'),
    import('@one-vegetable/ui')
  ]);
  const app = createApp(OneVegetableApp, {
    gateway: new ExtensionGatewayClient(),
    settings,
    permissions,
    localData,
    onboarding,
    vault,
    productDescriptionTemplates: new BundledProductDescriptionTemplateClient(
      BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates
    ),
    operationAvailability,
    mode: 'extension'
  });
  app.use(VueQueryPlugin, {
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  });
  app.mount('#app');
}

void mountOptionsApp();
