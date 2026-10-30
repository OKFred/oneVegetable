/** Explicit-ID native IOP inventory evidence only. No writes, retries, scans or CLI effects on import. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { GatewayException } from '../packages/core/src/errors';
import { galleryGatewayId, opaqueGalleryId } from '../packages/core/src/gallery-transfer-context';
import { NativeFetchTransport, type NetworkTransport } from '../packages/core/src/network';
import {
  isProductOperationContext,
  type ProductOperationContext
} from '../packages/core/src/product-operation-context';
import { parseProductSchemaXml, type ProductSchemaField } from '../packages/core/src/product-schema';
import type { GatewayCredentials } from '../packages/core/src/types';
import { installNodeXmlDomGlobals } from './node-xml-dom';
import { assertIgnoredFile } from './smoke-product-reference-real';
import { productReadScopedRoot } from './smoke-product-read-tools-real';

export const INVENTORY_DIAGNOSTIC_PATHS = {
  product: '/alibaba/icbu/product/get/v2',
  inventory: '/icbu/product/inventory/get',
  schema: '/icbu/product/schema/render'
} as const;
type Route = keyof typeof INVENTORY_DIAGNOSTIC_PATHS;
type RecordValue = Record<string, unknown>;
interface Reply {
  data: unknown;
  contractValid: boolean;
}
export interface InventoryDiagnosticOptions {
  productIds: readonly string[];
  credential: string;
  output: string;
  protocol: 'iop';
  confirmReadonly: true;
}
export interface InventoryDiagnosticIO {
  productIds: readonly string[];
  protocol: 'iop' | 'top';
  context: ProductOperationContext;
  assertContext(): Promise<void>;
  read(route: Route, productId: string, requestId: string, categoryId?: number): Promise<Reply>;
  networkCount(): number;
  persist(report: InventoryDiagnosticReport): Promise<void>;
  now(): number;
}
export interface InventoryDiagnosticRow {
  productId: string;
  route: Route;
  path: string;
  requestId: string;
  status: 'accepted' | 'contract-drift' | 'business-rejected' | 'failed' | 'missing-prerequisite';
  networkAttempts: number;
  evidence: RecordValue;
  errorCode?: string;
  subCode?: string;
  contractValid?: boolean;
  businessSuccess?: boolean | null;
}
export interface InventoryDiagnosticReport {
  schemaVersion: 1;
  protocol: 'iop';
  readOnly: true;
  mutationAttempted: false;
  maxAttempts: 1;
  productIds: readonly string[];
  context: ProductOperationContext;
  capturedTimeUtc: number;
  networkRequests: number;
  complete: boolean;
  rows: InventoryDiagnosticRow[];
  stopCode?: string;
}
function fail(code: string): never {
  throw new Error('INVENTORY_DIAG_' + code);
}
function record(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RecordValue) : {};
}
/** All three adapters must preserve IDs exactly; reject values outside the safe-integer wire boundary. */
export function freezeInventoryProductIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return fail('PRODUCT_IDS_INVALID');
  const ids = Array.from(value, (id: unknown) => {
    if (
      typeof id !== 'string' ||
      !/^[1-9][0-9]{0,15}$/u.test(id) ||
      BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return fail('PRODUCT_IDS_INVALID');
    return id;
  });
  if (new Set(ids).size !== ids.length) return fail('PRODUCT_IDS_INVALID');
  return Object.freeze(ids);
}
function target(value: string, productIds: readonly string[]): void {
  if (!productIds.includes(value)) fail('TARGET_DENIED');
}
function type(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
export function inventoryFieldEvidence(
  owner: unknown,
  key: string,
  numeric = false,
  signed = false
): RecordValue {
  const object = record(owner),
    present = Object.hasOwn(object, key),
    value = object[key];
  const evidence: RecordValue = { present, type: present ? type(value) : 'missing' };
  if (Array.isArray(value)) evidence.count = value.length;
  if (!numeric) return evidence;
  if (typeof value === 'number') evidence.safeInteger = Number.isSafeInteger(value);
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : null;
  if (
    text !== null &&
    text.length <= 20 &&
    (signed ? /^-?(0|[1-9][0-9]*)$/u : /^(0|[1-9][0-9]*)$/u).test(text)
  ) {
    const integer = BigInt(text);
    if (integer >= (signed ? -9223372036854775808n : 0n) && integer <= 9223372036854775807n)
      evidence.integerString = text;
  }
  return evidence;
}
function warehouse(owner: unknown, key: string): RecordValue {
  const evidence = inventoryFieldEvidence(owner, key),
    value = record(owner)[key];
  if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value)) evidence.code = value;
  return evidence;
}
function integer(owner: unknown, key: string): string | undefined {
  const value = inventoryFieldEvidence(owner, key, true).integerString;
  return typeof value === 'string' ? value : undefined;
}
export function productInventoryEvidence(data: unknown, productId: string) {
  const value = record(data),
    info = record(value.product_info),
    basic = record(info.basic_info);
  if (integer(basic, 'product_id') !== productId) return fail('RESPONSE_TARGET_MISMATCH');
  const trade = record(info.trade_info),
    category = record(info.category_info);
  const categoryText = integer(category, 'category_id');
  const categoryId =
    categoryText && Number.isSafeInteger(Number(categoryText)) && Number(categoryText) > 0
      ? Number(categoryText)
      : undefined;
  const rows = Array.isArray(trade.sku_info)
    ? trade.sku_info.slice(0, 500).map((row: unknown) => ({
        skuId: inventoryFieldEvidence(row, 'sku_id', true, true),
        inventory: inventoryFieldEvidence(row, 'inventory', true)
      }))
    : [];
  const evidence: RecordValue = {
    productId: inventoryFieldEvidence(basic, 'product_id', true),
    categoryId: inventoryFieldEvidence(category, 'category_id', true),
    title: inventoryFieldEvidence(basic, 'title'),
    model: inventoryFieldEvidence(basic, 'model_number'),
    platformStatus: warehouse(basic, 'status'),
    auditStatus: warehouse(basic, 'audit_status'),
    tradeInfo: inventoryFieldEvidence(info, 'trade_info'),
    inventory: inventoryFieldEvidence(trade, 'inventory', true),
    skuInfo: inventoryFieldEvidence(trade, 'sku_info'),
    skuRows: rows,
    unexpectedRootSkuInfo: inventoryFieldEvidence(info, 'sku_info')
  };
  return { evidence, categoryId };
}
export function inventoryListEvidence(data: unknown): RecordValue {
  const result = record(record(data).result);
  return {
    dataList: inventoryFieldEvidence(result, 'data_list'),
    rows: Array.isArray(result.data_list)
      ? result.data_list.slice(0, 500).map((row: unknown) => ({
          skuId: inventoryFieldEvidence(row, 'sku_id', true, true),
          warehouse: warehouse(row, 'inventory_code'),
          inventory: inventoryFieldEvidence(row, 'inventory', true)
        }))
      : []
  };
}
function active(field: ProductSchemaField): ProductSchemaField[] {
  return [field, ...field.instances.flatMap((instance) => instance.fields.flatMap(active))];
}
export function inventorySchemaEvidence(xml: unknown): RecordValue {
  if (typeof xml !== 'string' || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/iu.test(xml))
    fail('SCHEMA_INVALID');
  const model = parseProductSchemaXml(xml),
    fields = model.fields.flatMap(active);
  return {
    parseWarningCount: model.warnings.length,
    inventoryFields: fields
      .filter((field) => field.id === 'inventory' || field.id === 'skuStock')
      .map((field) => ({
        fieldId: field.id,
        sourcePath: field.sourcePath,
        type: field.type,
        valueCount: field.values.length,
        declaredAttributes: field.rules
          .filter((rule) => rule.name === 'valueAttributeRule')
          .map((rule) => rule.value)
          .filter((name) => name === 'warehouseCode' || name === 'srcValue'),
        values: field.values.slice(0, 500).map((value) => ({
          inventory: inventoryFieldEvidence(value, 'text', true),
          warehouse: warehouse(value.attributes, 'warehouseCode'),
          sourceInventory: inventoryFieldEvidence(value.attributes, 'srcValue', true)
        }))
      })),
    collections: fields
      .filter((field) => field.id === 'sku' || field.id === 'saleProp')
      .map((field) => ({
        fieldId: field.id,
        sourcePath: field.sourcePath,
        instanceCount: field.instances.length,
        templateCount: field.children.length
      }))
  };
}
export function parseInventoryDiagnosticOptions(args: readonly string[]): InventoryDiagnosticOptions {
  const values = new Map<string, string>();
  let confirm = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--confirm-readonly') {
      if (confirm) fail('OPTIONS_INVALID');
      confirm = true;
      continue;
    }
    const match = /^--(credential|output|protocol|product-ids)(?:=(.*))?$/u.exec(arg),
      key = match?.[1];
    if (!key || values.has(key)) return fail('OPTIONS_INVALID');
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) return fail('OPTIONS_INVALID');
    values.set(key, value);
  }
  if (!confirm || values.get('protocol') !== 'iop' || !values.get('credential') || !values.get('output'))
    return fail('EXPLICIT_IOP_READONLY_REQUIRED');
  const credential = resolve(values.get('credential') ?? ''),
    output = resolve(values.get('output') ?? '');
  if (credential.toLowerCase() === output.toLowerCase()) return fail('PATH_COLLISION');
  const productIds = freezeInventoryProductIds((values.get('product-ids') ?? '').split(','));
  return { credential, output, protocol: 'iop', confirmReadonly: true, productIds };
}
export async function assertInventoryDiagnosticPaths(
  options: Pick<InventoryDiagnosticOptions, 'credential' | 'output'>,
  root: string,
  guard: typeof assertIgnoredFile = assertIgnoredFile
): Promise<string> {
  const outputRoot = productReadScopedRoot(root, options.output);
  if (!options.output.toLowerCase().startsWith((join(outputRoot, 'artifacts') + sep).toLowerCase()))
    return fail('IGNORED_OUTPUT_REQUIRED');
  await guard(productReadScopedRoot(root, options.credential), options.credential);
  await guard(outputRoot, options.output);
  return outputRoot;
}
function errorCode(cause: unknown): string {
  const value =
    cause instanceof GatewayException
      ? cause.gatewayError.code
      : cause instanceof Error && /^INVENTORY_DIAG_[A-Z_]+$/u.test(cause.message)
        ? cause.message
        : '';
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/u.test(value) ? value : 'READ_FAILED';
}
export class InventoryReadonlyTransport implements NetworkTransport {
  private readonly seen = new Set<string>();
  private readonly productIds: readonly string[];
  readonly categories = new Map<string, number>();
  get requests(): number {
    return this.seen.size;
  }
  constructor(
    private readonly transport: NetworkTransport,
    private readonly assertContext: () => Promise<void>,
    productIds: readonly string[]
  ) {
    this.productIds = freezeInventoryProductIds(productIds);
  }
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    await this.assertContext();
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    const route = (Object.keys(INVENTORY_DIAGNOSTIC_PATHS) as Route[]).find(
      (route) => url.pathname === '/rest' + INVENTORY_DIAGNOSTIC_PATHS[route]
    );
    if (
      !route ||
      url.origin !== new URL(IOP_BUSINESS_ENDPOINT).origin ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      init.method !== 'POST' ||
      init.redirect !== 'manual' ||
      !(init.body instanceof URLSearchParams)
    )
      return fail('TRANSPORT_DENIED');
    const body = init.body;
    const keys = [...body.keys()];
    if (new Set(keys).size !== keys.length) return fail('TRANSPORT_DENIED');
    const request = route === 'schema' ? record(JSON.parse(body.get('render_request') ?? 'null')) : null;
    const productId = request ? (integer(request, 'product_id') ?? '') : (body.get('product_id') ?? '');
    target(productId, this.productIds);
    if (route !== 'product' && (request ? request.language : body.get('language')) !== 'en_US')
      return fail('TRANSPORT_DENIED');
    if (
      request &&
      (!this.categories.has(productId) || String(request.cat_id) !== String(this.categories.get(productId)))
    )
      return fail('CATEGORY_UNCONFIRMED');
    const key = route + ':' + productId;
    if (this.seen.has(key)) return fail('RETRY_DENIED');
    this.seen.add(key);
    return this.transport.send(input, init);
  }
}
export async function createInventoryDiagnosticReader(options: {
  credentials: GatewayCredentials;
  productIds: readonly string[];
  transport?: NetworkTransport;
  assertContext?: () => Promise<void>;
}) {
  if (options.credentials.protocol !== 'iop' || options.credentials.endpoint !== IOP_BUSINESS_ENDPOINT)
    return fail('IOP_CREDENTIAL_REQUIRED');
  const productIds = freezeInventoryProductIds(options.productIds);
  const credentials = Object.freeze({ ...options.credentials });
  const context = Object.freeze({
    identity: await opaqueGalleryId('product-inventory-readonly-diagnostic'),
    gateway: await galleryGatewayId(credentials)
  });
  const check = options.assertContext ?? (() => Promise.resolve());
  const transport = new InventoryReadonlyTransport(
    options.transport ?? new NativeFetchTransport(),
    check,
    productIds
  );
  const gateway = new AlibabaReadGatewayClient(credentials, { transport, maxAttempts: 1 });
  const pendingReview = new Set<string>();
  const assertContext = async () => {
    await check();
    if (
      (await gateway.credentialProtocol()) !== 'iop' ||
      (await gateway.galleryGatewayContextId()) !== context.gateway
    )
      return fail('CONTEXT_CHANGED');
  };
  const read: InventoryDiagnosticIO['read'] = async (route, productId, requestId, categoryId) => {
    if (!Object.hasOwn(INVENTORY_DIAGNOSTIC_PATHS, route)) return fail('ROUTE_DENIED');
    target(productId, productIds);
    await assertContext();
    const scope = { requestId, productContext: context };
    let reply: Reply;
    if (route === 'schema') {
      if (pendingReview.has(productId)) return fail('PLATFORM_REVIEW_PENDING');
      if (categoryId === undefined || transport.categories.get(productId) !== categoryId)
        return fail('CATEGORY_UNCONFIRMED');
      const value = await gateway.request(
        'renderProductSchema',
        { productId, categoryId, language: 'en_US' },
        scope
      );
      reply = { data: value.xml, contractValid: true };
    } else {
      const result = await gateway.request(
        'callCapability',
        {
          method:
            route === 'product' ? INVENTORY_DIAGNOSTIC_PATHS.product : 'alibaba.icbu.product.inventory.get',
          parameters: { product_id: productId, ...(route === 'inventory' ? { language: 'en_US' } : {}) }
        },
        scope
      );
      reply = { data: result.data, contractValid: result.contractValid };
      if (route === 'product' && record(result.data).success === true) {
        const audit = record(record(record(result.data).product_info).basic_info).audit_status;
        if (typeof audit === 'string' && audit.toLowerCase() === 'pending') pendingReview.add(productId);
        else pendingReview.delete(productId);
        const { categoryId } = productInventoryEvidence(result.data, productId);
        if (categoryId !== undefined) transport.categories.set(productId, categoryId);
      }
    }
    await assertContext();
    return reply;
  };
  return Object.freeze({
    protocol: 'iop' as const,
    productIds,
    context,
    assertContext,
    read,
    networkCount: () => transport.requests
  });
}
export async function runInventoryReadonlyDiagnostic(
  io: InventoryDiagnosticIO
): Promise<InventoryDiagnosticReport> {
  if (io.protocol !== 'iop' || !isProductOperationContext(io.context)) return fail('IOP_CONTEXT_REQUIRED');
  const productIds = freezeInventoryProductIds(io.productIds);
  const report: InventoryDiagnosticReport = {
    schemaVersion: 1,
    protocol: 'iop',
    readOnly: true,
    mutationAttempted: false,
    maxAttempts: 1,
    productIds,
    context: Object.freeze({ ...io.context }),
    capturedTimeUtc: io.now(),
    networkRequests: 0,
    complete: false,
    rows: []
  };
  await io.assertContext();
  await io.persist(report);
  try {
    for (const productId of productIds) {
      let categoryId: number | undefined;
      let reviewPending = false;
      for (const route of ['product', 'inventory', 'schema'] as const) {
        await io.assertContext();
        const row: InventoryDiagnosticRow = {
          productId,
          route,
          path: INVENTORY_DIAGNOSTIC_PATHS[route],
          requestId: randomUUID(),
          status: 'failed',
          networkAttempts: 0,
          evidence: {}
        };
        const before = io.networkCount();
        try {
          if (route === 'schema' && (reviewPending || categoryId === undefined)) {
            row.status = 'missing-prerequisite';
            row.evidence = { reason: reviewPending ? 'platform-review-pending' : 'category-unavailable' };
          } else {
            const reply = await io.read(route, productId, row.requestId, categoryId);
            await io.assertContext();
            const business = route === 'inventory' ? record(record(reply.data).result) : record(reply.data);
            const success = route === 'schema' || business.success === true;
            row.contractValid = reply.contractValid;
            row.businessSuccess =
              route === 'schema' ? true : typeof business.success === 'boolean' ? business.success : null;
            row.status = !reply.contractValid
              ? 'contract-drift'
              : success
                ? 'accepted'
                : business.success === false
                  ? 'business-rejected'
                  : 'contract-drift';
            if (route === 'product') {
              const audit = record(record(record(reply.data).product_info).basic_info).audit_status;
              reviewPending = typeof audit === 'string' && audit.toLowerCase() === 'pending';
              const value = productInventoryEvidence(reply.data, productId);
              row.evidence = value.evidence;
              // A diagnostic may read Schema using independently validated ID/category despite unrelated field drift.
              if (business.success === true) categoryId = value.categoryId;
            } else if (route === 'inventory') row.evidence = inventoryListEvidence(reply.data);
            else row.evidence = inventorySchemaEvidence(reply.data);
          }
        } catch (cause: unknown) {
          if (errorCode(cause) === 'INVENTORY_DIAG_CONTEXT_CHANGED') throw cause;
          row.status = 'failed';
          row.errorCode = errorCode(cause);
          if (
            cause instanceof GatewayException &&
            typeof cause.gatewayError.subCode === 'string' &&
            /^[A-Za-z0-9_.:-]{1,100}$/u.test(cause.gatewayError.subCode)
          )
            row.subCode = cause.gatewayError.subCode;
        }
        row.networkAttempts = io.networkCount() - before;
        report.rows.push(row);
        report.networkRequests = io.networkCount();
        await io.persist(report);
      }
    }
    report.complete = true;
  } catch (cause: unknown) {
    report.stopCode = errorCode(cause);
    report.networkRequests = io.networkCount();
    await io.persist(report);
    throw cause;
  }
  await io.persist(report);
  return report;
}
export async function runInventoryDiagnosticCli(args: readonly string[]): Promise<void> {
  const options = parseInventoryDiagnosticOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const outputRoot = await assertInventoryDiagnosticPaths(options, root);
  const stat = await lstat(options.credential);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000) return fail('CREDENTIAL_FILE_INVALID');
  const credentialText = await readFile(options.credential, 'utf8');
  const fingerprint = createHash('sha256').update(credentialText).digest('hex');
  const bundle = parseAlibabaOpenApiCredentialBundle(JSON.parse(credentialText) as unknown);
  if (bundle.protocol !== 'iop') return fail('IOP_CREDENTIAL_REQUIRED');
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: IOP_BUSINESS_ENDPOINT,
    signMethod: 'hmac-sha256'
  };
  const reader = await createInventoryDiagnosticReader({
    credentials,
    productIds: options.productIds,
    assertContext: async () => {
      await assertIgnoredFile(productReadScopedRoot(root, options.credential), options.credential);
      const current = createHash('sha256')
        .update(await readFile(options.credential, 'utf8'))
        .digest('hex');
      if (current !== fingerprint) return fail('CONTEXT_CHANGED');
    }
  });
  await mkdir(dirname(options.output), { recursive: true });
  await assertInventoryDiagnosticPaths(options, root);
  const handle = await open(options.output, 'wx', 0o600);
  const restore = installNodeXmlDomGlobals();
  try {
    const report = await runInventoryReadonlyDiagnostic({
      ...reader,
      now: Date.now,
      persist: async (report) => {
        await assertIgnoredFile(outputRoot, options.output);
        const text = JSON.stringify(report, null, 2) + '\n';
        if (
          [credentials.appKey, credentials.appSecret, credentials.accessToken].some(
            (secret) => secret && text.includes(secret)
          )
        )
          return fail('REPORT_REDACTION_FAILED');
        await handle.truncate(0);
        const result = await handle.write(text, 0, 'utf8');
        if (result.bytesWritten !== Buffer.byteLength(text)) return fail('REPORT_NOT_DURABLE');
        await handle.sync();
        if ((await readFile(options.output, 'utf8')) !== text) return fail('REPORT_NOT_DURABLE');
      }
    });
    console.log(
      JSON.stringify({
        status: 'read-only-diagnostic-completed',
        output: options.output,
        networkRequests: report.networkRequests,
        accepted: report.rows.filter((row) => row.status === 'accepted').length,
        failed: report.rows.filter((row) => !['accepted', 'missing-prerequisite'].includes(row.status))
          .length,
        skipped: report.rows.filter((row) => row.status === 'missing-prerequisite').length,
        mutationAttempted: false
      })
    );
  } finally {
    restore();
    await handle.close();
  }
}
if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()
) {
  try {
    await runInventoryDiagnosticCli(process.argv.slice(2));
  } catch (cause: unknown) {
    console.error(errorCode(cause));
    process.exitCode = 1;
  }
}
