import { browser } from 'wxt/browser';

import {
  BffControlClient,
  GatewayException,
  BundledProductDescriptionTemplateClient,
  BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA,
  ExtensionProductMutationJobClient,
  EXTENSION_SOCIAL_BACKEND_STORAGE_KEY,
  approximateStorageBytes,
  APP_PREFERENCES_STORAGE_KEY,
  LEGACY_APP_PREFERENCES_STORAGE_KEY,
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
  type ExtensionAlibabaCredentialAcquisitionOperation,
  type ExtensionAlibabaCredentialAcquisitionRepository,
  type ExtensionAlibabaCredentialAcquisitionRequest,
  type ExtensionAlibabaCredentialAcquisitionResponse,
  type ExtensionSocialBackendRepository,
  type ExtensionSocialBackendStatus,
  type ExtensionSocialDevice,
  type AlibabaCredentialAcquisitionContinueCommand,
  type AlibabaCredentialAcquisitionState,
  type AlibabaOpenApiCredentialBundle,
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
  type SocialPublishingClient,
  type SettingsRepository
} from '@one-vegetable/core/runtime';
import '@one-vegetable/ui/styles.css';
import { ALIBABA_CREDENTIAL_ACQUISITION_ORIGINS } from '../../lib/alibaba-credential-page-driver';
import { resolveExtensionOperationAvailability } from '../../lib/operation-policy';
import { EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY } from '../../lib/product-display-mutation-storage';

const operationAvailability = new StaticOperationAvailabilityClient((operation) =>
  resolveExtensionOperationAvailability(operation)
);
type RuntimeTranslator = (key: string, values?: Record<string, unknown>) => string;
let activeRuntimeTranslator: RuntimeTranslator | null = null;

function translateUi(key: string, values?: Record<string, unknown>): string {
  return activeRuntimeTranslator?.(key, values) ?? key;
}

const productMutationJobs = new ExtensionProductMutationJobClient({
  send: (message) => browser.runtime.sendMessage(message)
});

interface StoredExtensionSocialBackend {
  schemaVersion: 1;
  state: 'pending' | 'paired' | 'expired';
  baseUrl: string;
  extensionId: string;
  deviceName: string;
  pairingId: string | null;
  pairingCode: string | null;
  pairingExpiresTimeUtc: number | null;
  device: ExtensionSocialDevice | null;
  deviceToken: string | null;
}

const extensionSocialBackend: ExtensionSocialBackendRepository = {
  async status() {
    return publicExtensionSocialStatus(await readExtensionSocialBackend());
  },
  async start(baseUrl, deviceName) {
    const normalizedBaseUrl = normalizeSocialBackendUrl(baseUrl);
    await ensureOptionalOrigins(
      [`${new URL(normalizedBaseUrl).origin}/*`],
      translateUi('settings.extensionRuntime.permissionPurposes.socialBackend')
    );
    const client = new BffControlClient({
      baseUrl: normalizedBaseUrl,
      extensionId: browser.runtime.id
    });
    const started = await client.startExtensionSocialPairing(browser.runtime.id, deviceName);
    const stored: StoredExtensionSocialBackend = {
      schemaVersion: 1,
      state: 'pending',
      baseUrl: normalizedBaseUrl,
      extensionId: browser.runtime.id,
      deviceName: deviceName.trim(),
      pairingId: started.pairingId,
      pairingCode: started.pairingCode,
      pairingExpiresTimeUtc: started.expiresTimeUtc,
      device: null,
      deviceToken: null
    };
    await writeExtensionSocialBackend(stored);
    return publicExtensionSocialStatus(stored);
  },
  async refresh() {
    const stored = await requireExtensionSocialBackend();
    if (stored.state !== 'pending' || !stored.pairingId || !stored.pairingCode) {
      return publicExtensionSocialStatus(stored);
    }
    const client = new BffControlClient({
      baseUrl: stored.baseUrl,
      extensionId: stored.extensionId
    });
    const result = await client.extensionSocialPairingStatus(
      stored.pairingId,
      stored.pairingCode,
      stored.extensionId
    );
    if (result.status === 'paired' && result.device && result.deviceToken) {
      const paired: StoredExtensionSocialBackend = {
        ...stored,
        state: 'paired',
        pairingId: null,
        pairingCode: null,
        pairingExpiresTimeUtc: null,
        device: result.device,
        deviceToken: result.deviceToken
      };
      await writeExtensionSocialBackend(paired);
      return publicExtensionSocialStatus(paired);
    }
    if (result.status === 'expired' || result.status === 'cancelled' || result.status === 'consumed') {
      const expired: StoredExtensionSocialBackend = {
        ...stored,
        state: 'expired',
        pairingCode: null,
        device: result.device,
        deviceToken: null
      };
      await writeExtensionSocialBackend(expired);
      return publicExtensionSocialStatus(expired);
    }
    return publicExtensionSocialStatus(stored);
  },
  async disconnect() {
    await browser.storage.local.remove(EXTENSION_SOCIAL_BACKEND_STORAGE_KEY);
    return publicExtensionSocialStatus(null);
  }
};

