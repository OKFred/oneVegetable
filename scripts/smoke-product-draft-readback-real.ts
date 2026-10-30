/**
 * Explicit one-ID read only. Requires an existing verified IOP saveProductDraft job export.
 * No draft creation/deletion, env discovery, refresh, alternate protocol, list scan or retry.
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { NetworkManager, NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import {
  createProductOperationContext,
  isProductOperationContext,
  type ProductOperationContext
} from '../packages/core/src/product-operation-context';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/capability-registry';
import {
  PRODUCT_DRAFT_STATUS_METHOD,
  readProductDraftPresence,
  type ProductDraftReadbackInput,
  type ProductDraftReadbackDependencies
} from '../packages/core/src/product-draft-readback';
import type { GatewayCredentials } from '../packages/core/src/types';
import { assertIgnoredFile, readIopBundle } from './smoke-product-reference-real';
import { productReadScopedRoot } from './smoke-product-read-tools-real';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,15}$/u.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0
  );
}
export interface DraftReadbackSmokeOptions {
  credential: string;
  receipt: string;
  draftId: string;
  actorId: string;
  receiptMaxAgeMs: number;
  output: string;
}
export function parseDraftReadbackSmokeOptions(args: readonly string[]): DraftReadbackSmokeOptions {
  if (args.length !== 7 || args.filter((arg) => arg === '--confirm-readonly').length !== 1)
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const keys = new Set([
    'iop-credential',
    'draft-receipt',
    'draft-id',
    'actor-id',
    'receipt-max-age-ms',
    'output'
  ]);
  const values = new Map<string, string>();
  for (const arg of args) {
    if (arg === '--confirm-readonly') continue;
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    const key = match?.[1],
      value = match?.[2];
    if (
      !key ||
      !value ||
      !keys.has(key) ||
      values.has(key) ||
      value.trim() !== value ||
      value.length > 4096 ||
      Array.from(value).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('READ_ONLY_ARGUMENTS_INVALID');
    values.set(key, value);
  }
  if ([...keys].some((key) => !values.has(key))) throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const draftId = values.get('draft-id'),
    age = values.get('receipt-max-age-ms') ?? '';
  const actorId = values.get('actor-id') ?? '';
  if (
    !exactId(draftId) ||
    !/^[1-9][0-9]*$/u.test(age) ||
    !Number.isSafeInteger(Number(age)) ||
    actorId.length > 256
  )
    throw new Error('READ_ONLY_ARGUMENTS_INVALID');
  return {
    credential: values.get('iop-credential') ?? '',
    receipt: values.get('draft-receipt') ?? '',
    draftId,
    actorId,
    receiptMaxAgeMs: Number(age),
    output: values.get('output') ?? ''
  };
}
/** The file must be a trusted repository export, not a caller-authored ID or ordinary product result. */
export function inputFromDraftCreationJob(
  job: unknown,
  options: DraftReadbackSmokeOptions,
  context: ProductOperationContext,
  now: number
): ProductDraftReadbackInput {
  if (
    !record(job) ||
    job.operation !== 'saveProductDraft' ||
    job.protocol !== 'iop' ||
    job.status !== 'verified' ||
    job.productId !== options.draftId ||
    job.creatorId !== options.actorId ||
    !isProductOperationContext(job.productContext) ||
    job.productContext.identity !== context.identity ||
    job.productContext.gateway !== context.gateway ||
    typeof job.id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(job.id) ||
    typeof job.completedTimeUtc !== 'number' ||
    !Number.isSafeInteger(job.completedTimeUtc) ||
    job.completedTimeUtc < 0 ||
    job.completedTimeUtc > now ||
    !Number.isSafeInteger(job.completedTimeUtc + options.receiptMaxAgeMs) ||
    job.completedTimeUtc + options.receiptMaxAgeMs <= now
  )
    throw new Error('SCOPED_VERIFIED_DRAFT_RECEIPT_REQUIRED');
  return {
    draftId: options.draftId,
    protocol: 'iop',
    context: { ...context },
    receipt: {
      kind: 'draft',
      source: 'draft-create',
      verified: true,
      receiptId: job.id,
      draftId: options.draftId,
      protocol: 'iop',
      context: { ...context },
      observedTimeUtc: job.completedTimeUtc,
      expiresTimeUtc: job.completedTimeUtc + options.receiptMaxAgeMs
    }
  };
}
export class ProductDraftReadbackNetworkGuard implements NetworkTransport {
  private reserved = false;
  private sent = 0;
  private blocked = 0;
  constructor(
    private readonly transport: NetworkTransport,
    private readonly draftId: string,
    private readonly requestId: string
  ) {
    if (!exactId(draftId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(requestId))
      throw new Error('READ_ONLY_NETWORK_DENIED');
  }
  snapshot() {
    return { sent: this.sent, blocked: this.blocked };
  }
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const deny = (): never => {
      this.blocked++;
      throw new Error('READ_ONLY_NETWORK_DENIED');
    };
    const request = new Request(input, init),
      url = new URL(request.url);
    if (
      this.reserved ||
      url.href !== 'https://openapi-api.alibaba.com/rest' + PRODUCT_DRAFT_STATUS_METHOD ||
      request.method !== 'POST' ||
      request.headers.get('X-Request-ID') !== this.requestId ||
      !/^application\/x-www-form-urlencoded(?:;|$)/iu.test(request.headers.get('Content-Type') ?? '')
    )
      return deny();
    this.reserved = true;
    const form = new URLSearchParams(await request.clone().text()),
      fields = [...form.keys()];
    const allowed = new Set([
      'product_id',
      'app_key',
      'access_token',
      'sign',
      'sign_method',
      'timestamp',
      'simplify',
      'partner_id',
      'format',
      'v'
    ]);
    if (
      new Set(fields).size !== fields.length ||
      fields.some((key) => !allowed.has(key)) ||
      form.get('product_id') !== this.draftId ||
      form.get('sign_method') !== 'sha256' ||
      !form.get('app_key') ||
      !form.get('access_token') ||
      !form.get('sign')
    )
      return deny();
    this.sent++;
    return this.transport.send(request.url, { ...init, redirect: 'error' });
  }
}
export interface DraftReadbackSmokeReport {
  method: typeof PRODUCT_DRAFT_STATUS_METHOD;
  protocol: 'iop';
  requestId: string;
  status: 'present' | 'unknown';
  reasonCode: string;
  attempts: 0 | 1;
  counts: { networkRequests: number; blockedRequests: number };
}
type Validators = Pick<
  ProductDraftReadbackDependencies,
  'validateCapabilityRequest' | 'validateCapabilityResponse'
