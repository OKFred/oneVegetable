/** Existing MV3 build only; isolated encrypted profile, never a rebuild or native-permission claim. */
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { GatewayException } from '../packages/core/src/errors';
import { IOP_API_ORIGIN, IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { ONBOARDING_STORAGE_KEY, completeOnboarding } from '../packages/core/src/privacy';
import { requireProductOperationContext } from '../packages/core/src/product-operation-context';
import type { GatewayClient, ResponseOf } from '../packages/core/src/types';
import { buildDigest } from './smoke-iop-workbench-real';
import {
  REFERENCE_METHODS,
  assertIgnoredFile,
  parseOptions,
  readIopBundle,
  runGatewayAcceptance,
  safeErrorCode,
  summarizeReceipt
} from './smoke-product-reference-real';
import type {
  EqualityChecks,
  ReadObservation,
  ReferenceGuardSnapshot,
  ReferenceOperation,
  ReferencePlanGuard
} from './smoke-product-reference-real';
import { atomicWriteJson } from './openapi-auth/storage';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export interface WorkerGuard {
  arm(operation: ReferenceOperation, requestId: string): void;
  disarm(): void;
  snapshot(): ReferenceGuardSnapshot;
}
type GuardGlobal = typeof globalThis & { __productReferenceGuard?: WorkerGuard };

/** Self-contained for Playwright worker.evaluate; no imports, signing, fallback or provider parsing. */
export function installReferenceWorkerGuard(): void {
  const paths = Object.freeze({
    getProduct: '/rest/alibaba/icbu/product/get/v2',
    listCategories: '/rest/alibaba/icbu/category/get/v2',
    predictCategory: '/rest/alibaba/icbu/category/predict/v2',
    getAttributes: '/rest/alibaba/icbu/category/attribute/get/v2',
    listShippingTemplates: '/rest/alibaba/icbu/product/list/shipping/templates'
  });
  const host = globalThis as GuardGlobal;
  if (host.__productReferenceGuard) throw new Error('READ_GUARD_ALREADY_INSTALLED');
  const originalFetch = host.fetch.bind(host);
  let active: { operation: ReferenceOperation; requestId: string; attempts: number; sent: number } | null =
    null;
  let busy = false,
    total = 0,
    blocked = 0,
    lastStarted: number | null = null;
  const used = new Set<ReferenceOperation>();
  host.__productReferenceGuard = {
    arm(operation, requestId) {
      if (
        active ||
        busy ||
        used.has(operation) ||
        !Object.hasOwn(paths, operation) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(requestId)
      )
        throw new Error('READ_GUARD_ARM_DENIED');
      used.add(operation);
      active = { operation, requestId, attempts: 0, sent: 0 };
    },
    disarm() {
      active = null;
    },
    snapshot() {
      return { sent: total, total, activeSent: active?.sent ?? 0, blocked };
    }
  };
  host.fetch = async (input, init) => {
    const deny = (): never => {
      blocked++;
      throw new Error('READ_ONLY_NETWORK_DENIED');
    };
    const request = new Request(input, init),
      url = new URL(request.url),
      current = active;
    if (
      !current ||
      busy ||
      current.attempts !== 0 ||
      total >= 10 ||
      url.origin !== 'https://openapi-api.alibaba.com' ||
      url.pathname !== paths[current.operation] ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      request.method !== 'POST' ||
      request.headers.get('X-Request-ID') !== current.requestId
    )
      return deny();
    current.attempts++;
    busy = true;
    try {
      const form = new URLSearchParams(await request.clone().text());
      if (
        form.has('method') ||
        form.has('session') ||
        form.has('refresh_token') ||
        form.get('sign_method') !== 'sha256' ||
        !form.get('app_key') ||
        !form.get('access_token') ||
        !form.get('sign')
      )
        return deny();
      if (lastStarted !== null) {
        let wait = Math.max(0, 350 - (Date.now() - lastStarted));
        while (wait > 0) {
          await new Promise<void>((done) => {
            setTimeout(done, wait);
          });
          wait = Math.max(0, 350 - (Date.now() - lastStarted));
        }
      }
      if (active !== current) return deny();
      lastStarted = Date.now();
      total++;
      current.sent++;
      return await originalFetch(new Request(request, { redirect: 'error' }));
    } finally {
      busy = false;
    }
  };
}

async function send(page: Page, message: Row): Promise<unknown> {
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

export function createMv3ReferenceGateway(
  dispatch: (message: Row) => Promise<unknown>,
  context: unknown
): GatewayClient {
  // Existing shipped background logic pins product-context requests to maxAttempts=1.
  const productContext = requireProductOperationContext(context);
  return {
    async request(operation, payload, options) {
      if (
        operation !== 'callCapability' ||
        !record(payload) ||
        !Object.values(REFERENCE_METHODS).some((method) => method === payload.method) ||
        !options?.requestId
      )
        throw new Error('READ_ONLY_NETWORK_DENIED');
      const result = await dispatch({
        kind: 'gateway-request',
        operation,
        payload,
        requestId: options.requestId,
        productContext
      });
      if (!record(result) || result.requestId !== options.requestId || typeof result.ok !== 'boolean')
        throw new Error('READ_CORRELATION_NOT_CONFIRMED');
      if (!result.ok) {
        // Keep only an allowlisted error code, not the worker/provider's message or payload.
        const errorCode = safeErrorCode(record(result.error) ? result.error : null);
        const traceId =
          record(result.error) && typeof result.error.traceId === 'string' ? result.error.traceId : undefined;
        throw new GatewayException(
          { code: errorCode, message: errorCode, retryable: false, ...(traceId ? { traceId } : {}) },
          options.requestId
        );
      }
      return result.data as ResponseOf<typeof operation>;
    }
  };
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args),
    root = await realpath(resolve(import.meta.dirname, '..'));
  const credentialPath = resolve(root, options.credential),
    outputPath = resolve(root, options.output);
  if (!outputPath.toLowerCase().startsWith((resolve(root, 'artifacts') + sep).toLowerCase()))
    throw new Error('NEW_IGNORED_RECEIPT_REQUIRED');
  await assertIgnoredFile(root, credentialPath);
  await assertIgnoredFile(root, outputPath);
  const stat = await lstat(credentialPath);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('IOP_BUNDLE_INVALID');
  const bundle = readIopBundle(JSON.parse(await readFile(credentialPath, 'utf8')) as unknown);
  await mkdir(dirname(outputPath), { recursive: true });
  const output = await open(outputPath, 'wx', 0o600);
  const directory = await mkdtemp(resolve(dirname(outputPath), 'mv3-reference-'));
  const extension = resolve(directory, 'extension'),
    profile = resolve(directory, 'profile');
  const source = resolve(root, 'apps/extension/.output/chrome-mv3');
  const observations: ReadObservation[] = [];
  let checks: EqualityChecks = {
    productIdExact: null,
    attributeCategoryFromDetail: null,
    predictionCategoryMatchesDetail: null
  };
  let context: BrowserContext | undefined, page: Page | undefined;
  let network: ReferenceGuardSnapshot = { sent: 0, total: 0, activeSent: 0, blocked: 0 };
  let armed: { operation: ReferenceOperation; requestId: string; sent: number } | null = null;
  let routeBusy = false,
    lastRouteStart: number | null = null,
    wireSent = 0,
    routeBlocked = 0;
  let sourceSha256 = '',
    copiedBuildVerified = false,
    sourceBuildUnchanged = false;
  let encryptedVaultConfirmed = false,
    isolatedManifestPregrant = false;
  let stage = 'copy-build',
    failure: string | null = null;
  const report = () => ({
    schemaVersion: 2,
    runtime: 'mv3-isolated-runtime',
    protocol: 'iop',
    capturedAtUtc: new Date().toISOString(),
    predictionTitleSource:
      options.predictionTitle === undefined ? 'own-sanitized-title' : 'explicit-descriptor',
    ...summarizeReceipt(observations, checks),
    observations,
    network,
    wireSent,
    routeBlocked,
    stage,
    failure,
    sourceSha256,
    copiedBuildVerified,
    sourceBuildUnchanged,
    isolatedManifestPregrant,
    nativePermissionConsentTested: false,
    encryptedVaultConfirmed,
    freshIsolatedProfile: true,
    noLoginOrUserProfileReuse: true,
    userWorkbenchChanged: false,
    importUiTested: false,
    maxRequests: 10,
    maxAttempts: 1,
    minimumIntervalMs: 350,
    providerWrites: 0,
    tokenCalls: 0,
    crossProtocolRetries: 0
  });
  const persist = async () => {
    const text = JSON.stringify(report(), null, 2) + '\n';
    await output.truncate(0);
    await output.write(text, 0, 'utf8');
    await output.sync();
  };
  try {
    await persist();
    sourceSha256 = await buildDigest(source);
    await cp(source, extension, { recursive: true, errorOnExist: true, force: false });
    if ((await buildDigest(source)) !== sourceSha256 || (await buildDigest(extension)) !== sourceSha256)
      throw new Error('BUILD_CHANGED_DURING_COPY');
    copiedBuildVerified = true;
    const manifest: unknown = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    if (
      !record(manifest) ||
      manifest.manifest_version !== 3 ||
      !record(manifest.background) ||
      typeof manifest.background.service_worker !== 'string' ||
      !Array.isArray(manifest.host_permissions) ||
      !manifest.host_permissions.every((host) => typeof host === 'string')
    )
      throw new Error('MV3_BUILD_REQUIRED');
    // Only the disposable copy pregrants the exact native IOP origin. Production manifest is read-only.
    manifest.host_permissions = [...new Set([...manifest.host_permissions, `${IOP_API_ORIGIN}/*`])];
    await atomicWriteJson(resolve(extension, 'manifest.json'), manifest);
    isolatedManifestPregrant = true;
    stage = 'launch';
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      locale: 'zh-CN',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.addInitScript({ content: 'globalThis.__name = (value) => value;' });
    await context.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: ONBOARDING_STORAGE_KEY, value: completeOnboarding() }
    );
    // A separate browser route gate covers unarmed UI traffic and worker restarts too.
    await context.route(/^https?:\/\//u, async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        current = armed;
      if (
        !current ||
        routeBusy ||
        current.sent !== 0 ||
        wireSent >= 10 ||
        url.origin !== IOP_API_ORIGIN ||
        url.pathname !== '/rest' + REFERENCE_METHODS[current.operation] ||
        url.search ||
        url.username ||
        url.password ||
        request.method() !== 'POST' ||
        request.headers()['x-request-id'] !== current.requestId ||
        !request.serviceWorker()
      ) {
        routeBlocked++;
        await route.abort('blockedbyclient');
        return;
      }
      current.sent++;
      routeBusy = true;
      try {
        if (lastRouteStart !== null) await delay(Math.max(0, 350 - (Date.now() - lastRouteStart)));
        if (armed !== current) {
          routeBlocked++;
          await route.abort('blockedbyclient');
          return;
        }
        lastRouteStart = Date.now();
        wireSent++;
        await route.continue();
      } finally {
        routeBusy = false;
      }
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const workerUrl = new URL(worker.url());
    if (workerUrl.protocol !== 'chrome-extension:') throw new Error('MV3_WORKER_REQUIRED');
    await worker.evaluate('globalThis.__name = (value) => value;');
    await worker.evaluate(installReferenceWorkerGuard);
    page = await context.newPage();
    await page.goto(`chrome-extension://${workerUrl.host}/options.html#/settings`);
    stage = 'create-isolated-vault';
    const empty = await send(page, {
      kind: 'credential-vault-request',
      operation: 'status',
      requestId: randomUUID()
    });
    if (!record(empty) || empty.ok !== true || !record(empty.data) || empty.data.state !== 'empty')
      throw new Error('ISOLATED_EMPTY_VAULT_REQUIRED');
    const passphrase = randomBytes(32).toString('base64url');
    // Use the shipped vault API. Omit the refresh token completely so this profile cannot renew.
    const created = await send(page, {
      kind: 'credential-vault-request',
      operation: 'create',
      requestId: randomUUID(),
      payload: {
        passphrase,
        settings: {
          protocol: 'iop',
          appKey: bundle.application.appKey,
          appSecret: bundle.application.appSecret,
          accessToken: bundle.oauth.accessToken,
          accessTokenExpiresTimeUtc: Date.parse(bundle.oauth.expiresAtUtc ?? ''),
          endpoint: IOP_BUSINESS_ENDPOINT,
          signMethod: 'hmac-sha256'
        }
      }
    });
    if (
      !record(created) ||
      created.ok !== true ||
      !record(created.data) ||
      created.data.state !== 'unlocked' ||
      created.data.protocol !== 'iop'
    )
      throw new Error('IOP_VAULT_NOT_CONFIRMED');
    encryptedVaultConfirmed = await worker.evaluate(
      async (secrets) => {
        const storage = (
          globalThis as unknown as {
            chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
          }
        ).chrome.storage.local;
        const all = await storage.get('gatewaySettings'),
          value = all.gatewaySettings;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>,
          cipher = item.cipher as { ciphertext?: unknown } | undefined;
        return (
          item.version === 2 &&
          item.format === 'PBKDF2-HMAC-SHA256/AES-256-GCM' &&
          typeof cipher?.ciphertext === 'string' &&
          cipher.ciphertext.length > 0 &&
          secrets.every((secret) => !JSON.stringify(all).includes(secret))
        );
      },
      [bundle.application.appKey, bundle.application.appSecret, bundle.oauth.accessToken, passphrase]
    );
    if (!encryptedVaultConfirmed) throw new Error('ENCRYPTED_VAULT_NOT_CONFIRMED');
    const guard: ReferencePlanGuard = {
      async arm(operation, requestId) {
        await worker.evaluate(
          ({ operation, requestId }) => {
            const guard = (globalThis as GuardGlobal).__productReferenceGuard;
            if (!guard) throw new Error('READ_GUARD_MISSING');
            guard.arm(operation, requestId);
          },
          { operation, requestId }
        );
        armed = { operation, requestId, sent: 0 };
      },
      async disarm() {
        await worker.evaluate(() => {
          (globalThis as GuardGlobal).__productReferenceGuard?.disarm();
        });
        armed = null;
      },
      async snapshot() {
        const snapshot = await worker.evaluate(() =>
          (globalThis as GuardGlobal).__productReferenceGuard?.snapshot()
        );
        if (!snapshot) throw new Error('READ_GUARD_MISSING');
        network = snapshot;
        return snapshot;
      }
    };
    const contextResult = await send(page, { kind: 'product-operation-context', requestId: randomUUID() });
    if (!record(contextResult) || contextResult.ok !== true) throw new Error('READ_CONTEXT_REQUIRED');
    const bridge = createMv3ReferenceGateway((message) => {
      if (!page) throw new Error('MV3_PAGE_REQUIRED');
      return send(page, message);
    }, contextResult.data);
    stage = 'runtime-reads';
    checks = await runGatewayAcceptance(
      bridge,
      guard,
      options.productId,
      observations,
      [bundle.application.appKey, bundle.application.appSecret, bundle.oauth.accessToken, passphrase],
      persist,
      options.predictionTitle
    );
    network = await guard.snapshot();
    if (routeBlocked || network.blocked || wireSent !== network.sent)
      throw new Error('READ_ONLY_NETWORK_DENIED');
    sourceBuildUnchanged = (await buildDigest(source)) === sourceSha256;
    if (!sourceBuildUnchanged) throw new Error('BUILD_CHANGED_DURING_ACCEPTANCE');
    stage = 'complete';
  } catch (error: unknown) {
    failure = safeErrorCode(error);
  } finally {
    // Lock/close only this owned isolated context, never the user's browser or work pages.
    try {
      if (page)
        await send(page, { kind: 'credential-vault-request', operation: 'lock', requestId: randomUUID() });
    } catch {
      /* Session ends with context. */
    }
    if (context) await context.close();
    try {
      await persist();
    } finally {
      await output.close();
    }
  }
  const summary = summarizeReceipt(observations, checks);
  process.stdout.write(
    JSON.stringify({
      runtime: 'mv3-isolated-runtime',
      ...summary,
      network,
      wireSent,
      routeBlocked,
      nativePermissionConsentTested: false,
      failure
    }) + '\n'
  );
  if (failure || routeBlocked || network.blocked || !summary.accepted || !summary.dataConsistent)
    process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help')
    process.stdout.write(
      'Existing MV3 build, fresh encrypted profile; exact IOP pregrant in COPY ONLY, not native permission acceptance.\n' +
        'pnpm exec tsx scripts/smoke-product-reference-extension-real.ts --confirm-readonly --credential=<ignored IOP bundle> --product-id=<known own product> --output=<new artifacts receipt> [--prediction-title=<human descriptor>]\n'
    );
  else {
    try {
      await main(process.argv.slice(2));
    } catch {
      process.stderr.write(
        'PRODUCT_REFERENCE_MV3_PREFLIGHT_FAILED: raw errors and credentials are not printed.\n'
      );
      process.exitCode = 1;
    }
  }
}