const socialPublishing: SocialPublishingClient = {
  listSocialDestinations: () => withSocialControl((client) => client.listSocialDestinations()),
  prepareSocialPost: (input) => withSocialControl((client) => client.prepareSocialPost(input)),
  publishSocialPost: (jobId) => withSocialControl((client) => client.publishSocialPost(jobId)),
  advanceSocialPost: (jobId) => withSocialControl((client) => client.advanceSocialPost(jobId)),
  getSocialPost: (jobId) => withSocialControl((client) => client.getSocialPost(jobId)),
  getSocialPostPermalink: (jobId) => withSocialControl((client) => client.getSocialPostPermalink(jobId)),
  listSocialPosts: (limit) => withSocialControl((client) => client.listSocialPosts(limit)),
  cancelSocialPost: (jobId) => withSocialControl((client) => client.cancelSocialPost(jobId))
};

const settings: SettingsRepository = {
  load: () => requestVault('get-settings', undefined),
  async save(value) {
    await ensureOptionalHostPermission(
      value.endpoint,
      translateUi('settings.extensionRuntime.permissionPurposes.customGateway')
    );
    await requestVault('save', value);
  }
};

const vault: CredentialVaultRepository = {
  status: () => requestVault('status', undefined),
  create: async (passphrase, value) => {
    await ensureOptionalHostPermission(
      value.endpoint,
      translateUi('settings.extensionRuntime.permissionPurposes.customGateway')
    );
    return requestVault('create', { passphrase, settings: value });
  },
  migrate: (passphrase) => requestVault('migrate', { passphrase }),
  unlock: (passphrase) => requestVault('unlock', { passphrase }),
  lock: () => requestVault('lock', undefined),
  rotate: (newPassphrase) => requestVault('rotate', { newPassphrase }),
  updatePolicy: (idleTimeoutMinutes) => requestVault('update-policy', { idleTimeoutMinutes })
};

let latestAcquisitionState: AlibabaCredentialAcquisitionState | null = null;

const alibabaCredentialAcquisition: ExtensionAlibabaCredentialAcquisitionRepository = {
  async start(callbackUrl) {
    await ensureOptionalOrigins(
      ALIBABA_CREDENTIAL_ACQUISITION_ORIGINS,
      translateUi('settings.extensionRuntime.permissionPurposes.credentialAcquisition')
    );
    return rememberAcquisitionState(await requestAcquisition('start', { callbackUrl }));
  },
  async continue(jobId, command) {
    if (command.type === 'confirm-callback-change') {
      const state = latestAcquisitionState;
      if (state?.status !== 'callback-confirmation-required' || state.jobId !== jobId) {
        throw new Error(translateUi('settings.extensionRuntime.errors.callbackStateExpired'));
      }
      const callbackUrl = command.confirmed ? state.requestedUrl : state.currentUrl;
      await ensureOptionalOrigins(
        [`${new URL(callbackUrl).origin}/*`],
        translateUi('settings.extensionRuntime.permissionPurposes.oauthCallback')
      );
    }
    return rememberAcquisitionState(await requestAcquisition('continue', { jobId, command }));
  },
  async status(jobId) {
    return rememberAcquisitionState(await requestAcquisition('status', { jobId }));
  },
  async cancel(jobId) {
    const state = await requestAcquisition('cancel', { jobId });
    latestAcquisitionState = null;
    return state;
  },
  saveToVault(passphrase) {
    return requestAcquisition('save-to-vault', passphrase ? { passphrase } : {});
  },
  exportBundle() {
    return requestAcquisition('export-bundle', undefined);
  }
};

