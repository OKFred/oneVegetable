/** Opt-in local acceptance only. Importing this module performs no I/O and sends no requests. */
import { open, readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { createIopBusinessRequest } from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { galleryGatewayId } from '../packages/core/src/gallery-transfer-context';
import { NetworkManager, NativeFetchTransport } from '../packages/core/src/network';
import type { NetworkTransport } from '../packages/core/src/network';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../packages/core/src/capability-validation-lazy';
import { createProductMaintenancePlatform } from '../packages/core/src/product-maintenance-platform';
import {
  PRODUCT_MAINTENANCE_METHODS,
  createProductMaintenanceIntent,
  classifyProductMaintenanceResponse,
  validateProductMaintenanceDiagnostics,
  comparePriceReadback,
  compareInventoryReadback
} from '../packages/core/src/product-maintenance-api';
import type {
  ProductMaintenanceDraft,
  ProductMaintenanceIntent,
  ProductMaintenanceResult,
  ProductMaintenanceSnapshot,
  ProductPriceDraft,
  ProductInventoryDraft,
  ProductDraftDeleteDraft
} from '../packages/core/src/product-maintenance-api';
import { createProductMaintenanceBaseline } from '../packages/core/src/product-maintenance-service';
import type { ProductMaintenanceBaseline } from '../packages/core/src/product-maintenance-service';
import { isProductOperationContext } from '../packages/core/src/product-operation-context';
import type { ProductOperationContext } from '../packages/core/src/product-operation-context';
import type { GatewayCredentials } from '../packages/core/src/types';

export const PRODUCT_VALUE_POLL_MS = 5000;
export const PRODUCT_VALUE_VERIFY_MS = 300000;
const READ_METHOD = '/alibaba/icbu/product/get/v2';
export interface ProductValueSmokeOptions {
  credential: string;
  baseline: string;
  receipt: string;
  creationProof: string;
  plan: string;
  productId: string;
}
export interface ProductValueCreationProof {
  schemaVersion: 1;
  purpose: 'product-value-maintenance-test';
  context: ProductOperationContext;
  createdTimeUtc: number;
  product: { id: string; creationReceiptId: string; unbranded: true };
  draft: { id: string; creationReceiptId: string };
}
export interface ProductValuePlan {
  schemaVersion: 1;
  price: ProductPriceDraft;
  inventory: ProductInventoryDraft;
  deleteDraft: ProductDraftDeleteDraft;
}
export interface ProductValueBaseline {
  schemaVersion: 1;
  productId: string;
  context: ProductOperationContext;
  capturedTimeUtc: number;
  creationReceiptIds: { product: string; draft: string };
  price: ProductMaintenanceBaseline;
  inventory: ProductMaintenanceBaseline;
  restorePrice: ProductPriceDraft;
  restoreInventory: ProductInventoryDraft;
}
export interface ProductValueSmokeIO {
  readProduct: (id: string) => Promise<ProductMaintenanceSnapshot>;
  write: (intent: ProductMaintenanceIntent) => Promise<ProductMaintenanceResult>;
  persistBaseline: (baseline: ProductValueBaseline) => Promise<void>;
  readBaseline: () => Promise<unknown>;
  appendReceipt: (event: Readonly<Record<string, unknown>>) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  now: () => number;
}
function fail(code: string): never {
  throw new Error('PRODUCT_VALUE_' + code);
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INPUT_INVALID');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) return fail('INPUT_INVALID');
  return row;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n)
    return fail('INPUT_INVALID');
  return value;
}
function receiptId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value)) return fail('PROOF_INVALID');
  return value;
}
export function parseProductValueSmokeOptions(args: readonly string[]): ProductValueSmokeOptions {
  const flags = new Map<string, string>();
  let confirmed = false;
  const allowed = ['credential', 'baseline', 'receipt', 'creation-proof', 'plan', 'product-id'];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--confirm-real-write') {
      if (confirmed) return fail('OPTIONS_INVALID');
      confirmed = true;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/u.exec(arg);
    const name = match?.[1];
    if (!name || !allowed.includes(name) || flags.has(name)) return fail('OPTIONS_INVALID');
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) return fail('OPTIONS_INVALID');
    flags.set(name, value);
  }
  if (!confirmed || allowed.some((name) => !flags.has(name))) return fail('EXPLICIT_CONFIRMATION_REQUIRED');
  const credential = resolve(flags.get('credential') ?? fail('OPTIONS_INVALID'));
  const baseline = resolve(flags.get('baseline') ?? fail('OPTIONS_INVALID'));
  const receipt = resolve(flags.get('receipt') ?? fail('OPTIONS_INVALID'));
  const creationProof = resolve(flags.get('creation-proof') ?? fail('OPTIONS_INVALID'));
  const plan = resolve(flags.get('plan') ?? fail('OPTIONS_INVALID'));
  if (
    new Set([credential, baseline, receipt, creationProof, plan].map((path) => path.toLowerCase())).size !== 5
  )
    return fail('PATH_COLLISION');
  return { credential, baseline, receipt, creationProof, plan, productId: id(flags.get('product-id')) };
}
export function parseProductValueCreationProof(
  value: unknown,
  productId: string,
  now: number
): ProductValueCreationProof {
  const row = object(value, ['schemaVersion', 'purpose', 'context', 'createdTimeUtc', 'product', 'draft']);
  const product = object(row.product, ['id', 'creationReceiptId', 'unbranded']);
  const draft = object(row.draft, ['id', 'creationReceiptId']);
  if (
    row.schemaVersion !== 1 ||
    row.purpose !== 'product-value-maintenance-test' ||
    !isProductOperationContext(row.context) ||
    typeof row.createdTimeUtc !== 'number' ||
    !Number.isSafeInteger(row.createdTimeUtc) ||
    row.createdTimeUtc < 0 ||
    row.createdTimeUtc > now ||
    now - row.createdTimeUtc > 86400000 ||
    product.unbranded !== true ||
    id(product.id) !== id(productId) ||
    id(draft.id) === productId
  )
    return fail('PROOF_INVALID');
  return {
    schemaVersion: 1,
    purpose: 'product-value-maintenance-test',
    context: row.context,
    createdTimeUtc: row.createdTimeUtc,
    product: { id: productId, creationReceiptId: receiptId(product.creationReceiptId), unbranded: true },
    draft: { id: id(draft.id), creationReceiptId: receiptId(draft.creationReceiptId) }
  };
}
export async function parseProductValuePlan(
  value: unknown,
  proof: ProductValueCreationProof
): Promise<ProductValuePlan> {
  const row = object(value, ['schemaVersion', 'price', 'inventory', 'deleteDraft']);
  if (row.schemaVersion !== 1) return fail('PLAN_INVALID');
  const price = (await createProductMaintenanceIntent(row.price)).draft;
  const inventory = (await createProductMaintenanceIntent(row.inventory)).draft;
  const deletion = (await createProductMaintenanceIntent(row.deleteDraft)).draft;
  if (
    price.operation !== 'setPrice' ||
    inventory.operation !== 'setInventory' ||
    deletion.operation !== 'deleteDraft' ||
    price.productId !== proof.product.id ||
    inventory.productId !== proof.product.id ||
    deletion.draftIds.length !== 1 ||
    deletion.draftIds[0] !== proof.draft.id ||
    deletion.knownDrafts.length !== 1 ||
    deletion.knownDrafts[0]?.source !== 'draft-create'
  )
    return fail('PLAN_SCOPE_MISMATCH');
  return { schemaVersion: 1, price, inventory, deleteDraft: deletion };
}
function restoreDraft(
  draft: ProductPriceDraft | ProductInventoryDraft,
  baseline: ProductMaintenanceBaseline
): ProductPriceDraft | ProductInventoryDraft {
  const field = (name: string): string => baseline.fields[name] ?? fail('BASELINE_INVALID');
  if (draft.operation === 'setInventory')
    return draft.mode === 'spu'
      ? { operation: 'setInventory', productId: draft.productId, mode: 'spu', inventory: field('inventory') }
      : {
          operation: 'setInventory',
          productId: draft.productId,
          mode: 'sku',
          skus: draft.skus.map((row) => ({
            skuId: row.skuId,
            inventory: field('skus/' + row.skuId + '/inventory')
          }))
        };
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
function compare(draft: ProductPriceDraft | ProductInventoryDraft, snapshot: ProductMaintenanceSnapshot) {
  return draft.operation === 'setPrice'
    ? comparePriceReadback(draft, snapshot)
    : compareInventoryReadback(draft, snapshot);
}
export async function runProductValueMaintenancePlan(
  plan: ProductValuePlan,
  proof: ProductValueCreationProof,
  io: ProductValueSmokeIO
): Promise<{ price: 'restored'; inventory: 'restored'; draft: 'reported-deleted' }> {
  // Revalidate even programmatic callers. A creation proof is a trusted parent attestation, not provider acceptance.
  proof = parseProductValueCreationProof(proof, proof.product.id, io.now());
  plan = await parseProductValuePlan(plan, proof);
  const snapshot = await io.readProduct(proof.product.id);
  const price = await createProductMaintenanceBaseline(plan.price, snapshot);
  const inventory = await createProductMaintenanceBaseline(plan.inventory, snapshot);
  const restorePrice = (await createProductMaintenanceIntent(restoreDraft(plan.price, price))).draft;
  const restoreInventory = (await createProductMaintenanceIntent(restoreDraft(plan.inventory, inventory)))
    .draft;
  if (restorePrice.operation !== 'setPrice' || restoreInventory.operation !== 'setInventory')
    return fail('BASELINE_INVALID');
  if (
    compare(plan.price, snapshot).status === 'matched' ||
    compare(plan.inventory, snapshot).status === 'matched'
  )
    return fail('PLAN_NO_CHANGE');
  const baseline: ProductValueBaseline = {
    schemaVersion: 1,
    productId: proof.product.id,
    context: proof.context,
    capturedTimeUtc: io.now(),
    creationReceiptIds: { product: proof.product.creationReceiptId, draft: proof.draft.creationReceiptId },
    price,
    inventory,
    restorePrice,
    restoreInventory
  };
  await io.persistBaseline(baseline);
  const persisted = await io.readBaseline();
  if (JSON.stringify(persisted) !== JSON.stringify(baseline)) return fail('BASELINE_NOT_PERSISTED');
  await io.appendReceipt({
    schemaVersion: 1,
    phase: 'baseline-persisted',
    productId: proof.product.id,
    priceFingerprint: price.fingerprint,
    inventoryFingerprint: inventory.fingerprint
  });
  const write = async (draft: ProductMaintenanceDraft, phase: string): Promise<void> => {
    const intent = await createProductMaintenanceIntent(draft);
    await io.appendReceipt({
      phase: 'sending',
      step: phase,
      method: intent.method,
      fingerprint: intent.fingerprint
    });
    let result: ProductMaintenanceResult;
    try {
      result = await io.write(intent);
    } catch {
      await io.appendReceipt({ phase: 'ambiguous', step: phase, reason: 'unknown-outcome' });
      return fail('WRITE_OUTCOME_UNKNOWN');
    }
    const shape = object(result, [
      'operation',
      'protocol',
      'status',
      'reason',
      'readbackRequired',
      'items',
      'errorCode',
      'subCode',
      'traceId'
    ]);
    if (!validateProductMaintenanceDiagnostics(shape)) return fail('INPUT_INVALID');
    await io.appendReceipt({ phase: result.status, step: phase, result });
    if (shape.operation !== draft.operation || shape.protocol !== 'iop' || shape.status !== 'accepted')
      return fail('WRITE_NOT_ACCEPTED');
    if (
      draft.operation === 'deleteDraft' &&
      (result.items?.length !== 1 ||
        result.items[0]?.draftId !== proof.draft.id ||
        result.items[0].status !== 'reported-deleted')
    )
      return fail('DELETION_EVIDENCE_INCOMPLETE');
  };
  const verify = async (draft: ProductPriceDraft | ProductInventoryDraft, phase: string): Promise<void> => {
    const deadline = io.now() + PRODUCT_VALUE_VERIFY_MS;
    for (
      let attempt = 1;
      attempt <= PRODUCT_VALUE_VERIFY_MS / PRODUCT_VALUE_POLL_MS && io.now() < deadline;
      attempt++
    ) {
      await io.wait(Math.min(PRODUCT_VALUE_POLL_MS, deadline - io.now()));
      let matched = false;
      try {
        matched = compare(draft, await io.readProduct(proof.product.id)).status === 'matched';
      } catch {
        /* Reads may be retried, writes never are. Persist no response or error text. */
      }
      if (matched) {
        await io.appendReceipt({ phase: 'readback-confirmed', step: phase, attempt });
        return;
      }
    }
    return fail('READBACK_UNRESOLVED');
  };
  const cycle = async (
    draft: ProductPriceDraft | ProductInventoryDraft,
    original: ProductPriceDraft | ProductInventoryDraft,
    expected: ProductMaintenanceBaseline
  ): Promise<void> => {
    const fresh = await createProductMaintenanceBaseline(draft, await io.readProduct(proof.product.id));
    if (fresh.fingerprint !== expected.fingerprint) return fail('BASELINE_CHANGED');
    await write(draft, draft.operation + ':change');
    await verify(draft, draft.operation + ':change');
    if (compare(draft, await io.readProduct(proof.product.id)).status !== 'matched')
      return fail('CONCURRENT_CHANGE_STOPPED_RESTORATION');
    await write(original, draft.operation + ':restore');
    await verify(original, draft.operation + ':restore');
  };
  await cycle(plan.price, restorePrice, price);
  await cycle(plan.inventory, restoreInventory, inventory);
  await write(plan.deleteDraft, 'deleteDraft');
  await io.appendReceipt({
    phase: 'price-inventory-restored-draft-accepted',
    draftReadback: 'not-performed',
    noAutomaticRetry: true
  });
  return { price: 'restored', inventory: 'restored', draft: 'reported-deleted' };
}

/** One armed exact signed request, four fixed paths, no redirects or hidden requests. */
export class ProductValueGuardedTransport implements NetworkTransport {
  private armed: { url: string; body: string } | null = null;
  private readonly counts = new Map<string, number>();
  constructor(private readonly transport: NetworkTransport) {}
  arm(method: string, url: string, body: URLSearchParams): void {
    if (this.armed || ![...Object.values(PRODUCT_MAINTENANCE_METHODS), READ_METHOD].includes(method))
      return fail('TRANSPORT_SCOPE_DENIED');
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
    const path = new URL(url).pathname.slice('/rest'.length);
    const maximum = path === READ_METHOD ? 260 : path === PRODUCT_MAINTENANCE_METHODS.deleteDraft ? 1 : 2;
    const count = this.counts.get(path) ?? 0;
    if (count >= maximum) return fail('TRANSPORT_BUDGET_EXHAUSTED');
    this.counts.set(path, count + 1);
    return this.transport.send(input, init);
  }
}
export function createProductValueAcceptanceClient(options: {
  credentials: GatewayCredentials;
  proof: ProductValueCreationProof;
  transport: NetworkTransport;
}) {
  const guard = new ProductValueGuardedTransport(options.transport);
  const network = new NetworkManager({
    transport: guard,
    policies: {
      alibaba: {
        allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin],
        allowUrl: (url) =>
          url.pathname === '/rest' + READ_METHOD ||
          Object.values(PRODUCT_MAINTENANCE_METHODS).some((path) => url.pathname === '/rest' + path),
        timeoutMilliseconds: 30000,
        maxRequestBytes: 1024 * 1024,
        maxResponseBytes: 5 * 1024 * 1024,
        redirect: 'error'
      }
    }
  });
  const call = async (method: string, parameters: Readonly<Record<string, unknown>>) => {
    if (![...Object.values(PRODUCT_MAINTENANCE_METHODS), READ_METHOD].includes(method))
      return fail('TRANSPORT_SCOPE_DENIED');
    if (method === PRODUCT_MAINTENANCE_METHODS.deleteDraft) {
      if (JSON.stringify(parameters.product_id_list) !== JSON.stringify([options.proof.draft.id]))
        return fail('PLAN_SCOPE_MISMATCH');
    } else if (parameters.product_id !== options.proof.product.id) return fail('PLAN_SCOPE_MISMATCH');
    if ((await validateCapabilityRequest(method, parameters)).length) return fail('REQUEST_CONTRACT_INVALID');
    const signed = await createIopBusinessRequest(options.credentials, method, parameters);
    const body = new URLSearchParams(signed.parameters);
    guard.arm(method, signed.url, body);
    const response = await network.request({
      service: 'alibaba',
      url: signed.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      responseType: 'json',
      maxAttempts: 1
    });
    if (!response.ok) return fail('TRANSPORT_OUTCOME_UNKNOWN');
    if ((await validateCapabilityResponse(method, response.data)).length)
      return fail('RESPONSE_CONTRACT_INVALID');
    return { method, data: response.data };
  };
  const platform = createProductMaintenancePlatform({
    context: options.proof.context,
    client: { call },
    enabled: true,
    validateRequest: validateCapabilityRequest,
    validateResponse: validateCapabilityResponse
  });
  return {
    readProduct: platform.readProduct ?? fail('READBACK_UNAVAILABLE'),
    write: async (intent: ProductMaintenanceIntent): Promise<ProductMaintenanceResult> => {
      const expected = await createProductMaintenanceIntent(intent.draft);
      if (JSON.stringify(expected) !== JSON.stringify(intent)) return fail('INTENT_MISMATCH');
      const response = await call(intent.method, intent.parameters);
      return classifyProductMaintenanceResponse(intent.draft, response.data);
    }
  };
}
function safeCode(error: unknown): string {
  return error instanceof Error && /^PRODUCT_VALUE_[A-Z_]+$/u.test(error.message)
    ? error.message
    : 'PRODUCT_VALUE_STOPPED';
}
async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    return fail('OUTPUT_PREFLIGHT_FAILED');
  }
  return fail('OUTPUT_ALREADY_EXISTS');
}
export async function runProductValueSmokeCli(args: readonly string[]): Promise<void> {
  const options = parseProductValueSmokeOptions(args);
  await assertAbsent(options.receipt);
  await assertAbsent(options.baseline);
  const proof = parseProductValueCreationProof(
    JSON.parse(await readFile(options.creationProof, 'utf8')) as unknown,
    options.productId,
    Date.now()
  );
  const plan = await parseProductValuePlan(
    JSON.parse(await readFile(options.plan, 'utf8')) as unknown,
    proof
  );
  const bundle = parseAlibabaOpenApiCredentialBundle(
    JSON.parse(await readFile(options.credential, 'utf8')) as unknown
  );
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
  const appendReceipt = async (event: Readonly<Record<string, unknown>>): Promise<void> => {
    await receipt.writeFile(JSON.stringify({ atTimeUtc: Date.now(), ...event }) + '\n');
    await receipt.sync();
  };
  try {
    await appendReceipt({
      schemaVersion: 1,
      phase: 'started',
      context: proof.context,
      productId: proof.product.id,
      draftId: proof.draft.id,
      creationReceiptIds: {
        product: proof.product.creationReceiptId,
        draft: proof.draft.creationReceiptId
      }
    });
    const client = createProductValueAcceptanceClient({
      credentials,
      proof,
      transport: new NativeFetchTransport()
    });
    await runProductValueMaintenancePlan(plan, proof, {
      ...client,
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
      readBaseline: async () => JSON.parse(await readFile(options.baseline, 'utf8')) as unknown
    });
  } catch (error: unknown) {
    await appendReceipt({ phase: 'stopped', reasonCode: safeCode(error), noAutomaticRetry: true });
    return fail(safeCode(error).slice('PRODUCT_VALUE_'.length));
  } finally {
    await receipt.close();
  }
}
if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
) {
  try {
    await runProductValueSmokeCli(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(safeCode(error));
    process.exitCode = 1;
  }
}
