/**
 * Read-only acceptance against an existing production MV3 build, never a rebuild.
 * Usage: pnpm exec tsx scripts/smoke-iop-workbench-real.ts --confirm-readonly --credential=<IOP JSON>
 * The retained, isolated profile contains an encrypted vault; its random passphrase is not exported.
 * Default pregrants the exact IOP origin only in the copied manifest.
 * --native-host-consent preserves the production manifest and waits for the user to allow the host.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_API_ORIGIN, IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { requireProductOperationContext } from '../packages/core/src/product-operation-context';
import { settings as settingsZh } from '../packages/ui/src/i18n/messages/zh-CN/settings';
import { gatewayCredentials as credentialsZh } from '../packages/ui/src/i18n/messages/zh-CN/gatewayCredentials';
import { atomicWriteJson } from './openapi-auth/storage';

// Deliberately independent of the expanding core allowlist: no mutation, token or aggregate paths.
// getProduct would issue list + render; use the single-request render operation instead.
export const READ_PATHS = {
  listProducts: '/rest/alibaba/icbu/product/list',
  listProductGroups: '/rest/alibaba/icbu/product/group/get',
  listPhotoGroups: '/rest/icbu/product/photobank/group/list',
  listPhotos: '/rest/icbu/product/photobank/list',
  renderProductSchema: '/rest/icbu/product/schema/render',
  listTradeOrders: '/rest/alibaba/order/list',
  getTradeOrderLogistics: '/rest/order/logistics/query',
  getProductInventory: '/rest/icbu/product/inventory/get'
} as const;
export type ReadOperation = keyof typeof READ_PATHS;
// Reading a group tree includes its root and bounded, unique child lookups.
const MAX_GROUP_READS = 30;
function requestLimit(operation: ReadOperation): number {
  return operation === 'listProductGroups' ? MAX_GROUP_READS : 1;
}
type Payload = Record<string, unknown>;
export interface ReadRecord {
  operation: ReadOperation;
  requestId: string;
  status: 'passed' | 'no-data' | 'failed' | 'skipped-prerequisite';
  count: number;
  errorCode?: string;
  networkRequests: number;
}

export function parseOptions(args: readonly string[]): {
  credential: string;
  productId?: string;
  nativeHostConsent?: true;
} {
  const inputs = args.filter((arg) => arg.startsWith('--credential='));
  const products = args.filter((arg) => arg.startsWith('--product-id='));
  if (
    inputs.length !== 1 ||
    args.filter((arg) => arg === '--confirm-readonly').length !== 1 ||
    args.filter((arg) => arg === '--native-host-consent').length > 1 ||
    products.length > 1 ||
    args.some(
      (arg) =>
        !arg.startsWith('--credential=') &&
        !arg.startsWith('--product-id=') &&
        arg !== '--confirm-readonly' &&
        arg !== '--native-host-consent'
    )
  )
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const credential = inputs[0]?.slice('--credential='.length).trim();
  if (!credential) throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const productId = products[0]?.slice('--product-id='.length);
  if (products.length && !safeNumericId(productId)) throw new Error('PRODUCT_ID_INVALID');
  return {
    credential,
    ...(productId ? { productId } : {}),
    ...(args.includes('--native-host-consent') ? { nativeHostConsent: true as const } : {})
  };
}

export function readIopBundle(value: unknown) {
  const candidate = isRecord(value) && 'authorization' in value ? value.authorization : value;
  if (!isRecord(candidate) || candidate.protocol !== 'iop') throw new Error('EXPLICIT_IOP_BUNDLE_REQUIRED');
  try {
    const bundle = parseAlibabaOpenApiCredentialBundle(candidate);
    if (bundle.oauth.expiresAtUtc !== null && Date.parse(bundle.oauth.expiresAtUtc) <= Date.now() + 600000)
      throw new Error('REAUTHORIZE_BEFORE_ACCEPTANCE');
    return bundle;
  } catch {
    throw new Error('IOP_BUNDLE_INVALID');
  }
}

const SAFE_CODES = new Set([
  'ALIBABA_IOP_METHOD_UNSUPPORTED',
  'ALIBABA_IOP_PARAMETER_UNSUPPORTED',
  'ALIBABA_IOP_PHOTO_GROUP_REQUIRED',
  'ALIBABA_IOP_RESPONSE_INVALID',
  'ALIBABA_IOP_API_REJECTED',
  'ALIBABA_IOP_BUSINESS_REJECTED',
  'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
  'ALIBABA_PROTOCOL_INVALID',
  'CAPABILITY_RESTRICTED',
  'REQUEST_CONTRACT_INVALID',
  'RESPONSE_CONTRACT_INVALID',
  'INVALID_OPERATION_PAYLOAD',
  'ALIBABA_SCHEMA_RENDER_FAILED',
  'PRODUCT_CONTEXT_CHANGED',
  'PRODUCT_CONTEXT_INVALID',
  'CREDENTIAL_VAULT_LOCKED',
  'MISSING_CREDENTIALS',
  'NETWORK_ERROR',
  'NETWORK_HTTP_ERROR',
  'NETWORK_REDIRECT_DENIED',
  'NETWORK_URL_DENIED',
  'NETWORK_RESPONSE_TOO_LARGE',
  'REQUEST_TIMEOUT',
  'INVALID_JSON_RESPONSE',
  'GATEWAY_ERROR',
  'UNKNOWN_ERROR'
]);
export function safeErrorCode(value: unknown): string {
  return typeof value === 'string' && SAFE_CODES.has(value) ? value : 'ERROR_REDACTED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function positiveId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,63}$/u.test(value);
}
function safeNumericId(value: unknown): value is string {
  return positiveId(value) && Number.isSafeInteger(Number(value));
}
function items(value: unknown): Record<string, unknown>[] {
  const list = isRecord(value) ? value.items : value;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

export function summarizeRead(operation: ReadOperation, value: unknown): number {
  if (operation === 'listProductGroups' || operation === 'listPhotoGroups') {
    if (Array.isArray(value) && value.every(isRecord)) return value.length;
  } else if (['listProducts', 'listPhotos', 'listTradeOrders'].includes(operation)) {
    if (isRecord(value) && Array.isArray(value.items) && value.items.every(isRecord))
      return value.items.length;
  } else if (operation === 'renderProductSchema') {
    if (isRecord(value) && typeof value.xml === 'string' && value.xml.trim()) return 1;
  } else if (operation === 'getProductInventory') {
    if (
      isRecord(value) &&
      (value.status === 'ready' || value.status === 'no-data') &&
      Array.isArray(value.records) &&
      value.records.every(isRecord) &&
      Array.isArray(value.issues) &&
      value.issues.length === 0 &&
      (value.status === 'ready' ? value.records.length > 0 : value.records.length === 0)
    )
      return value.records.length;
  } else if (isRecord(value) && typeof value.status === 'string' && positiveId(value.orderId)) {
    return value.status === 'unknown' && !value.carrier && !value.trackingNumber ? 0 : 1;
  }
  throw new Error('READ_RESULT_INVALID');
}

/** Only live IDs from the preceding response can unlock dependent reads. No example IDs. */
export async function runReadPlan(
  call: (operation: ReadOperation, payload: Payload) => Promise<unknown>,
  skip: (operation: ReadOperation, reason: string) => void,
  productId?: string
): Promise<void> {
  const products = await call('listProducts', {
    page: 1,
    pageSize: 1,
    language: 'en_US',
    ...(productId ? { productId } : {})
  });
  await call('listProductGroups', {});
  const groups = await call('listPhotoGroups', {});
  const group = items(groups).find((entry) => positiveId(entry.id));
  if (group) await call('listPhotos', { groupId: group.id, page: 1, pageSize: 1 });
  else skip('listPhotos', 'NO_VALID_PHOTO_GROUP');
  const product = items(products).find(
    (entry) => safeNumericId(entry.id) && (!productId || entry.id === productId)
  );
  if (product) {
    const category = product.categoryId;
    if (typeof category === 'number' && Number.isSafeInteger(category) && category > 0)
      await call('renderProductSchema', { productId: product.id, categoryId: category, language: 'en_US' });
    else skip('renderProductSchema', 'NO_VALID_PRODUCT_CATEGORY');
    await call('getProductInventory', { productId: product.id, source: 'product', language: 'en_US' });
  } else {
    skip('renderProductSchema', 'NO_VALID_PRODUCT');
    skip('getProductInventory', 'NO_VALID_PRODUCT');
  }
  const orders = await call('listTradeOrders', { page: 1, pageSize: 1 });
  // Order IDs stay strings even beyond Number.MAX_SAFE_INTEGER.
  const order = items(orders).find((entry) => positiveId(entry.id));
  if (order) await call('getTradeOrderLogistics', { orderId: order.id });
  else skip('getTradeOrderLogistics', 'NO_VALID_ORDER');
}