interface AcquisitionOperationMap {
  start: { request: { callbackUrl: string | null }; response: AlibabaCredentialAcquisitionState };
  continue: {
    request: { jobId: string; command: AlibabaCredentialAcquisitionContinueCommand };
    response: AlibabaCredentialAcquisitionState;
  };
  status: { request: { jobId: string }; response: AlibabaCredentialAcquisitionState };
  cancel: { request: { jobId: string }; response: AlibabaCredentialAcquisitionState };
  'save-to-vault': { request: { passphrase?: string }; response: CredentialVaultStatus };
  'export-bundle': { request: undefined; response: AlibabaOpenApiCredentialBundle };
}

async function requestAcquisition<K extends ExtensionAlibabaCredentialAcquisitionOperation>(
  operation: K,
  payload: AcquisitionOperationMap[K]['request']
): Promise<AcquisitionOperationMap[K]['response']> {
  const message: ExtensionAlibabaCredentialAcquisitionRequest = {
    requestId: crypto.randomUUID(),
    kind: 'alibaba-credential-acquisition-request',
    operation,
    ...(payload === undefined ? {} : { payload })
  };
  const response: ExtensionAlibabaCredentialAcquisitionResponse = await browser.runtime.sendMessage(message);
  if (response.requestId !== message.requestId) {
    throw new GatewayException({
      code: 'INVALID_RUNTIME_RESPONSE',
      message: translateUi('settings.extensionRuntime.errors.acquisitionRequestMismatch'),
      retryable: false
    });
  }
  if (!response.ok) throw new GatewayException(response.error, response.requestId);
  return response.data as AcquisitionOperationMap[K]['response'];
}

