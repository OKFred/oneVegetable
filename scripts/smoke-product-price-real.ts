/** Explicit price-only local acceptance. Importing does not read inputs or contact any provider. */
import { open, readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { galleryGatewayId } from '../packages/core/src/gallery-transfer-context';
import { isProductOperationContext } from '../packages/core/src/product-operation-context';
import { NetworkManager, NativeFetchTransport } from '../packages/core/src/network';
import type { NetworkTransport } from '../packages/core/src/network';
import { GatewayException } from '../packages/core/src/errors';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/capability-validation-lazy';
import { createProductMaintenancePlatform } from '../packages/core/src/product-maintenance-platform';
import { PRODUCT_MAINTENANCE_METHODS } from '../packages/core/src/product-workbench-methods';
import {
  createProductMaintenanceIntent,
  classifyProductMaintenanceResponse,
  classifyProductMaintenanceError,
  comparePriceReadback,
  validateProductMaintenanceDiagnostics
} from '../packages/core/src/product-maintenance-api';
import type {
  ProductPriceDraft,
  ProductMaintenanceSnapshot,
  ProductMaintenanceIntent,
  ProductMaintenanceResult
} from '../packages/core/src/product-maintenance-api';
import { createProductMaintenanceBaseline } from '../packages/core/src/product-maintenance-service';
import type { ProductMaintenanceBaseline } from '../packages/core/src/product-maintenance-service';
import type { GatewayCredentials } from '../packages/core/src/types';
import type { ProductPriceCreationProof, ProductPricePlan } from './lib/product-price-real-types';
import { assertIgnoredFile } from './smoke-product-reference-real';
import { productReadScopedRoot } from './smoke-product-read-tools-real';

export const PRODUCT_PRICE_POLL_MS = 5000;
export const PRODUCT_PRICE_VERIFY_MS = 300000;
export const PRODUCT_PRICE_PROOF_CLAIM_SUFFIX = '.price-smoke-claim.json';
const PRICE_METHOD = PRODUCT_MAINTENANCE_METHODS.setPrice;
const READ_METHOD = '/alibaba/icbu/product/get/v2';
const PROTECTED_SOURCE_ID = '10000050957582';
export interface ProductPriceSmokeOptions {
  credential: string;
  creationProof: string;
  plan: string;
  productId: string;
  baseline: string;
  receipt: string;
}
export interface ProductPriceSmokeBaseline {
  schemaVersion: 1;
  productId: string;
  context: ProductPriceCreationProof['context'];
  capturedTimeUtc: number;
  creationReceiptId: string;
  price: ProductMaintenanceBaseline;
  restorePrice: ProductPriceDraft;
  requestedFingerprint: string;
}
export interface ProductPriceSmokeIO {
  readProduct: (id: string, timeoutMilliseconds?: number) => Promise<ProductMaintenanceSnapshot>;
  write: (intent: ProductMaintenanceIntent, requestId: string) => Promise<ProductMaintenanceResult>;
  persistBaseline: (baseline: ProductPriceSmokeBaseline) => Promise<void>;
  readBaseline: () => Promise<unknown>;
  appendReceipt: (event: Readonly<Record<string, unknown>>) => Promise<void>;
  readReceipts: () => Promise<readonly unknown[]>;
  wait: (milliseconds: number) => Promise<void>;
  now: () => number;
}
function fail(code: string): never {
  throw new Error('PRODUCT_PRICE_' + code);
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('INPUT_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) return fail('INPUT_INVALID');
  return row;
}
function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,18}$/u.test(value) ||
    BigInt(value) > 9223372036854775807n ||
    value === PROTECTED_SOURCE_ID
  )
    return fail('NEW_PRODUCT_ID_REQUIRED');
  return value;
}
function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function parseProductPriceSmokeOptions(args: readonly string[]): ProductPriceSmokeOptions {
  const flags = new Map<string, string>();
  const names = ['credential', 'creation-proof', 'plan', 'product-id', 'baseline', 'receipt'];
  let confirmed = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--confirm-real-write') {
      if (confirmed) return fail('OPTIONS_INVALID');
      confirmed = true;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/u.exec(arg);
    const name = match?.[1];
    if (!name || !names.includes(name) || flags.has(name)) return fail('OPTIONS_INVALID');
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) return fail('OPTIONS_INVALID');
    flags.set(name, value);
  }
  if (!confirmed || names.some((name) => !flags.has(name))) return fail('EXPLICIT_CONFIRMATION_REQUIRED');
  const credential = resolve(flags.get('credential') ?? fail('OPTIONS_INVALID'));
  const creationProof = resolve(flags.get('creation-proof') ?? fail('OPTIONS_INVALID'));
  const plan = resolve(flags.get('plan') ?? fail('OPTIONS_INVALID'));
  const baseline = resolve(flags.get('baseline') ?? fail('OPTIONS_INVALID'));
  const receipt = resolve(flags.get('receipt') ?? fail('OPTIONS_INVALID'));
  if (
    new Set([credential, creationProof, plan, baseline, receipt].map((path) => path.toLowerCase())).size !== 5
  )
    return fail('PATH_COLLISION');
  return { credential, creationProof, plan, baseline, receipt, productId: id(flags.get('product-id')) };
}
export function parseProductPriceCreationProof(
  value: unknown,
  productId: string,
  now: number
): ProductPriceCreationProof {
  const row = object(value, ['schemaVersion', 'purpose', 'context', 'createdTimeUtc', 'product']);
  const product = object(row.product, ['id', 'creationReceiptId', 'unbranded']);
  if (
    row.schemaVersion !== 1 ||
    row.purpose !== 'product-price-maintenance-test' ||
    !isProductOperationContext(row.context) ||
    !validTime(now) ||
    !validTime(row.createdTimeUtc) ||
    row.createdTimeUtc > now ||
    now - row.createdTimeUtc > 86400000 ||
    product.unbranded !== true ||
    id(product.id) !== id(productId) ||
    typeof product.creationReceiptId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(product.creationReceiptId)
  )
    return fail('CREATION_PROOF_INVALID');
  return {
    schemaVersion: 1,
    purpose: 'product-price-maintenance-test',
    context: structuredClone(row.context),
    createdTimeUtc: row.createdTimeUtc,
    product: { id: productId, creationReceiptId: product.creationReceiptId, unbranded: true }
  };
}
export async function parseProductPricePlan(
  value: unknown,
  proof: ProductPriceCreationProof
): Promise<ProductPricePlan> {
  const row = object(value, ['schemaVersion', 'price']);
  if (row.schemaVersion !== 1) return fail('PRICE_PLAN_INVALID');
  const draft = (await createProductMaintenanceIntent(row.price)).draft;
  if (draft.operation !== 'setPrice' || id(draft.productId) !== id(proof.product.id))
    return fail('PRICE_PLAN_SCOPE_MISMATCH');
  return { schemaVersion: 1, price: draft };
}
function restorePrice(draft: ProductPriceDraft, baseline: ProductMaintenanceBaseline): ProductPriceDraft {
  const field = (name: string) => baseline.fields[name] ?? fail('BASELINE_INVALID');
  if (draft.mode === 'sku')
    return {
      operation: 'setPrice',
      productId: draft.productId,
      mode: 'sku',
      currency: draft.currency,
      skus: draft.skus.map((row) => ({ skuId: row.skuId, price: field('skus/' + row.skuId + '/price') }))
    };
  if (field('price/currency') !== 'USD') return fail('BASELINE_INVALID');
  if (field('price/type') === 'RANGE')
    return {
      operation: 'setPrice',
      productId: draft.productId,
      mode: 'range',
      currency: 'USD',
      minPrice: field('price/min'),
      maxPrice: field('price/max')
    };
  if (field('price/type') !== 'TIERED') return fail('BASELINE_INVALID');
  const tiers = Object.entries(baseline.fields)
    .filter(([key]) => key.startsWith('price/tiers/'))
    .map(([key, price]) => ({ quantity: key.slice('price/tiers/'.length), price }))
    .sort((a, b) => (BigInt(a.quantity) < BigInt(b.quantity) ? -1 : 1));
  return { operation: 'setPrice', productId: draft.productId, mode: 'tiered', currency: 'USD', tiers };
}
function safeReceipt(value: unknown): ProductMaintenanceResult {
  const row = object(value, [
    'operation',
    'protocol',
    'status',
    'reason',
    'readbackRequired',
    'errorCode',
    'subCode',
    'traceId'
  ]);
  if (
    row.operation !== 'setPrice' ||
    row.protocol !== 'iop' ||
    row.readbackRequired !== true ||
    !['accepted', 'rejected', 'partial', 'ambiguous'].includes(String(row.status)) ||
    !['explicit-success', 'explicit-rejection', 'incomplete-evidence', 'unknown-outcome'].includes(
      String(row.reason)
    ) ||
    !validateProductMaintenanceDiagnostics(row)
  )
    return fail('RECEIPT_INVALID');
  return structuredClone(row) as unknown as ProductMaintenanceResult;
}
export async function runProductPriceMaintenancePlan(
  plan: ProductPricePlan,
  proof: ProductPriceCreationProof,
  io: ProductPriceSmokeIO
): Promise<{ scope: 'price-only'; price: 'restored'; protocol: 'iop' }> {
  proof = parseProductPriceCreationProof(proof, proof.product.id, io.now());
  plan = await parseProductPricePlan(plan, proof);
  const prior = await io.readReceipts();
  if (
    prior.length > 1 ||
    prior.some(
      (value) =>
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('phase' in value) ||
        value.phase !== 'started'
    )
  )
    return fail('PREVIOUS_ATTEMPT_NO_RESEND');
  const snapshot = await io.readProduct(proof.product.id);
  const price = await createProductMaintenanceBaseline(plan.price, snapshot);
  if (comparePriceReadback(plan.price, snapshot).status === 'matched') return fail('PRICE_PLAN_UNCHANGED');
  const original = restorePrice(plan.price, price);
  const originalIntent = await createProductMaintenanceIntent(original);
  const target = await createProductMaintenanceIntent(plan.price);
  const baseline: ProductPriceSmokeBaseline = {
    schemaVersion: 1,
    productId: proof.product.id,
    context: proof.context,
    capturedTimeUtc: io.now(),
    creationReceiptId: proof.product.creationReceiptId,
    price,
    restorePrice: original,
    requestedFingerprint: target.fingerprint
  };
  await io.persistBaseline(baseline);
  if (JSON.stringify(await io.readBaseline()) !== JSON.stringify(baseline))
    return fail('BASELINE_NOT_DURABLE');
  await io.appendReceipt({
    phase: 'baseline-persisted',
    scope: 'price-only',
    priceFingerprint: price.fingerprint
  });
  const fresh = await createProductMaintenanceBaseline(plan.price, await io.readProduct(proof.product.id));
  if (fresh.fingerprint !== price.fingerprint) return fail('BASELINE_CHANGED');
  const send = async (intent: ProductMaintenanceIntent, step: 'change' | 'restore') => {
    const requestId = crypto.randomUUID();
    const pending = {
      phase: 'dispatching',
      scope: 'price-only',
      step,
      requestId,
      method: PRICE_METHOD,
      fingerprint: intent.fingerprint,
      timeUtc: io.now()
    };
    await io.appendReceipt(pending);
    if (!(await io.readReceipts()).some((value) => JSON.stringify(value) === JSON.stringify(pending)))
      return fail('RECEIPT_NOT_DURABLE');
    let receipt: ProductMaintenanceResult;
    try {
      receipt = safeReceipt(await io.write(intent, requestId));
    } catch (error: unknown) {
      const result = classifyProductMaintenanceError('setPrice', error);
      await io.appendReceipt({ phase: 'unknown', step, requestId, result, noResend: true });
      return fail('WRITE_OUTCOME_UNKNOWN');
    }
    await io.appendReceipt({ phase: receipt.status, step, requestId, result: receipt });
    if (receipt.status !== 'accepted') return fail('WRITE_NOT_ACCEPTED');
  };
  const verify = async (draft: ProductPriceDraft, step: 'change' | 'restore') => {
    const deadline = io.now() + PRODUCT_PRICE_VERIFY_MS;
    for (let attempt = 1; attempt <= PRODUCT_PRICE_VERIFY_MS / PRODUCT_PRICE_POLL_MS; attempt++) {
      if (deadline - io.now() < PRODUCT_PRICE_POLL_MS) break;
      await io.wait(PRODUCT_PRICE_POLL_MS);
      const remaining = deadline - io.now();
      if (remaining <= 0) break;
      let matched = false;
      try {
        matched =
          comparePriceReadback(draft, await io.readProduct(proof.product.id, Math.min(30000, remaining)))
            .status === 'matched';
      } catch {
        /* Retry bounded reads only; never retry a write or infer success from an error. */
      }
      if (matched) {
        await io.appendReceipt({ phase: 'readback-confirmed', step, attempt });
        return;
      }
    }
    return fail('READBACK_UNRESOLVED');
  };
  await send(target, 'change');
  await verify(plan.price, 'change');
  if (comparePriceReadback(plan.price, await io.readProduct(proof.product.id)).status !== 'matched')
    return fail('CONCURRENT_CHANGE_STOPPED_RESTORATION');
  await send(originalIntent, 'restore');
  await verify(original, 'restore');
  await io.appendReceipt({ phase: 'price-restored', scope: 'price-only', noAutomaticRetry: true });
  return { scope: 'price-only', price: 'restored', protocol: 'iop' };
}