export interface WorkerGuard {
  arm(operation: ReadOperation, requestId: string): void;
  disarm(): void;
  snapshot(): { sent: number; total: number; blocked: number };
}
type GuardGlobal = typeof globalThis & { __iopReadSmokeGuard?: WorkerGuard };

/** Serialized directly into the isolated real worker; also exercised with an offline fetch stub. */
export function installReadOnlyGuard(config: {
  origin: string;
  paths: Record<ReadOperation, string>;
  intervalMs: number;
  maxGroupReads?: number;
}): void {
  const host = globalThis as GuardGlobal;
  if (host.__iopReadSmokeGuard) throw new Error('READ_GUARD_ALREADY_INSTALLED');
  const originalFetch = host.fetch.bind(host);
  let active: { path: string; requestId: string; sent: number; limit: number; groups: Set<string> } | null =
    null;
  let queue: Promise<void> = Promise.resolve();
  let busy = false;
  let lastStarted = 0;
  let total = 0;
  let blocked = 0;
  host.__iopReadSmokeGuard = {
    arm(operation, requestId) {
      if (active || busy || !Object.hasOwn(config.paths, operation)) throw new Error('READ_GUARD_ARM_DENIED');
      active = {
        path: config.paths[operation],
        requestId,
        sent: 0,
        limit: operation === 'listProductGroups' ? (config.maxGroupReads ?? 1) : 1,
        groups: new Set()
      };
    },
    disarm() {
      active = null;
    },
    snapshot() {
      return { sent: active?.sent ?? 0, total, blocked };
    }
  };
  host.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const current = active;
    const deny = (): never => {
      blocked++;
      throw new Error('READ_ONLY_NETWORK_DENIED');
    };
    if (
      !current ||
      current.sent >= current.limit ||
      url.origin !== config.origin ||
      url.pathname !== current.path ||
      url.search ||
      url.username ||
      url.password ||
      request.method !== 'POST' ||
      request.headers.get('X-Request-ID') !== current.requestId
    )
      return deny();
    // Reserve before the first await: a concurrent duplicate cannot get through.
    current.sent++;
    busy = true;
    const previous = queue;
    const completed = Promise.withResolvers<undefined>();
    queue = completed.promise;
    try {
      await previous;
      const parameters = new URLSearchParams(await request.clone().text());
      if (
        parameters.has('method') ||
        parameters.has('session') ||
        parameters.get('sign_method') !== 'sha256' ||
        !parameters.get('access_token') ||
        !parameters.get('sign') ||
        (current.path.endsWith('/photobank/list') &&
          !/^[1-9][0-9]{0,63}$/u.test(parameters.get('groupId') ?? ''))
      )
        return deny();
      if (current.path.endsWith('/product/group/get')) {
        const id = parameters.get('group_id') ?? '';
        if (!/^(?:-1|[1-9][0-9]*)$/u.test(id) || current.groups.has(id)) return deny();
        current.groups.add(id);
      }
      const wait = Math.max(0, config.intervalMs - (Date.now() - lastStarted));
      if (wait) await new Promise<void>((done) => setTimeout(done, wait));
      if (active !== current) return deny();
      lastStarted = Date.now();
      total++;
      // The transport's manual redirects must not be followed, including same-host redirects.
      return await originalFetch(new Request(request, { redirect: 'error' }));
    } finally {
      busy = false;
      completed.resolve(undefined);
    }
  };
}

