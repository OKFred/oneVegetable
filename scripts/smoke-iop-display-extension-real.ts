/**
 * PREPARATION ONLY until the operator authorizes execution after BFF acceptance and gate opening.
 * Existing formal MV3 build; no build, source patch, TOP fallback, token renewal or automatic recovery.
 * Every invocation needs a NEW ignored --report (its durable .claim is never removed).
 * --product-id is mandatory: suggested neutral alternative 1601986587338, not an authorization default.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import type { ProductMutationJob } from '../packages/core/src/product-mutation-job';
import { isProductMutationJob } from '../packages/core/src/product-mutation-job-client';
import {
  requireProductOperationContext,
  type ProductOperationContext
} from '../packages/core/src/product-operation-context';
import { IOP_API_ORIGIN, IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { gatewayCredentials as credentialsZh } from '../packages/ui/src/i18n/messages/zh-CN/gatewayCredentials';
import { atomicWriteJson } from './openapi-auth/storage';
import { buildDigest, readIopBundle, safeErrorCode } from './smoke-iop-workbench-real';

export const DISPLAY_PATHS = {
  list: '/rest/alibaba/icbu/product/list',
  write: '/rest/icbu/product/update/display'
} as const;
export const SUGGESTED_PRODUCT_ID = '1601986587338';
const JOBS_KEY = 'one-vegetable-extension-product-mutation-jobs-v1';
const POLL_LIMIT = 12;
const RESTORE_POLL_LIMIT = 180;
const INTERVAL_MS = 350;
const MAX_REQUESTS = 200;
type Display = 'online' | 'offline';
export type Phase = 'baseline' | 'submit' | 'target-poll' | 'recover' | 'restore-poll' | 'refresh';
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
class AcceptanceStop extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function stop(code: string): never {
  throw new AcceptanceStop(code);
}
function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) && Number.isSafeInteger(Number(value));
}

export function parseOptions(args: readonly string[]) {
  const keys = ['--credential=', '--product-id=', '--report='];
  if (
    args.filter((arg) => arg === '--confirm-real-write').length !== 1 ||
    args.filter((arg) => arg === '--native-host-consent').length > 1 ||
    keys.some((key) => args.filter((arg) => arg.startsWith(key)).length !== 1) ||
    args.some(
      (arg) =>
        !keys.some((key) => arg.startsWith(key)) &&
        !['--confirm-real-write', '--native-host-consent'].includes(arg)
    )
  )
    stop('EXPLICIT_ARGUMENTS_REQUIRED');
  const option = (key: string) => {
    const input = args.find((arg) => arg.startsWith(key));
    if (!input) stop('EXPLICIT_ARGUMENTS_REQUIRED');
    return input.slice(key.length);
  };
  const credential = option('--credential='),
    productId = option('--product-id='),
    report = option('--report=');
  if (!credential.trim() || !report.trim() || !safeId(productId)) stop('EXPLICIT_ARGUMENTS_REQUIRED');
  return { credential, productId, report, nativeHostConsent: args.includes('--native-host-consent') };
}

export function reportLocation(root: string, input: string): string {
  const path = resolve(root, input);
  const name = relative(resolve(root, 'artifacts'), path);
  if (
    !name ||
    name === '..' ||
    name.startsWith('..' + sep) ||
    resolve(root, 'artifacts', name) !== path ||
    !path.endsWith('.json') ||
    relative(resolve(root, 'artifacts'), path).includes(':')
  )
    stop('NEW_IGNORED_REPORT_REQUIRED');
  return path;
}

async function prepareReport(root: string, path: string, value: unknown): Promise<void> {
  // Reject junctions/symlinks, not just lexical traversal, before exclusive report ownership.
  let parent = resolve(root, 'artifacts');
  await mkdir(parent, { recursive: true });
  const pieces = relative(parent, dirname(path)).split(sep).filter(Boolean);
  for (const piece of ['', ...pieces]) {
    if (piece) parent = resolve(parent, piece);
    await mkdir(parent, { recursive: true });
    if ((await lstat(parent)).isSymbolicLink()) stop('REPORT_LINK_DENIED');
  }
  if (
    !(await new Promise<boolean>((done) =>
      execFile('git', ['-C', root, 'check-ignore', '--quiet', '--', relative(root, path)], (error) => {
        done(!error);
      })
    ))
  )
    stop('NEW_IGNORED_REPORT_REQUIRED');
  await claimReport(path, value);
}

export async function claimReport(path: string, value: unknown): Promise<void> {
  const claim = await open(path + '.claim', 'wx', 0o600);
  try {
    await claim.writeFile(JSON.stringify({ claimedAtUtc: new Date().toISOString() }));
    await claim.sync();
  } finally {
    await claim.close();
  }
  const output = await open(path, 'wx', 0o600);
  try {
    await output.writeFile(JSON.stringify(value));
    await output.sync();
  } finally {
    await output.close();
  }
}
async function persist(path: string, value: unknown): Promise<void> {
  await atomicWriteJson(path, value);
  const file = await open(path, 'r+');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export function exactProduct(
  value: unknown,
  productId: string
): { id: string; status: Display; subject: string };
export function exactProduct(
  value: unknown,
  productId: string,
  allowAuditing: true
): { id: string; status: Display | 'auditing'; subject: string };
export function exactProduct(
  value: unknown,
  productId: string,
  allowAuditing = false
): { id: string; status: Display | 'auditing'; subject: string } {
  if (!record(value) || !Array.isArray(value.items) || value.items.length !== 1 || value.total !== 1)
    stop('EXACT_TARGET_REQUIRED');
  const item: unknown = value.items[0];
  if (!record(item) || item.id !== productId) stop('EXACT_TARGET_REQUIRED');
  if (item.status === 'auditing' && !allowAuditing) stop('PLATFORM_AUDITING_STOP');
  if (
    !(allowAuditing ? ['online', 'offline', 'auditing'] : ['online', 'offline']).includes(
      String(item.status)
    ) ||
    item.encryptedId !== null ||
    typeof item.subject !== 'string' ||
    !item.subject.trim()
  )
    stop('NEUTRAL_PLAIN_ID_BASELINE_REQUIRED');
  const marker = item.subject
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/gu, '');
  if (
    /(?:dontedit|donotedit|donottouch|donttouch|donotmodify|禁止修改|禁止编辑|请勿修改|请勿编辑|不要修改|不要编辑|勿动)/u.test(
      marker
    )
  )
    stop('PROTECTED_PRODUCT_DENIED');
  return { id: productId, status: item.status as Display | 'auditing', subject: item.subject };
}

function boundJob(
  value: unknown,
  productId: string,
  context: ProductOperationContext,
  baseline: Display,
  status: string
): ProductMutationJob {
  if (
    !isProductMutationJob(value) ||
    value.operation !== 'updateProductDisplay' ||
    value.productId !== productId ||
    value.protocol !== 'iop' ||
    value.encryptedProductId !== null ||
    value.originalDisplay !== baseline ||
    value.targetDisplay !== (baseline === 'online' ? 'offline' : 'online') ||
    value.status !== status ||
    value.productContext?.identity !== context.identity ||
    value.productContext.gateway !== context.gateway
  )
    stop('PERSISTED_IOP_BINDING_REQUIRED');
  return value;
}
export interface CycleIo {
  read: (phase: 'baseline' | 'target-poll' | 'restore-poll') => Promise<unknown>;
  submit: (display: Display) => Promise<unknown>;
  recover: (job: ProductMutationJob) => Promise<unknown>;
  refresh: (job: ProductMutationJob) => Promise<unknown>;
  stored: (job: ProductMutationJob) => Promise<boolean>;
  save: (phase: string, detail: RecordValue) => Promise<void>;
  wait: () => Promise<void>;
}

/** No catch/finally restoration: unknown results and auditing must not trigger another mutation. */
export async function runDisplayCycle(
  io: CycleIo,
  productId: string,
  context: ProductOperationContext
): Promise<ProductMutationJob> {
  const baseline = exactProduct(await io.read('baseline'), productId);
  const target = baseline.status === 'online' ? 'offline' : 'online';
  await io.save('baseline-saved', {
    productId,
    originalDisplay: baseline.status,
    targetDisplay: target,
    subjectSha256: createHash('sha256').update(baseline.subject).digest('hex')
  });
  await io.save('submit-intent', { productId, targetDisplay: target });
  const submitted = boundJob(await io.submit(target), productId, context, baseline.status, 'verifying');
  if (submitted.recoveryRequestId || !(await io.stored(submitted))) stop('PERSISTED_IOP_BINDING_REQUIRED');
  await io.save('submitted', receiptSummary(submitted));
  const poll = async (phase: 'target-poll' | 'restore-poll', expected: Display) => {
    // Once recovery was sent, only wait/read. Never issue another mutation while it is reviewed.
    const limit = phase === 'restore-poll' ? RESTORE_POLL_LIMIT : POLL_LIMIT;
    for (let attempt = 0; attempt < limit; attempt++) {
      const page = await io.read(phase);
      const current =
        phase === 'restore-poll' ? exactProduct(page, productId, true) : exactProduct(page, productId);
      if (current.subject !== baseline.subject) stop('TARGET_CHANGED_STOP');
      await io.save(phase, { display: current.status, attempt: attempt + 1 });
      if (current.status === expected) return;
      if (attempt + 1 < limit) await io.wait();
    }
    stop('READBACK_PENDING_STOP');
  };
  await poll('target-poll', target);
  // Do not call task.refresh here: verified is intentionally ineligible for task.recover.
  if (!(await io.stored(submitted))) stop('JOB_CHANGED_BEFORE_RECOVERY');
  await io.save('recovery-intent', receiptSummary(submitted));
  const recovering = boundJob(await io.recover(submitted), productId, context, baseline.status, 'recovering');
  if (
    recovering.id !== submitted.id ||
    !recovering.recoveryRequestId ||
    recovering.recoveryRequestId === submitted.requestId ||
    !(await io.stored(recovering))
  )
    stop('RECOVERY_MARKER_REQUIRED');
  await io.save('recovering', receiptSummary(recovering));
  await poll('restore-poll', baseline.status);
  const recovered = boundJob(await io.refresh(recovering), productId, context, baseline.status, 'recovered');
  if (
    recovered.id !== submitted.id ||
    recovered.recoveryRequestId !== recovering.recoveryRequestId ||
    !(await io.stored(recovered))
  )
    stop('RECOVERY_MARKER_REQUIRED');
  await io.save('recovered', receiptSummary(recovered));
  return recovered;
}
function receiptSummary(job: ProductMutationJob): RecordValue {
  return {
    id: job.id,
    revision: job.revision,
    status: job.status,
    protocol: job.protocol,
    productContext: job.productContext,
    encryptedProductId: job.encryptedProductId,
    recoveryRequestId: job.recoveryRequestId ?? null
  };
}