/** Exact, one-shot signed-request guard. Neither inventory nor draft paths can be armed. */
export class ProductPriceGuardedTransport implements NetworkTransport {
  private armed: { url: string; body: string } | null = null;
  private writes = 0;
  private reads = 0;
  constructor(private readonly transport: NetworkTransport) {}
  arm(method: string, url: string, body: URLSearchParams): void {
    if (this.armed || ![PRICE_METHOD, READ_METHOD].includes(method)) return fail('TRANSPORT_SCOPE_DENIED');
    const target = new URL(url);
    if (
      target.origin !== new URL(IOP_BUSINESS_ENDPOINT).origin ||
      target.pathname !== '/rest' + method ||
      target.search ||
      target.hash ||
      target.username ||
      target.password
    )
      return fail('TRANSPORT_SCOPE_DENIED');
    this.armed = { url, body: body.toString() };
  }
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const armed = this.armed;
    this.armed = null;
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    if (
      url !== armed?.url ||
      init.method !== 'POST' ||
      init.redirect !== 'manual' ||
      !(init.body instanceof URLSearchParams) ||
      init.body.toString() !== armed.body
    )
      return fail('TRANSPORT_SCOPE_DENIED');
    if (new URL(url).pathname === '/rest' + PRICE_METHOD) {
      if (this.writes >= 2) return fail('WRITE_BUDGET_EXHAUSTED');
      this.writes++;
    } else {
      if (this.reads >= 128) return fail('READ_BUDGET_EXHAUSTED');
      this.reads++;
    }
    return this.transport.send(input, init);
  }
}
export function createProductPriceAcceptanceClient(options: {
  credentials: GatewayCredentials;
  proof: ProductPriceCreationProof;
  transport: NetworkTransport;
}) {
  if (options.credentials.protocol !== 'iop' || options.credentials.endpoint !== IOP_BUSINESS_ENDPOINT)
    return fail('IOP_CREDENTIAL_REQUIRED');
  id(options.proof.product.id);
  const guard = new ProductPriceGuardedTransport(options.transport);
  const call = async (
    method: string,
    parameters: Readonly<Record<string, unknown>>,
    requestId?: string,
    timeoutMilliseconds = 30000
  ) => {
    if (![PRICE_METHOD, READ_METHOD].includes(method) || parameters.product_id !== options.proof.product.id)
      return fail('TRANSPORT_SCOPE_DENIED');
    if ((await validateCapabilityRequest(method, parameters)).length) return fail('REQUEST_CONTRACT_INVALID');
    const signed = await createIopBusinessRequest(options.credentials, method, parameters);
    const body = new URLSearchParams(signed.parameters);
    const network = new NetworkManager({
      transport: guard,
      policies: {
        alibaba: {
          allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin],
          allowUrl: (url) => [PRICE_METHOD, READ_METHOD].some((p) => url.pathname === '/rest' + p),
          timeoutMilliseconds: Math.max(1, Math.min(30000, timeoutMilliseconds)),
          maxRequestBytes: 1024 * 1024,
          maxResponseBytes: 5 * 1024 * 1024,
          redirect: 'error'
        }
      }
    });
    guard.arm(method, signed.url, body);
    const response = await network.request({
      service: 'alibaba',
      url: signed.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      responseType: 'json',
      maxAttempts: 1,
      ...(requestId ? { requestId } : {})
    });
    if (!response.ok)
      throw new GatewayException({
        code:
          response.status === 403
            ? 'PERMISSION_DENIED'
            : response.status === 401
              ? 'AUTHENTICATION_FAILED'
              : 'PRODUCT_PRICE_TRANSPORT_UNKNOWN',
        message: 'PRODUCT_PRICE_TRANSPORT_UNKNOWN',
        retryable: false
      });
    const data = normalizeIopBusinessResponse(response.data, method, options.credentials, signed.parameters);
    if ((await validateCapabilityResponse(method, data)).length)
      throw new GatewayException({
        code: 'PRODUCT_PRICE_RESPONSE_CONTRACT_INVALID',
        message: 'PRODUCT_PRICE_RESPONSE_CONTRACT_INVALID',
        retryable: false
      });
    return { method, data };
  };
  return {
    readProduct: async (productId: string, timeoutMilliseconds = 30000) => {
      if (productId !== options.proof.product.id) return fail('NEW_PRODUCT_ID_REQUIRED');
      const platform = createProductMaintenancePlatform({
        context: options.proof.context,
        enabled: false,
        client: { call: (method, parameters) => call(method, parameters, undefined, timeoutMilliseconds) },
        validateRequest: validateCapabilityRequest,
        validateResponse: validateCapabilityResponse
      });
      const reader = platform.readProduct;
      if (!reader) return fail('READBACK_UNAVAILABLE');
      return reader(productId);
    },
    write: async (intent: ProductMaintenanceIntent, requestId: string): Promise<ProductMaintenanceResult> => {
      const expected = await createProductMaintenanceIntent(intent.draft);
      if (
        intent.operation !== 'setPrice' ||
        intent.method !== PRICE_METHOD ||
        JSON.stringify(intent) !== JSON.stringify(expected)
      )
        return fail('PRICE_PLAN_SCOPE_MISMATCH');
      const result = await call(PRICE_METHOD, intent.parameters, requestId);
      return classifyProductMaintenanceResponse(intent.draft, result.data);
    }
  };
}
function safeCode(error: unknown): string {
  return error instanceof Error && /^PRODUCT_PRICE_[A-Z_]+$/u.test(error.message)
    ? error.message
    : 'PRODUCT_PRICE_STOPPED';
}
async function absent(path: string, code = 'OUTPUT_ALREADY_EXISTS'): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    return fail('OUTPUT_PREFLIGHT_FAILED');
  }
  return fail(code);
}
async function input(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 100000) return fail('INPUT_FILE_INVALID');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function runProductPriceSmokeCli(args: readonly string[]): Promise<void> {
  const options = parseProductPriceSmokeOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const claimPath = options.creationProof + PRODUCT_PRICE_PROOF_CLAIM_SUFFIX;
  for (const file of [
    options.credential,
    options.creationProof,
    options.plan,
    options.baseline,
    options.receipt,
    claimPath
  ]) {
    const scoped = productReadScopedRoot(root, file);
    if (
      [options.baseline, options.receipt, claimPath].includes(file) &&
      !file.toLowerCase().startsWith((join(scoped, 'artifacts') + sep).toLowerCase())
    )
      return fail('NEW_IGNORED_OUTPUT_REQUIRED');
    await assertIgnoredFile(scoped, file);
  }
  await absent(options.baseline);
  await absent(options.receipt);
  await absent(claimPath, 'PREVIOUS_ATTEMPT_NO_RESEND');
  const proof = parseProductPriceCreationProof(
    await input(options.creationProof),
    options.productId,
    Date.now()
  );
  const plan = await parseProductPricePlan(await input(options.plan), proof);
  const bundle = parseAlibabaOpenApiCredentialBundle(await input(options.credential));
  if (bundle.protocol !== 'iop') return fail('IOP_CREDENTIAL_REQUIRED');
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: IOP_BUSINESS_ENDPOINT,
    signMethod: 'hmac-sha256'
  };
  if ((await galleryGatewayId(credentials)) !== proof.context.gateway) return fail('CONTEXT_MISMATCH');
  const receipt = await open(options.receipt, 'wx', 0o600);
  const appendReceipt = async (event: Readonly<Record<string, unknown>>) => {
    await receipt.writeFile(JSON.stringify(event) + '\n');
    await receipt.sync();
  };
  try {
    await appendReceipt({
      phase: 'started',
      scope: 'price-only',
      schemaVersion: 1,
      context: proof.context,
      productId: proof.product.id,
      creationReceiptId: proof.product.creationReceiptId,
      timeUtc: Date.now()
    });
    const client = createProductPriceAcceptanceClient({
      credentials,
      proof,
      transport: new NativeFetchTransport()
    });
    let proofClaimed = false;
    const result = await runProductPriceMaintenancePlan(plan, proof, {
      ...client,
      write: async (intent, requestId) => {
        if (!proofClaimed) {
          // Keep this marker after every outcome. New output paths must not bypass an unknown prior attempt.
          const text = JSON.stringify({
            schemaVersion: 1,
            scope: 'price-only',
            productId: proof.product.id,
            creationReceiptId: proof.product.creationReceiptId,
            context: proof.context,
            fingerprint: intent.fingerprint,
            requestId
          });
          const handle = await open(claimPath, 'wx', 0o600);
          try {
            await handle.writeFile(text);
            await handle.sync();
          } finally {
            await handle.close();
          }
          if ((await readFile(claimPath, 'utf8')) !== text) return fail('PROOF_CLAIM_NOT_DURABLE');
          proofClaimed = true;
        }
        return client.write(intent, requestId);
      },
      appendReceipt,
      now: Date.now,
      wait: (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
      persistBaseline: async (baseline) => {
        const handle = await open(options.baseline, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify(baseline));
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
      readBaseline: async () => JSON.parse(await readFile(options.baseline, 'utf8')) as unknown,
      readReceipts: async () =>
        (await readFile(options.receipt, 'utf8'))
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown)
    });
    console.log(JSON.stringify(result));
  } catch (error: unknown) {
    await appendReceipt({ phase: 'stopped', reasonCode: safeCode(error), noAutomaticRetry: true });
    return fail(safeCode(error).slice('PRODUCT_PRICE_'.length));
  } finally {
    await receipt.close();
  }
}
if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
) {
  try {
    await runProductPriceSmokeCli(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(safeCode(error));
    process.exitCode = 1;
  }
}