export async function buildDigest(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string, prefix: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(resolve(path, entry.name), `${name}/`);
      else if (entry.isFile()) {
        hash
          .update(name)
          .update('\0')
          .update(await readFile(resolve(path, entry.name)))
          .update('\0');
      } else throw new Error('BUILD_COPY_INVALID');
    }
  }
  await visit(directory, '');
  return hash.digest('hex');
}

async function send(page: Page, message: Payload): Promise<unknown> {
  return page.evaluate(
    (input) =>
      (
        globalThis as unknown as {
          chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } };
        }
      ).chrome.runtime.sendMessage(input),
    message
  );
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  const bundle = readIopBundle(JSON.parse(await readFile(resolve(options.credential), 'utf8')) as unknown);
  const root = resolve(import.meta.dirname, '..');
  const runId = randomUUID();
  await mkdir(resolve(root, 'artifacts/iop-workbench-read-validation'), { recursive: true });
  const directory = resolve(root, 'artifacts/iop-workbench-read-validation', runId);
  const temporary = await mkdtemp(`${directory}-`);
  const extension = resolve(temporary, 'extension');
  const profile = resolve(temporary, 'profile');
  const reportPath = resolve(temporary, 'report.json');
  const records: ReadRecord[] = [];
  const report = {
    runId,
    capturedAtUtc: new Date().toISOString(),
    status: 'failed' as 'passed' | 'partial' | 'failed',
    errorCode: null as string | null,
    stage: 'copy-build',
    protocol: 'iop',
    buildSha256: '',
    productionBuildCopiedUnchanged: false,
    isolatedProfile: true,
    configuredCredentialsReplaced: false,
    nativePermissionConsentTested: false,
    isolatedManifestPregrant: options.nativeHostConsent ? null : `${IOP_API_ORIGIN}/*`,
    encryptedVaultConfirmed: false,
    protocolPersisted: false,
    tokenRenewed: false,
    tokenRequests: 0,
    mutations: 0,
    topRequests: 0,
    networkRequests: 0,
    blockedRequests: 0,
    maxRequestsPerOperation: { default: 1, listProductGroups: MAX_GROUP_READS },
    minimumIntervalMs: 350,
    noFullResponses: true,
    records
  };
  let context: BrowserContext | null = null;
  let armed: { operation: ReadOperation; requestId: string; count: number } | null = null;
  let lastWireStart = 0;
  let routeBusy = false;
  try {
    const source = resolve(root, 'apps/extension/.output/chrome-mv3');
    const digest = await buildDigest(source);
    await cp(source, extension, { recursive: true, errorOnExist: true, force: false });
    if ((await buildDigest(source)) !== digest || (await buildDigest(extension)) !== digest)
      throw new Error('BUILD_CHANGED_DURING_COPY');
    report.buildSha256 = digest;
    report.productionBuildCopiedUnchanged = true;
    const manifest: unknown = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    if (
      !isRecord(manifest) ||
      manifest.manifest_version !== 3 ||
      !isRecord(manifest.background) ||
      typeof manifest.background.service_worker !== 'string' ||
      !Array.isArray(manifest.host_permissions) ||
      !manifest.host_permissions.every((entry: unknown) => typeof entry === 'string')
    )
      throw new Error('MV3_BUILD_REQUIRED');
    // ONLY this disposable manifest changes. No endpoint/signing/code substitutions.
    if (!options.nativeHostConsent) {
      manifest.host_permissions = [...new Set([...manifest.host_permissions, `${IOP_API_ORIGIN}/*`])];
      await atomicWriteJson(resolve(extension, 'manifest.json'), manifest);
    } else if (manifest.host_permissions.includes(`${IOP_API_ORIGIN}/*`)) {
      throw new Error('NATIVE_HOST_MUST_START_UNGRANTED');
    }
    report.stage = 'launch';
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      locale: 'zh-CN',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    // tsx preserves names through a helper when Playwright serializes our test callbacks.
    // This inert test helper does not change the shipped extension code or transport.
    await context.addInitScript({ content: 'globalThis.__name = (value) => value;' });
    // A second network boundary also covers UI auto-reads and a restarted worker.
    await context.route(/^https?:\/\//u, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const current = armed;
      if (
        !current ||
        routeBusy ||
        current.count >= requestLimit(current.operation) ||
        url.origin !== IOP_API_ORIGIN ||
        url.pathname !== READ_PATHS[current.operation] ||
        url.search ||
        request.method() !== 'POST' ||
        request.headers()['x-request-id'] !== current.requestId ||
        !request.serviceWorker()
      ) {
        report.blockedRequests++;
        await route.abort('blockedbyclient');
        return;
      }
      current.count++;
      routeBusy = true;
      try {
        await delay(Math.max(0, 350 - (Date.now() - lastWireStart)));
        if (armed !== current) {
          report.blockedRequests++;
          await route.abort('blockedbyclient');
          return;
        }
        lastWireStart = Date.now();
        report.networkRequests++;
        await route.continue();
      } finally {
        routeBusy = false;
      }
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const workerUrl = new URL(worker.url());
    if (workerUrl.protocol !== 'chrome-extension:') throw new Error('MV3_WORKER_REQUIRED');
    await worker.evaluate('globalThis.__name = (value) => value;');
    await worker.evaluate(installReadOnlyGuard, {
      origin: IOP_API_ORIGIN,
      paths: READ_PATHS,
      intervalMs: 350,
      maxGroupReads: MAX_GROUP_READS
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    report.stage = 'import-save';
    await page.goto(`chrome-extension://${workerUrl.host}/options.html#/settings`);
    report.stage = 'onboarding';
    const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await onboarding.getByRole('checkbox').check();
    await onboarding.getByRole('button', { name: '稍后，仅浏览', exact: true }).click();
    await page.goto(`chrome-extension://${workerUrl.host}/options.html#/settings`);
    const empty = await send(page, {
      kind: 'credential-vault-request',
      operation: 'status',
      requestId: randomUUID()
    });
    if (!isRecord(empty) || empty.ok !== true || !isRecord(empty.data) || empty.data.state !== 'empty')
      throw new Error('ISOLATED_EMPTY_VAULT_REQUIRED');
    report.stage = 'import-bundle';
    await page.getByLabel(settingsZh.credentials.importLabel).setInputFiles({
      name: 'credentialInfo.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle))
    });
    await page.waitForFunction(
      ({ protocolLabel, endpointLabel, endpoint }) => {
        const field = (label: string) =>
          document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
        return field(protocolLabel)?.value === 'iop' && field(endpointLabel)?.value === endpoint;
      },
      {
        protocolLabel: credentialsZh.protocol,
        endpointLabel: settingsZh.credentials.gateway,
        endpoint: IOP_BUSINESS_ENDPOINT
      }
    );
    report.stage = 'save-vault';
    const passphrase = randomBytes(24).toString('base64url');
    await page.getByLabel(settingsZh.vault.setPassphrase, { exact: true }).fill(passphrase);
    await page.getByLabel(settingsZh.vault.confirmPassphrase, { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: settingsZh.credentials.save, exact: true }).click();
    if (options.nativeHostConsent)
      process.stdout.write('Please allow openapi-api.alibaba.com in this isolated Chromium window.\n');
    // Only a boolean crosses back; no plaintext/ciphertext/settings dumps are retained.
    await page.waitForFunction(
      () => {
        const input = document.querySelector<HTMLInputElement>('[aria-label="Access Token"]');
        return input?.value === '';
      },
      undefined,
      { timeout: options.nativeHostConsent ? 600_000 : 20_000 }
    );
    if (options.nativeHostConsent) {
      report.nativePermissionConsentTested = await worker.evaluate(async (origin) => {
        const chrome = (
          globalThis as unknown as {
            chrome: { permissions: { contains(value: { origins: string[] }): Promise<boolean> } };
          }
        ).chrome;
        return chrome.permissions.contains({ origins: [`${origin}/*`] });
      }, IOP_API_ORIGIN);
      if (!report.nativePermissionConsentTested) throw new Error('NATIVE_HOST_GRANT_NOT_CONFIRMED');
    }
    report.stage = 'verify-vault';
    report.encryptedVaultConfirmed = await worker.evaluate(
      async (secrets) => {
        const storage = (
          globalThis as unknown as {
            chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
          }
        ).chrome.storage.local;
        const all = await storage.get('gatewaySettings');
        const value = all.gatewaySettings;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
        const record = value as Record<string, unknown>;
        const cipher = record.cipher as { ciphertext?: unknown } | undefined;
        return (
          record.version === 2 &&
          record.format === 'PBKDF2-HMAC-SHA256/AES-256-GCM' &&
          typeof cipher?.ciphertext === 'string' &&
          cipher.ciphertext.length > 0 &&
          secrets.every((secret) => !JSON.stringify(all).includes(secret))
        );
      },
      [bundle.application.appKey, bundle.application.appSecret, bundle.oauth.accessToken, passphrase]
    );
    if (!report.encryptedVaultConfirmed) throw new Error('ENCRYPTED_VAULT_NOT_CONFIRMED');
    await page.reload();
    const settings = await send(page, {
      kind: 'credential-vault-request',
      operation: 'get-settings',
      requestId: randomUUID()
    });
    const status = await send(page, {
      kind: 'credential-vault-request',
      operation: 'status',
      requestId: randomUUID()
    });
    report.protocolPersisted =
      isRecord(settings) &&
      settings.ok === true &&
      isRecord(settings.data) &&
      settings.data.protocol === 'iop' &&
      settings.data.endpoint === IOP_BUSINESS_ENDPOINT &&
      settings.data.signMethod === 'hmac-sha256' &&
      settings.data.appSecret === '' &&
      settings.data.accessToken === '' &&
      isRecord(status) &&
      status.ok === true &&
      isRecord(status.data) &&
      status.data.protocol === 'iop' &&
      status.data.state === 'unlocked';
    if (!report.protocolPersisted) throw new Error('IOP_SETTINGS_NOT_CONFIRMED');
    const operationContext = await send(page, { kind: 'product-operation-context', requestId: randomUUID() });
    if (!isRecord(operationContext) || operationContext.ok !== true) throw new Error('READ_CONTEXT_REQUIRED');
    const productContext = requireProductOperationContext(operationContext.data);
    report.stage = 'runtime-reads';
    await runReadPlan(
      async (operation, payload) => {
        const requestId = randomUUID();
        const entry: ReadRecord = { operation, requestId, status: 'failed', count: 0, networkRequests: 0 };
        records.push(entry);
        armed = { operation, requestId, count: 0 };
        await worker.evaluate(
          ({ operation, requestId }) => {
            (globalThis as GuardGlobal).__iopReadSmokeGuard?.arm(operation, requestId);
          },
          { operation, requestId }
        );
        let data: unknown = null;
        let guardValid: boolean;
        try {
          const response = await send(page, {
            kind: 'gateway-request',
            operation,
            payload,
            requestId,
            productContext
          });
          if (!isRecord(response) || response.requestId !== requestId || typeof response.ok !== 'boolean')
            entry.errorCode = 'RUNTIME_ENVELOPE_INVALID';
          else if (!response.ok)
            entry.errorCode = safeErrorCode(isRecord(response.error) ? response.error.code : null);
          else {
            entry.count = summarizeRead(operation, response.data);
            entry.status = entry.count ? 'passed' : 'no-data';
            data = response.data;
          }
        } catch {
          entry.errorCode = 'RUNTIME_READ_NOT_CONFIRMED';
        } finally {
          entry.networkRequests = armed.count;
          const snapshot = await worker.evaluate(() =>
            (globalThis as GuardGlobal).__iopReadSmokeGuard?.snapshot()
          );
          await worker.evaluate(() => (globalThis as GuardGlobal).__iopReadSmokeGuard?.disarm());
          armed = null;
          guardValid =
            !!snapshot &&
            snapshot.blocked === 0 &&
            snapshot.sent <= requestLimit(operation) &&
            snapshot.sent === entry.networkRequests;
          await delay(350);
        }
        if (!guardValid) throw new Error('READ_NETWORK_GUARD_NOT_CONFIRMED');
        if (
          entry.status !== 'failed' &&
          (entry.networkRequests < 1 || entry.networkRequests > requestLimit(operation))
        ) {
          entry.status = 'failed';
          entry.errorCode = 'REAL_NETWORK_READ_NOT_CONFIRMED';
          data = null;
        }
        return data;
      },
      (operation, reason) =>
        records.push({
          operation,
          requestId: randomUUID(),
          status: 'skipped-prerequisite',
          count: 0,
          errorCode: reason,
          networkRequests: 0
        }),
      options.productId
    );
    report.status =
      report.blockedRequests || records.some((entry) => entry.status === 'failed')
        ? 'failed'
        : records.some((entry) => entry.status === 'skipped-prerequisite')
          ? 'partial'
          : 'passed';
    report.stage = 'complete';
  } catch (error: unknown) {
    report.status = 'failed';
    report.errorCode =
      error instanceof Error && /^[A-Z_]{1,80}$/u.test(error.message)
        ? error.message
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'UI_TIMEOUT'
          : 'ACCEPTANCE_NOT_CONFIRMED';
  } finally {
    // Lock only our disposable vault; neither active TOP settings nor existing user tabs are touched.
    if (context) {
      try {
        const page = context.pages().find((entry) => entry.url().includes('/options.html'));
        if (page)
          await send(page, { kind: 'credential-vault-request', operation: 'lock', requestId: randomUUID() });
      } catch {
        // Closing this owned context also drops its session-only unlock material.
      }
      await context.close();
    }
    await atomicWriteJson(reportPath, report);
    process.stdout.write(`${JSON.stringify({ ...report, reportPath })}\n`);
    if (report.status === 'failed') process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    process.stdout.write(
      'Existing MV3 build, isolated encrypted IOP profile, read-only; no refresh/mutations.\n' +
        'pnpm exec tsx scripts/smoke-iop-workbench-real.ts --confirm-readonly --credential=<IOP JSON>\n' +
        'Native permission consent is NOT tested; only the isolated manifest pregrants https://openapi-api.alibaba.com/*.\n'
    );
  } else {
    try {
      await main(process.argv.slice(2));
    } catch {
      // Never print parser, filesystem, Playwright, provider or browser errors containing private values.
      process.stderr.write(
        'IOP_WORKBENCH_READ_PREFLIGHT_FAILED: use --help; no retry or renewal was attempted.\n'
      );
      process.exitCode = 1;
    }
  }
}