export interface GuardSnapshot {
  sent: number;
  total: number;
  writes: number;
  blocked: number;
  submittedProof: boolean;
  recoveryProof: boolean;
}
export interface DisplayGuard {
  configure(baseline: Display, context: ProductOperationContext): void;
  bindJob(id: string): void;
  arm(phase: Phase, requestId: string | null): void;
  disarm(): void;
  snapshot(): GuardSnapshot;
}
type GuardHost = typeof globalThis & { __iopDisplayGuard?: DisplayGuard };
export interface GuardConfig {
  origin: string;
  listPath: string;
  writePath: string;
  productId: string;
  jobsKey: string;
  intervalMs: number;
}

/** Self-contained so Playwright can serialize it into the real worker; offline tests use stub fetch/storage. */
export function installDisplayGuard(config: GuardConfig): void {
  const host = globalThis as GuardHost;
  if (host.__iopDisplayGuard) throw new Error('DISPLAY_GUARD_ALREADY_INSTALLED');
  const native = host.fetch.bind(host);
  let baseline: Display | null = null,
    context: ProductOperationContext | null = null,
    jobId: string | null = null;
  let active: { phase: Phase; requestId: string | null; next: number; steps: string[] } | null = null;
  let busy = false,
    halted = false,
    submitted = false,
    recovered = false,
    total = 0,
    writes = 0,
    blocked = 0,
    last = 0;
  let submittedProof = false,
    recoveryProof = false;
  const deny = (): never => {
    halted = true;
    blocked++;
    throw new Error('DISPLAY_NETWORK_DENIED');
  };
  const isHalted = (): boolean => halted;
  host.__iopDisplayGuard = {
    configure(value, expected) {
      if (
        baseline ||
        active ||
        busy ||
        !['online', 'offline'].includes(value) ||
        !/^[a-f0-9]{64}$/u.test(expected.identity) ||
        !/^[a-f0-9]{64}$/u.test(expected.gateway)
      )
        deny();
      baseline = value;
      context = { ...expected };
    },
    bindJob(id) {
      if (jobId || busy || active || !submitted || !/^[a-f0-9-]{36}$/u.test(id)) deny();
      jobId = id;
    },
    arm(phase, requestId) {
      if (
        halted ||
        busy ||
        active ||
        !['baseline', 'submit', 'target-poll', 'recover', 'restore-poll', 'refresh'].includes(phase)
      )
        deny();
      if (phase !== 'baseline' && (!baseline || !context)) deny();
      if (phase === 'submit') {
        if (submitted) deny();
        submitted = true;
      }
      if (phase === 'recover') {
        if (!jobId || recovered || writes !== 1) deny();
        recovered = true;
      }
      if (['restore-poll', 'refresh'].includes(phase) && !recovered) deny();
      active = {
        phase,
        requestId,
        next: 0,
        steps: ['submit', 'recover'].includes(phase) ? ['list', 'write'] : ['list']
      };
    },
    disarm() {
      if (busy) deny();
      active = null;
    },
    snapshot() {
      return { sent: active?.next ?? 0, total, writes, blocked, submittedProof, recoveryProof };
    }
  };
  host.fetch = async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url),
      current = active;
    if (
      !current ||
      busy ||
      halted ||
      total >= 200 ||
      url.origin !== config.origin ||
      url.search ||
      url.username ||
      url.password ||
      request.method !== 'POST' ||
      !/^[a-z0-9-]{16,100}$/iu.test(request.headers.get('X-Request-ID') ?? '') ||
      (current.requestId !== null && request.headers.get('X-Request-ID') !== current.requestId)
    )
      return deny();
    const kind = current.steps[current.next];
    if (!kind || url.pathname !== (kind === 'list' ? config.listPath : config.writePath)) return deny();
    // Reserve before any await: no concurrent duplicate and no re-arm of a mutation phase.
    current.next++;
    busy = true;
    try {
      const parameters = new URLSearchParams(await request.clone().text());
      const system = ['app_key', 'access_token', 'timestamp', 'sign_method', 'simplify', 'sign'];
      const allowed = [
        ...system,
        ...(kind === 'list'
          ? ['id', 'current_page', 'page_size', 'language']
          : ['product_id_list', 'new_display'])
      ];
      if (
        [...parameters.keys()].some((key) => !allowed.includes(key) || parameters.getAll(key).length !== 1) ||
        system.some((key) => !parameters.get(key)) ||
        parameters.get('sign_method') !== 'sha256' ||
        parameters.get('simplify') !== 'true'
      )
        return deny();
      if (kind === 'list') {
        if (
          parameters.get('id') !== config.productId ||
          parameters.get('current_page') !== '1' ||
          parameters.get('page_size') !== '1'
        )
          return deny();
      } else {
        if (
          writes >= 2 ||
          !baseline ||
          !context ||
          !['submit', 'recover'].includes(current.phase) ||
          parameters.get('product_id_list') !== `[${config.productId}]` ||
          parameters.get('new_display') !==
            ((current.phase === 'submit' ? baseline === 'online' : baseline === 'offline') ? 'off' : 'on')
        )
          return deny();
        const chrome = (
          globalThis as unknown as {
            chrome: { storage: { local: { get(key: string): Promise<RecordValue> } } };
          }
        ).chrome;
        const all = await chrome.storage.local.get(config.jobsKey);
        const saved = all[config.jobsKey];
        if (
          typeof saved !== 'object' ||
          saved === null ||
          !('schemaVersion' in saved) ||
          saved.schemaVersion !== 1 ||
          !('jobs' in saved) ||
          !Array.isArray(saved.jobs)
        )
          return deny();
        const matching = saved.jobs.filter(
          (entry: unknown) =>
            typeof entry === 'object' &&
            entry !== null &&
            (current.phase === 'submit'
              ? 'requestId' in entry && entry.requestId === current.requestId
              : 'id' in entry && entry.id === jobId)
        );
        const job = matching[0] as RecordValue | undefined;
        const binding = job?.productContext as ProductOperationContext | undefined;
        if (
          matching.length !== 1 ||
          job?.operation !== 'updateProductDisplay' ||
          job.protocol !== 'iop' ||
          job.productId !== config.productId ||
          job.encryptedProductId !== null ||
          job.originalDisplay !== baseline ||
          job.targetDisplay !== (baseline === 'online' ? 'offline' : 'online') ||
          binding?.identity !== context.identity ||
          binding.gateway !== context.gateway ||
          (current.phase === 'submit'
            ? job.status !== 'submitted' || !!job.recoveryRequestId
            : job.status !== 'recovering' ||
              typeof job.recoveryRequestId !== 'string' ||
              !/^[a-f0-9-]{36}$/u.test(job.recoveryRequestId) ||
              job.recoveryRequestId === job.requestId)
        )
          return deny();
        if (current.phase === 'submit') submittedProof = true;
        else recoveryProof = true;
      }
      const wait = Math.max(0, config.intervalMs - (Date.now() - last));
      if (wait) await new Promise<void>((done) => setTimeout(done, wait));
      if (active !== current || isHalted()) return deny();
      last = Date.now();
      total++;
      if (kind === 'write') writes++;
      return await native(new Request(request, { redirect: 'error' }));
    } finally {
      busy = false;
    }
  };
}