function rememberAcquisitionState(
  state: AlibabaCredentialAcquisitionState
): AlibabaCredentialAcquisitionState {
  latestAcquisitionState = state;
  return state;
}

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
    throw new GatewayException(
      {
        code: 'INVALID_RUNTIME_RESPONSE',
        message: translateUi('settings.extensionRuntime.errors.vaultRequestMismatch'),
        retryable: false
      },
      message.requestId
    );
  }
  if (!response.ok) throw new GatewayException(response.error, response.requestId);
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
      browser.storage.session.get('diagnosticEntries')
    ]);
    const localEntries = localStorageEntries();
    const drafts = localEntries.filter(([key]) => isDraftKey(key));
    const preferences = Object.fromEntries([
      ...Object.entries(local).filter(
        ([key]) =>
          key !== SETTINGS_STORAGE_KEY &&
          key !== EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY &&
          key !== EXTENSION_SOCIAL_BACKEND_STORAGE_KEY
      ),
      ...localEntries.filter(
        ([key]) => key === APP_PREFERENCES_STORAGE_KEY || key === LEGACY_APP_PREFERENCES_STORAGE_KEY
      )
    ]);
    const categories: LocalDataCategory[] = [
      {
        id: 'credentials',
        label: translateUi('settings.extensionRuntime.localData.credentials.label'),
        storage: 'chrome.storage.local',
        itemCount: SETTINGS_STORAGE_KEY in local ? 1 : 0,
        approximateBytes: approximateStorageBytes(local[SETTINGS_STORAGE_KEY]),
        sensitive: true,
        retention: translateUi('settings.extensionRuntime.localData.credentials.retention')
      },
      {
        id: 'product-mutation-jobs',
        label: translateUi('settings.extensionRuntime.localData.productMutationJobs.label'),
        storage: 'chrome.storage.local',
        itemCount: productMutationJobCount(local[EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY]),
        approximateBytes: approximateStorageBytes(local[EXTENSION_PRODUCT_MUTATION_JOBS_STORAGE_KEY]),
        sensitive: true,
        retention: translateUi('settings.extensionRuntime.localData.productMutationJobs.retention')
      },
      {
        id: 'social-backend-device',
        label: translateUi('settings.extensionRuntime.localData.socialBackendDevice.label'),
        storage: 'chrome.storage.local',
        itemCount: EXTENSION_SOCIAL_BACKEND_STORAGE_KEY in local ? 1 : 0,
        approximateBytes: approximateStorageBytes(local[EXTENSION_SOCIAL_BACKEND_STORAGE_KEY]),
        sensitive: true,
        retention: translateUi('settings.extensionRuntime.localData.socialBackendDevice.retention')
      },
      {
        id: 'drafts',
        label: translateUi('settings.extensionRuntime.localData.drafts.label'),
        storage: 'localStorage',
        itemCount: drafts.length,
        approximateBytes: approximateStorageBytes(Object.fromEntries(drafts)),
        sensitive: true,
        retention: translateUi('settings.extensionRuntime.localData.drafts.retention')
      },
      {
        id: 'diagnostics',
        label: translateUi('settings.extensionRuntime.localData.diagnostics.label'),
        storage: 'chrome.storage.session',
        itemCount: Array.isArray(session.diagnosticEntries) ? session.diagnosticEntries.length : 0,
        approximateBytes: approximateStorageBytes(session),
        sensitive: false,
        retention: translateUi('settings.extensionRuntime.localData.diagnostics.retention')
      },
      {
        id: 'preferences',
        label: translateUi('settings.extensionRuntime.localData.preferences.label'),
        storage: 'chrome.storage.local',
        itemCount: Object.keys(preferences).length,
        approximateBytes: approximateStorageBytes(preferences),
        sensitive: false,
        retention: translateUi('settings.extensionRuntime.localData.preferences.retention')
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

function productMutationJobCount(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
  const jobs = Reflect.get(value, 'jobs') as unknown;
  return Array.isArray(jobs) ? jobs.length : 0;
}

class ExtensionGatewayClient implements GatewayClient {
  async request<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
    if (operation === 'transferPhotoFromUrl' || operation === 'downloadProductAsset') {
      const transfer = payload as RequestOf<'transferPhotoFromUrl'> | RequestOf<'downloadProductAsset'>;
      await ensureOptionalHostPermission(
        transfer.url,
        translateUi(
          operation === 'downloadProductAsset'
            ? 'settings.extensionRuntime.permissionPurposes.productZipAsset'
            : 'settings.extensionRuntime.permissionPurposes.externalPhoto'
        )
      );
    }
    const message: RuntimeRequest<K> = {
      requestId: crypto.randomUUID(),
      kind: 'gateway-request',
      operation,
      payload
    };
    const response: RuntimeResponse<K> = await browser.runtime.sendMessage(message);
    if (response.requestId !== message.requestId) {
      throw new GatewayException(
        {
          code: 'INVALID_RUNTIME_RESPONSE',
          message: translateUi('settings.extensionRuntime.errors.runtimeRequestMismatch'),
          retryable: false
        },
        message.requestId
      );
    }
    if (!response.ok) throw new GatewayException(response.error, response.requestId);
    return response.data;
  }
}

async function ensureOptionalHostPermission(rawUrl: string, purpose: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new GatewayException({
      code: 'INVALID_HOST_PERMISSION',
      message: translateUi('settings.extensionRuntime.errors.invalidHostProtocol', { purpose }),
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
    message: translateUi('settings.extensionRuntime.errors.permissionDeniedHost', {
      purpose,
      host: url.hostname
    }),
    retryable: false
  });
}

async function ensureOptionalOrigins(origins: readonly string[], purpose: string): Promise<void> {
  const request = { origins: [...origins] };
  // permissions.request 必须直接发生在按钮点击的用户手势中；不要先 await contains。
  if (await browser.permissions.request(request)) return;
  throw new GatewayException({
    code: 'HOST_PERMISSION_DENIED',
    message: translateUi('settings.extensionRuntime.errors.permissionDeniedPurpose', { purpose }),
    retryable: false
  });
}

async function withSocialControl<T>(action: (client: BffControlClient) => Promise<T>): Promise<T> {
  const stored = await requireExtensionSocialBackend();
  if (
    stored.state !== 'paired' ||
    !stored.deviceToken ||
    !stored.device ||
    stored.device.expiresTimeUtc <= Date.now()
  ) {
    throw new GatewayException({
      code: 'EXTENSION_SOCIAL_BACKEND_NOT_PAIRED',
      message: translateUi('settings.extensionRuntime.errors.socialPairingRequired'),
      retryable: false
    });
  }
  return action(
    new BffControlClient({
      baseUrl: stored.baseUrl,
      bearerToken: () => stored.deviceToken,
      extensionId: stored.extensionId
    })
  );
}

async function requireExtensionSocialBackend(): Promise<StoredExtensionSocialBackend> {
  const stored = await readExtensionSocialBackend();
  if (!stored) {
    throw new GatewayException({
      code: 'EXTENSION_SOCIAL_BACKEND_NOT_CONFIGURED',
      message: translateUi('settings.extensionRuntime.errors.socialBackendRequired'),
      retryable: false
    });
  }
  return stored;
}

async function readExtensionSocialBackend(): Promise<StoredExtensionSocialBackend | null> {
  const result = await browser.storage.local.get(EXTENSION_SOCIAL_BACKEND_STORAGE_KEY);
  const value = result[EXTENSION_SOCIAL_BACKEND_STORAGE_KEY];
  if (!isStoredExtensionSocialBackend(value)) return null;
  if (value.state === 'paired' && value.device && value.device.expiresTimeUtc <= Date.now()) {
    const expired: StoredExtensionSocialBackend = {
      ...value,
      state: 'expired',
      deviceToken: null
    };
    await writeExtensionSocialBackend(expired);
    return expired;
  }
  if (
    value.state === 'pending' &&
    value.pairingExpiresTimeUtc !== null &&
    value.pairingExpiresTimeUtc <= Date.now()
  ) {
    const expired: StoredExtensionSocialBackend = {
      ...value,
      state: 'expired',
      pairingCode: null
    };
    await writeExtensionSocialBackend(expired);
    return expired;
  }
  return value;
}

function writeExtensionSocialBackend(value: StoredExtensionSocialBackend): Promise<void> {
  return browser.storage.local.set({ [EXTENSION_SOCIAL_BACKEND_STORAGE_KEY]: value });
}

function publicExtensionSocialStatus(
  value: StoredExtensionSocialBackend | null
): ExtensionSocialBackendStatus {
  if (!value) {
    return {
      state: 'unconfigured',
      baseUrl: null,
      extensionId: browser.runtime.id,
      deviceName: null,
      pairingCode: null,
      pairingExpiresTimeUtc: null,
      device: null
    };
  }
  return {
    state: value.state,
    baseUrl: value.baseUrl,
    extensionId: value.extensionId,
    deviceName: value.deviceName,
    pairingCode: value.pairingCode,
    pairingExpiresTimeUtc: value.pairingExpiresTimeUtc,
    device: value.device
  };
}

function isStoredExtensionSocialBackend(value: unknown): value is StoredExtensionSocialBackend {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredExtensionSocialBackend>;
  return (
    candidate.schemaVersion === 1 &&
    (candidate.state === 'pending' || candidate.state === 'paired' || candidate.state === 'expired') &&
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.extensionId === 'string' &&
    typeof candidate.deviceName === 'string' &&
    (candidate.pairingId === null || typeof candidate.pairingId === 'string') &&
    (candidate.pairingCode === null || typeof candidate.pairingCode === 'string') &&
    (candidate.pairingExpiresTimeUtc === null || typeof candidate.pairingExpiresTimeUtc === 'number') &&
    (candidate.device === null || typeof candidate.device === 'object') &&
    (candidate.deviceToken === null || typeof candidate.deviceToken === 'string')
  );
}

function normalizeSocialBackendUrl(value: string): string {
  const url = new URL(value.trim());
  const loopback =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !loopback) {
    throw new GatewayException({
      code: 'SOCIAL_BACKEND_URL_INVALID',
      message: translateUi('settings.extensionRuntime.errors.socialHttps'),
      retryable: false
    });
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new GatewayException({
      code: 'SOCIAL_BACKEND_URL_INVALID',
      message: translateUi('settings.extensionRuntime.errors.socialUrlStructure'),
      retryable: false
    });
  }
  return url.origin;
}

window.addEventListener('unhandledrejection', (event) => {
  const error = normalizeGatewayError(event.reason as unknown);
  console.error('[oneVegetable]', error.code, error.message);
});

async function mountOptionsApp(): Promise<void> {
  const [{ createApp }, { QueryClient, VueQueryPlugin }, uiModule] = await Promise.all([
    import('vue'),
    import('@tanstack/vue-query'),
    import('@one-vegetable/ui')
  ]);
  const { OneVegetableApp, uiI18n } = uiModule;
  activeRuntimeTranslator = uiModule.translateUi;
  const app = createApp(OneVegetableApp, {
    gateway: new ExtensionGatewayClient(),
    settings,
    permissions,
    localData,
    onboarding,
    vault,
    alibabaCredentialAcquisition,
    extensionSocialBackend,
    socialPublishing,
    productDescriptionTemplates: new BundledProductDescriptionTemplateClient(
      BUNDLED_PRODUCT_DESCRIPTION_TEMPLATE_DATA.templates
    ),
    productMutationJobs,
    operationAvailability,
    mode: 'extension'
  });
  app.use(uiI18n);
  app.use(VueQueryPlugin, {
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  });
  app.mount('#app');
}

void mountOptionsApp();