>;
export async function runProductDraftReadbackSmoke(
  options: DraftReadbackSmokeOptions,
  job: unknown,
  credentials: GatewayCredentials,
  transport: NetworkTransport,
  persist: (report: DraftReadbackSmokeReport) => Promise<void> = () => Promise.resolve(),
  validation: Validators = { validateCapabilityRequest, validateCapabilityResponse },
  now: () => number = Date.now
): Promise<DraftReadbackSmokeReport> {
  if (credentials.protocol !== 'iop') throw new Error('EXPLICIT_IOP_BUNDLE_REQUIRED');
  const fixedCredentials = Object.freeze({ ...credentials });
  const context = await createProductOperationContext(options.actorId, fixedCredentials);
  const input = inputFromDraftCreationJob(job, options, context, now());
  const requestId = randomUUID(),
    guard = new ProductDraftReadbackNetworkGuard(transport, options.draftId, requestId);
  const report: DraftReadbackSmokeReport = {
    method: PRODUCT_DRAFT_STATUS_METHOD,
    protocol: 'iop',
    requestId,
    status: 'unknown',
    reasonCode: 'DRAFT_READ_NOT_COMPLETED',
    attempts: 0,
    counts: { networkRequests: 0, blockedRequests: 0 }
  };
  await persist(report); // Correlation is durable before dispatch; failure here sends nothing.
  const network = new NetworkManager({
    transport: guard,
    policies: {
      alibaba: {
        allowedOrigins: ['https://openapi-api.alibaba.com'],
        timeoutMilliseconds: 15000,
        maxRequestBytes: 16 * 1024,
        maxResponseBytes: 1024 * 1024
      }
    }
  });
  const client = new AlibabaClient(fixedCredentials, network, { maxAttempts: 1, requestId });
  const result = await readProductDraftPresence(input, {
    client,
    getCurrentContext: () => ({ protocol: 'iop', context }),
    ...validation,
    requestId,
    now
  });
  report.status = result.status;
  report.reasonCode = result.reasonCode;
  report.attempts = result.attempts;
  report.counts.networkRequests = guard.snapshot().sent;
  report.counts.blockedRequests = guard.snapshot().blocked;
  await persist(report);
  return report;
}
async function ignoredJson(root: string, path: string): Promise<unknown> {
  await assertIgnoredFile(productReadScopedRoot(root, path), path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('IGNORED_INPUT_INVALID');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function main(args: readonly string[]): Promise<void> {
  const options = parseDraftReadbackSmokeOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const credential = resolve(root, options.credential),
    receipt = resolve(root, options.receipt);
  const output = resolve(root, options.output),
    outputRoot = productReadScopedRoot(root, output);
  if (
    !output.toLowerCase().startsWith((resolve(outputRoot, 'artifacts') + sep).toLowerCase()) ||
    [credential, receipt].some((path) => path.toLowerCase() === output.toLowerCase())
  )
    throw new Error('NEW_IGNORED_RECEIPT_REQUIRED');
  await assertIgnoredFile(outputRoot, output);
  const bundle = readIopBundle(await ignoredJson(root, credential));
  const job = await ignoredJson(root, receipt);
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: 'https://openapi-api.alibaba.com/rest',
    signMethod: 'hmac-sha256'
  };
  const context = await createProductOperationContext(options.actorId, credentials);
  inputFromDraftCreationJob(job, options, context, Date.now());
  await mkdir(dirname(output), { recursive: true });
  await assertIgnoredFile(outputRoot, output);
  const file = await open(output, 'wx', 0o600);
  try {
    const report = await runProductDraftReadbackSmoke(
      options,
      job,
      credentials,
      new NativeFetchTransport(),
      async (report) => {
        await file.truncate(0);
        await file.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8');
        await file.sync();
      }
    );
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.status !== 'present') process.exitCode = 1;
  } finally {
    await file.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main(process.argv.slice(2)).catch(() => {
    process.stderr.write('DRAFT_READBACK_SMOKE_FAILED\n');
    process.exitCode = 1;
  });