/** Manifest-only host pregrant is separately disclosed; all other copied bytes must remain fixed. */
export async function productionCodeDigest(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string, prefix: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, 'en')
    )) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(resolve(path, entry.name), name + '/');
      else if (entry.isFile()) {
        if (name !== 'manifest.json')
          hash
            .update(name)
            .update('\0')
            .update(await readFile(resolve(path, entry.name)))
            .update('\0');
      } else stop('PRODUCTION_COPY_INVALID');
    }
  }
  await visit(directory, '');
  return hash.digest('hex');
}
async function send(page: Page, message: RecordValue): Promise<unknown> {
  return page.evaluate(
    (value) =>
      (
        globalThis as unknown as { chrome: { runtime: { sendMessage(input: unknown): Promise<unknown> } } }
      ).chrome.runtime.sendMessage(value),
    message
  );
}
function data(response: unknown): unknown {
  if (!record(response) || response.ok !== true) {
    const code =
      record(response) && record(response.error) ? safeErrorCode(response.error.code) : 'ERROR_REDACTED';
    stop('RUNTIME_NOT_CONFIRMED_' + code);
  }
  return response.data;
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args),
    root = await realpath(resolve(import.meta.dirname, '..'));
  const reportPath = reportLocation(root, options.report),
    runId = randomUUID();
  const report = {
    schemaVersion: 1,
    runId,
    productId: options.productId,
    protocol: 'iop',
    status: 'prepared',
    stage: 'preflight',
    capturedAtUtc: new Date().toISOString(),
    errorCode: null as string | null,
    fullProductionBuildSha256: '',
    productionCodeSha256: '',
    copiedCodeSha256: '',
    copiedManifestSha256: '',
    productionCodeCopiedUnchanged: false,
    isolatedProfile: true,
    configuredCredentialsReplaced: false,
    isolatedManifestPregrant: options.nativeHostConsent ? null : `${IOP_API_ORIGIN}/*`,
    nativeHostConsentConfirmed: false,
    encryptedIopOnlyVaultConfirmed: false,
    productionCapabilityGateOpen: false,
    runtimeFetchGuardInjected: true,
    tokenRequests: 0,
    topRequests: 0,
    nativeDisplayWrites: 0,
    networkRequests: 0,
    blockedRequests: 0,
    minimumIntervalMs: INTERVAL_MS,
    noMutationRetry: true,
    manualReconciliationRequired: false,
    profilePath: '',
    events: [] as { phase: string; atUtc: string; detail: RecordValue }[]
  };
  await prepareReport(root, reportPath, report);
  let context: BrowserContext | null = null,
    worker: Worker | null = null,
    page: Page | null = null;
  const workerState = { changed: false };
  const workerHasChanged = (): boolean => workerState.changed;
  let frozenCheck: (() => Promise<void>) | null = null;
  let active: { phase: Phase; requestId: string | null; count: number } | null = null;
  let routeBusy = false,
    lastWire = 0;
  let baselineDisplay: Display | null = null;
  try {
    const bundle = readIopBundle(
      JSON.parse(await readFile(resolve(root, options.credential), 'utf8')) as unknown
    );
    const temporary = await mkdtemp(resolve(dirname(reportPath), 'mv3-display-'));
    const source = resolve(root, 'apps/extension/.output/chrome-mv3'),
      extension = resolve(temporary, 'extension');
    report.profilePath = resolve(temporary, 'profile');
    report.fullProductionBuildSha256 = await buildDigest(source);
    report.productionCodeSha256 = await productionCodeDigest(source);
    await cp(source, extension, { recursive: true, force: false, errorOnExist: true });
    if ((await buildDigest(extension)) !== report.fullProductionBuildSha256) stop('PRODUCTION_COPY_CHANGED');
    const manifest: unknown = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    if (
      !record(manifest) ||
      manifest.manifest_version !== 3 ||
      !record(manifest.background) ||
      typeof manifest.background.service_worker !== 'string' ||
      !/^[a-z0-9_./-]+\.js$/iu.test(manifest.background.service_worker) ||
      manifest.background.service_worker.split('/').includes('..') ||
      !Array.isArray(manifest.host_permissions) ||
      !manifest.host_permissions.every((value) => typeof value === 'string')
    )
      stop('FORMAL_MV3_BUILD_REQUIRED');
    if (options.nativeHostConsent) {
      if (manifest.host_permissions.includes(`${IOP_API_ORIGIN}/*`)) stop('NATIVE_HOST_MUST_START_UNGRANTED');
    } else {
      manifest.host_permissions = [...new Set([...manifest.host_permissions, `${IOP_API_ORIGIN}/*`])];
      await atomicWriteJson(resolve(extension, 'manifest.json'), manifest);
    }
    report.copiedManifestSha256 = createHash('sha256')
      .update(await readFile(resolve(extension, 'manifest.json')))
      .digest('hex');
    frozenCheck = async () => {
      report.copiedCodeSha256 = await productionCodeDigest(extension);
      report.productionCodeCopiedUnchanged =
        report.copiedCodeSha256 === report.productionCodeSha256 &&
        (await buildDigest(source)) === report.fullProductionBuildSha256 &&
        createHash('sha256')
          .update(await readFile(resolve(extension, 'manifest.json')))
          .digest('hex') === report.copiedManifestSha256;
      if (!report.productionCodeCopiedUnchanged) stop('PRODUCTION_COPY_CHANGED');
    };
    await frozenCheck();
    await persist(reportPath, report);
    context = await chromium.launchPersistentContext(report.profilePath, {
      headless: false,
      locale: 'zh-CN',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.addInitScript({ content: 'globalThis.__name = (value) => value;' });
    await context.route(/^https?:\/\//u, async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        current = active;
      const write = current && ['submit', 'recover'].includes(current.phase) && current.count === 1;
      const expectedPath = write ? DISPLAY_PATHS.write : DISPLAY_PATHS.list;
      const parameters = new URLSearchParams(request.postData() ?? '');
      const deny = async () => {
        report.blockedRequests++;
        await route.abort('blockedbyclient');
      };
      const system = ['app_key', 'access_token', 'timestamp', 'sign_method', 'simplify', 'sign'];
      const allowed = [
        ...system,
        ...(write ? ['product_id_list', 'new_display'] : ['id', 'current_page', 'page_size', 'language'])
      ];
      if (
        !current ||
        routeBusy ||
        workerHasChanged() ||
        report.blockedRequests ||
        request.serviceWorker() !== worker ||
        current.count >= (['submit', 'recover'].includes(current.phase) ? 2 : 1) ||
        report.networkRequests >= MAX_REQUESTS ||
        url.origin !== IOP_API_ORIGIN ||
        url.pathname !== expectedPath ||
        url.search ||
        url.username ||
        url.password ||
        request.method() !== 'POST' ||
        !/^[a-z0-9-]{16,100}$/iu.test(request.headers()['x-request-id'] ?? '') ||
        (current.requestId !== null && request.headers()['x-request-id'] !== current.requestId) ||
        [...parameters.keys()].some((key) => !allowed.includes(key) || parameters.getAll(key).length !== 1) ||
        system.some((key) => !parameters.get(key)) ||
        parameters.get('sign_method') !== 'sha256' ||
        parameters.get('simplify') !== 'true' ||
        (write
          ? report.nativeDisplayWrites >= 2 ||
            parameters.get('product_id_list') !== `[${options.productId}]` ||
            !baselineDisplay ||
            parameters.get('new_display') !==
              ((current.phase === 'submit' ? baselineDisplay === 'online' : baselineDisplay === 'offline')
                ? 'off'
                : 'on')
          : parameters.get('id') !== options.productId ||
            parameters.get('current_page') !== '1' ||
            parameters.get('page_size') !== '1')
      ) {
        await deny();
        return;
      }
      routeBusy = true;
      current.count++;
      try {
        await delay(Math.max(0, INTERVAL_MS - (Date.now() - lastWire)));
        if (workerHasChanged() || active !== current || report.blockedRequests) {
          await deny();
          return;
        }
        if (write) {
          if (!frozenCheck) stop('PRODUCTION_COPY_CHANGED');
          await frozenCheck();
          report.nativeDisplayWrites++;
          report.manualReconciliationRequired = true;
          // Durable record before route.continue: at most one native dispatch per mutation phase.
          await persist(reportPath, report);
        }
        lastWire = Date.now();
        report.networkRequests++;
        await route.continue();
      } catch {
        report.blockedRequests++;
        await route.abort('blockedbyclient').catch(() => undefined);
      } finally {
        routeBusy = false;
      }
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionUrl = new URL(worker.url());
    if (extensionUrl.protocol !== 'chrome-extension:') stop('FORMAL_MV3_WORKER_REQUIRED');
    context.on('serviceworker', (next) => {
      if (next !== worker) workerState.changed = true;
    });
    await worker.evaluate('globalThis.__name = (value) => value;');
    await worker.evaluate(installDisplayGuard, {
      origin: IOP_API_ORIGIN,
      listPath: DISPLAY_PATHS.list,
      writePath: DISPLAY_PATHS.write,
      productId: options.productId,
      jobsKey: JOBS_KEY,
      intervalMs: INTERVAL_MS
    });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    report.stage = 'ui-import';
    await persist(reportPath, report);
    await page.goto(`chrome-extension://${extensionUrl.host}/options.html#/settings`);
    const onboarding = page.getByRole('dialog', { name: '四步连接 Alibaba 开放平台' });
    await onboarding.getByRole('checkbox').check();
    await onboarding.getByRole('button', { name: '稍后，仅浏览', exact: true }).click();
    await page.goto(`chrome-extension://${extensionUrl.host}/options.html#/settings`);
    const empty = data(
      await send(page, { kind: 'credential-vault-request', operation: 'status', requestId: randomUUID() })
    );
    if (!record(empty) || empty.state !== 'empty') stop('ISOLATED_EMPTY_VAULT_REQUIRED');
    const passphrase = randomBytes(24).toString('base64url');
    await page.getByTestId('get-alibaba-credentials').click();
    const dialog = page.getByRole('dialog', { name: credentialsZh.chooseAcquireProtocol, exact: true });
    await dialog.getByTestId('authorization-protection-passphrase').fill(passphrase);
    await dialog.getByTestId('continue-authorization-protection').click();
    await dialog.getByTestId('authorization-method-file').click();
    await dialog.getByLabel(credentialsZh.offlineChooseFile, { exact: true }).setInputFiles({
      name: 'credentialInfo.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle))
    });
    await dialog.getByTestId('authorization-file-preview').waitFor({ state: 'visible' });
    await dialog.getByTestId('confirm-authorization-file-import').click();
    if (options.nativeHostConsent)
      process.stdout.write('Allow the exact IOP origin in the isolated Chromium window.\n');
    await dialog.waitFor({ state: 'hidden', timeout: options.nativeHostConsent ? 600_000 : 20_000 });
    report.encryptedIopOnlyVaultConfirmed = await worker.evaluate(
      async (secrets) => {
        const chrome = (
          globalThis as unknown as {
            chrome: { storage: { local: { get(key: string): Promise<RecordValue> } } };
          }
        ).chrome;
        const saved = await chrome.storage.local.get('gatewaySettings');
        const value = saved.gatewaySettings as
          { version?: unknown; format?: unknown; cipher?: { ciphertext?: unknown } } | undefined;
        return (
          value?.version === 2 &&
          value.format === 'PBKDF2-HMAC-SHA256/AES-256-GCM' &&
          typeof value.cipher?.ciphertext === 'string' &&
          value.cipher.ciphertext.length > 0 &&
          secrets.every((secret) => !JSON.stringify(saved).includes(secret))
        );
      },
      [
        bundle.application.appKey,
        bundle.application.appSecret,
        bundle.oauth.accessToken,
        passphrase,
        ...(bundle.oauth.refreshToken ? [bundle.oauth.refreshToken] : [])
      ]
    );
    if (!report.encryptedIopOnlyVaultConfirmed) stop('ENCRYPTED_IOP_VAULT_REQUIRED');
    await page.reload();
    const settings = data(
      await send(page, {
        kind: 'credential-vault-request',
        operation: 'get-settings',
        requestId: randomUUID()
      })
    );
    const status = data(
      await send(page, { kind: 'credential-vault-request', operation: 'status', requestId: randomUUID() })
    );
    const authorizations = data(
      await send(page, {
        kind: 'credential-vault-request',
        operation: 'authorizations',
        requestId: randomUUID()
      })
    );
    if (
      !record(settings) ||
      settings.protocol !== 'iop' ||
      settings.endpoint !== IOP_BUSINESS_ENDPOINT ||
      settings.signMethod !== 'hmac-sha256' ||
      settings.appSecret !== '' ||
      settings.accessToken !== '' ||
      !record(status) ||
      status.state !== 'unlocked' ||
      !record(authorizations) ||
      authorizations.top !== null ||
      !record(authorizations.iop)
    )
      stop('ENCRYPTED_IOP_ONLY_REQUIRED');
    if (options.nativeHostConsent) {
      report.nativeHostConsentConfirmed = await worker.evaluate(
        async (origin) =>
          (
            globalThis as unknown as {
              chrome: { permissions: { contains(value: { origins: string[] }): Promise<boolean> } };
            }
          ).chrome.permissions.contains({ origins: [`${origin}/*`] }),
        IOP_API_ORIGIN
      );
      if (!report.nativeHostConsentConfirmed) stop('NATIVE_HOST_GRANT_REQUIRED');
    }
    const definition = data(
      await send(page, {
        kind: 'gateway-request',
        operation: 'getCapabilityDefinition',
        requestId: randomUUID(),
        payload: { method: 'alibaba.icbu.product.batch.update.display' }
      })
    );
    report.productionCapabilityGateOpen = record(definition) && definition.realCallEnabled === true;
    if (!report.productionCapabilityGateOpen) stop('PRODUCTION_DISPLAY_GATE_CLOSED');
    const productContext = requireProductOperationContext(
      data(await send(page, { kind: 'product-operation-context', requestId: randomUUID() }))
    );
    const runtimeWorker = worker;
    const runtimePage = page;
    const checkFrozen = frozenCheck;
    const armedCall = async (
      phase: Phase,
      message: RecordValue,
      wireRequestId: string | null
    ): Promise<unknown> => {
      if (workerHasChanged() || active || report.blockedRequests) stop('NETWORK_BOUNDARY_CHANGED');
      active = { phase, requestId: wireRequestId, count: 0 };
      await runtimeWorker.evaluate(
        ({ phase, requestId }) => {
          const guard = (globalThis as GuardHost).__iopDisplayGuard;
          if (!guard) throw new Error('DISPLAY_GUARD_MISSING');
          guard.arm(phase, requestId);
        },
        { phase, requestId: wireRequestId }
      );
      try {
        return data(await send(runtimePage, message));
      } finally {
        const snapshot = await runtimeWorker.evaluate<GuardSnapshot>(
          'globalThis.__iopDisplayGuard.snapshot()'
        );
        const count = active.count;
        await runtimeWorker.evaluate('globalThis.__iopDisplayGuard.disarm()');
        active = null;
        if (workerHasChanged() || snapshot.blocked || report.blockedRequests || snapshot.sent !== count)
          stop('DISPLAY_NETWORK_GUARD_NOT_CONFIRMED');
        if (count !== (['submit', 'recover'].includes(phase) ? 2 : 1))
          stop('NATIVE_REQUEST_COUNT_NOT_CONFIRMED');
        await delay(INTERVAL_MS);
      }
    };
    const stored = async (job: ProductMutationJob) =>
      runtimeWorker.evaluate(
        async ({ key, expected }) => {
          const chrome = (
            globalThis as unknown as {
              chrome: { storage: { local: { get(key: string): Promise<RecordValue> } } };
            }
          ).chrome;
          const saved = (await chrome.storage.local.get(key))[key] as { jobs?: RecordValue[] } | undefined;
          const matches = saved?.jobs?.filter((entry) => entry.id === expected.id) ?? [];
          return (
            matches.length === 1 &&
            Object.entries(expected).every(
              ([name, value]) => JSON.stringify(matches[0]?.[name] ?? null) === JSON.stringify(value)
            )
          );
        },
        {
          key: JOBS_KEY,
          expected: {
            ...receiptSummary(job),
            id: job.id,
            productId: options.productId,
            operation: 'updateProductDisplay',
            originalDisplay: job.originalDisplay,
            targetDisplay: job.targetDisplay
          }
        }
      );
    await runDisplayCycle(
      {
        read: async (phase) => {
          const requestId = randomUUID();
          return armedCall(
            phase,
            {
              kind: 'gateway-request',
              operation: 'listProducts',
              requestId,
              productContext,
              payload: { productId: options.productId, page: 1, pageSize: 1, language: 'en_US' }
            },
            requestId
          );
        },
        submit: async (display) => {
          await checkFrozen();
          const baseline = display === 'online' ? 'offline' : 'online';
          await runtimeWorker.evaluate(
            ({ baseline, productContext }) => {
              const guard = (globalThis as GuardHost).__iopDisplayGuard;
              if (!guard) throw new Error('DISPLAY_GUARD_MISSING');
              if (baseline !== 'online' && baseline !== 'offline')
                throw new Error('DISPLAY_BASELINE_INVALID');
              guard.configure(baseline, productContext);
            },
            { baseline, productContext }
          );
          const requestId = randomUUID();
          const result = await armedCall(
            'submit',
            {
              kind: 'gateway-request',
              operation: 'updateProductDisplay',
              requestId,
              productContext,
              payload: { protocol: 'iop', productIds: [options.productId], encryptedProductIds: [], display }
            },
            requestId
          );
          if (
            !record(result) ||
            !Array.isArray(result.jobs) ||
            result.jobs.length !== 1 ||
            !isProductMutationJob(result.jobs[0])
          )
            stop('UNIQUE_DISPLAY_JOB_REQUIRED');
          if (result.jobs[0].requestId !== requestId) stop('UNIQUE_DISPLAY_JOB_REQUIRED');
          await runtimeWorker.evaluate((id) => {
            const guard = (globalThis as GuardHost).__iopDisplayGuard;
            if (!guard) throw new Error('DISPLAY_GUARD_MISSING');
            guard.bindJob(id);
          }, result.jobs[0].id);
          return result.jobs[0];
        },
        recover: async (job) => {
          await checkFrozen();
          return armedCall(
            'recover',
            {
              kind: 'product-mutation-job-request',
              operation: 'recover',
              requestId: randomUUID(),
              payload: { id: job.id, revision: job.revision }
            },
            null
          );
        },
        refresh: (job) =>
          armedCall(
            'refresh',
            {
              kind: 'product-mutation-job-request',
              operation: 'refresh',
              requestId: randomUUID(),
              payload: { id: job.id, revision: job.revision }
            },
            null
          ),
        stored,
        save: async (phase, detail) => {
          if (phase === 'baseline-saved') {
            if (detail.originalDisplay !== 'online' && detail.originalDisplay !== 'offline')
              stop('NEUTRAL_PLAIN_ID_BASELINE_REQUIRED');
            baselineDisplay = detail.originalDisplay;
          }
          report.stage = phase;
          report.events.push({ phase, atUtc: new Date().toISOString(), detail });
          await persist(reportPath, report);
        },
        wait: () => delay(5_000)
      },
      options.productId,
      productContext
    );
    const proof = await runtimeWorker.evaluate<GuardSnapshot>('globalThis.__iopDisplayGuard.snapshot()');
    if (
      proof.writes !== 2 ||
      report.nativeDisplayWrites !== 2 ||
      !proof.submittedProof ||
      !proof.recoveryProof ||
      proof.total !== report.networkRequests ||
      proof.blocked ||
      report.blockedRequests ||
      workerHasChanged()
    )
      stop('FORMAL_MV3_PROOF_INCOMPLETE');
    await frozenCheck();
    report.status = 'passed';
    report.stage = 'complete';
    report.manualReconciliationRequired = false;
  } catch (error: unknown) {
    report.status = 'stopped';
    report.errorCode = error instanceof AcceptanceStop ? error.code : 'ACCEPTANCE_NOT_CONFIRMED';
    // Never call recovery in catch/finally. The retained encrypted profile and report support manual follow-up.
  } finally {
    if (frozenCheck) {
      try {
        await frozenCheck();
      } catch {
        report.status = 'stopped';
        report.errorCode = 'PRODUCTION_COPY_CHANGED';
      }
    }
    if (context) {
      try {
        if (page)
          await send(page, { kind: 'credential-vault-request', operation: 'lock', requestId: randomUUID() });
      } catch {
        /* session ends on owned context close */
      }
      await context.close().catch(() => undefined);
    }
    await persist(reportPath, report);
    process.stdout.write(
      JSON.stringify({
        status: report.status,
        stage: report.stage,
        errorCode: report.errorCode,
        reportPath,
        nativeDisplayWrites: report.nativeDisplayWrites,
        manualReconciliationRequired: report.manualReconciliationRequired
      }) + '\n'
    );
    if (report.status !== 'passed') process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') === '--help')
    process.stdout.write(
      'PREPARED ONLY. Wait for main approval, BFF acceptance, recovery completion and the production gate.\n' +
        'pnpm exec tsx scripts/smoke-iop-display-extension-real.ts --confirm-real-write --product-id=<authorized-neutral-ID> --credential=<IOP-JSON> --report=artifacts/<NEW-unique-report>.json [--native-host-consent]\n' +
        `Suggested alternative ${SUGGESTED_PRODUCT_ID}; no implicit target. Existing MV3 only, at most two native writes, no retries or token/TOP traffic.\n`
    );
  else
    try {
      await main(process.argv.slice(2));
    } catch {
      process.stderr.write(
        'IOP_DISPLAY_EXTENSION_PREFLIGHT_STOPPED: no automatic retry; inspect the owned report if created.\n'
      );
      process.exitCode = 1;
    }
}
