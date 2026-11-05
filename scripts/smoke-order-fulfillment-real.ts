/**
 * Explicit IOP-only reads. Importing this module does not read credentials or send requests.
 * --confirm-readonly --credential=<ignored remote IOP JSON> --receipt=artifacts/<new>.json
 * Eight planned network reads use seven unique paths (seller/buyer share order/list).
 * Advanced freight stays missing-prerequisite: no company/SKU discovery is authorized here.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { galleryGatewayId, opaqueGalleryId } from '../packages/core/src/gallery-transfer-context';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { NativeFetchTransport, isRequestId, type NetworkTransport } from '../packages/core/src/network';
import {
  FULFILLMENT_READ_METHODS as methods,
  isFulfillmentReadMethod,
  type FulfillmentReadMethod
} from '../packages/core/src/order-fulfillment-methods';
import { OrderFulfillmentReadClient } from '../packages/core/src/order-fulfillment-read';
import { serializeAlibabaParameters } from '../packages/core/src/signing';
import type { GatewayClient, GatewayCredentials } from '../packages/core/src/types';
import { assertIgnoredFile, readIopBundle } from './smoke-product-reference-real';

export const FULFILLMENT_SMOKE_PATHS = Object.freeze([
  '/alibaba/icbu/product/list',
  '/alibaba/order/list',
  '/warehouse/list',
  '/alibaba/ggs/warehouse/list',
  '/shipping/freight/calculate',
  '/order/freight/calculate',
  '/order/logistics/tracking/get'
] as const);
type Row = Record<string, unknown>;
type Status =
  | 'passed'
  | 'valid-empty'
  | 'permission-denied'
  | 'missing-prerequisite'
  | 'platform-error'
  | 'contract-drift';
export interface FulfillmentSmokeObservation {
  method: string;
  requestId: string | null;
  status: Status;
  errorCode: string | null;
  count: number | null;
  shape: Record<string, string | number | null>;
}
const record = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function numericSourceId(value: unknown): string | number | null {
  if (typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function parseFulfillmentSmokeOptions(args: readonly string[]) {
  assert(
    args.length === 3 && args.filter((arg) => arg === '--confirm-readonly').length === 1,
    'READ_ONLY_ARGUMENTS_REQUIRED'
  );
  const values = new Map<string, string>();
  for (const arg of args) {
    if (arg === '--confirm-readonly') continue;
    const match = /^--(credential|receipt)=(.+)$/u.exec(arg);
    const key = match?.[1],
      value = match?.[2];
    assert(key && value, 'READ_ONLY_ARGUMENTS_INVALID');
    assert(
      value.trim() === value && !/\p{Cc}/u.test(value) && !values.has(key),
      'READ_ONLY_ARGUMENTS_INVALID'
    );
    values.set(key, value);
  }
  const credential = values.get('credential'),
    receipt = values.get('receipt');
  assert(credential && receipt, 'READ_ONLY_ARGUMENTS_REQUIRED');
  assert(resolve(credential).toLowerCase() !== resolve(receipt).toLowerCase(), 'NEW_RECEIPT_REQUIRED');
  return { credential, receipt };
}

/** Independent wire allowlist, exact armed payload, one attempt per arm and an absolute ten-request cap. */
export class FulfillmentSmokeGuard implements NetworkTransport {
  private active: {
    method: string;
    parameters: Record<string, string>;
    requestId: string;
    sent: boolean;
  } | null = null;
  private busy = false;
  private total = 0;
  source: unknown;
  status: number | null = null;
  get count(): number {
    return this.total;
  }
  private ready(): boolean {
    return this.active !== null && !this.active.sent && !this.busy && this.total < 10;
  }
  constructor(
    private readonly transport: NetworkTransport,
    private readonly wait: (milliseconds: number) => Promise<void> = async (milliseconds) => {
      await delay(milliseconds);
    }
  ) {}
  arm(method: string, parameters: Row, requestId: string): void {
    assert(
      !this.active &&
        !this.busy &&
        isRequestId(requestId) &&
        (FULFILLMENT_SMOKE_PATHS as readonly string[]).includes(method),
      'READ_ONLY_PLAN_DENIED'
    );
    this.source = undefined;
    this.status = null;
    this.active = { method, parameters: serializeAlibabaParameters(parameters), requestId, sent: false };
  }
  disarm(): void {
    this.active = null;
    this.source = undefined;
  }
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const active = this.active;
    assert(active && this.ready(), 'READ_ONLY_REQUEST_LIMIT');
    assert(
      url.href === IOP_BUSINESS_ENDPOINT + active.method &&
        !url.search &&
        !url.hash &&
        request.method === 'POST' &&
        request.headers.get('X-Request-ID') === active.requestId,
      'READ_ONLY_NETWORK_DENIED'
    );
    assert(
      request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'),
      'READ_ONLY_NETWORK_DENIED'
    );
    const body = new URLSearchParams(await request.clone().text());
    const transportKeys = ['app_key', 'access_token', 'timestamp', 'sign_method', 'simplify', 'sign'];
    assert(
      transportKeys.every((key) => body.has(key)) && body.get('sign_method') === 'sha256',
      'READ_ONLY_NETWORK_DENIED'
    );
    assert(new Set(body.keys()).size === Array.from(body.keys()).length, 'READ_ONLY_NETWORK_DENIED');
    const business = Object.fromEntries(Array.from(body).filter(([key]) => !transportKeys.includes(key)));
    assert.deepEqual(business, active.parameters, 'READ_ONLY_NETWORK_DENIED');
    assert(this.active === active && this.ready(), 'READ_ONLY_REQUEST_LIMIT');
    active.sent = true;
    this.busy = true;
    this.total++;
    try {
      await this.wait(350);
      // No redirect can escape the fixed URL or create an uncounted request.
      const response = await this.transport.send(request, { redirect: 'error' });
      this.status = response.status;
      {
        const reader = response.clone().body?.getReader();
        assert(reader, 'DISCOVERY_RESPONSE_INVALID');
        const decoder = new TextDecoder();
        let text = '',
          bytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            assert(bytes <= 1024 * 1024, 'DISCOVERY_RESPONSE_INVALID');
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
          try {
            this.source = JSON.parse(text) as unknown;
          } catch {
            throw new Error('DISCOVERY_RESPONSE_INVALID');
          }
        } finally {
          await reader.cancel();
        }
      }
      return response;
    } finally {
      this.busy = false;
    }
  }
}

export function classifyFulfillmentSmokeError(
  cause: unknown,
  secrets: readonly string[] = [],
  providerCode?: unknown
) {
  const error = normalizeGatewayError(cause);
  const parts = [error.code, error.subCode, providerCode].filter(
    (part): part is string => typeof part === 'string'
  );
  const classification = parts.join(':');
  let status: Status =
    /permission|denied|unauthoriz|authorization|required.scope|access.limit|api.package|chargeable|paid[._:-]?(?:api|app)|pay(?:ment)?[._:-]?required|billing|insufficient[._:-]?balance|need[._:-]?pay|subscription[._:-]?(?:required|expired)|(?:^|:)40[13](?:$|:)/iu.test(
      classification
    )
      ? 'permission-denied'
      : /response.invalid|contract|validator|schema|invalid.json/iu.test(classification)
        ? 'contract-drift'
        : 'platform-error';
  if (cause instanceof Error && cause.message === 'DISCOVERY_RESPONSE_INVALID') status = 'contract-drift';
  const codes = parts
    .map((part) => stableShapeCode(part, secrets))
    .filter((part): part is string => part !== null);
  return { status, errorCode: codes.join(':').slice(0, 200) || 'ERROR_REDACTED' };
}
function stableShapeCode(value: unknown, secrets: readonly string[]): string | null {
  const code = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof code === 'string' &&
    /^[A-Za-z0-9_.:-]{1,100}$/u.test(code) &&
    !/[0-9]{7,}|^[a-f0-9]{16,}$/iu.test(code) &&
    !secrets.some((secret) => secret && code.includes(secret))
    ? code
    : null;
}

/** Failure evidence only: no scalar values except Boolean success flags and bounded code/type atoms. */
export function fulfillmentFailureShape(
  source: unknown,
  secrets: readonly string[] = []
): Record<string, string> {
  const shape: Record<string, string> = {};
  const metadata = ['code', 'sub_code', 'msg_code', 'type', 'success', 'biz_success', 'is_success'];
  let paths = 0;
  const visit = (value: unknown, path: string, depth: number, field = ''): void => {
    if (paths >= 100) return;
    paths++;
    const array = Array.isArray(value);
    let kind = value === null ? 'null' : array ? 'array:' + String(value.length) : typeof value;
    if (['success', 'biz_success', 'is_success'].includes(field) && typeof value === 'boolean')
      kind += ':' + String(value);
    if (['code', 'sub_code', 'msg_code'].includes(field)) {
      const code = stableShapeCode(value, secrets);
      if (code !== null) kind += ':' + code;
    }
    if (field === 'type' && (value === 'ISP' || value === 'ISV')) kind += ':' + value;
    shape[path] = kind;
    if (depth >= 4 || paths >= 100) return;
    if (array) {
      for (let index = 0; index < value.length && paths < 100; index++)
        visit(value[index], path + '[' + String(index) + ']', depth + 1);
    } else if (record(value)) {
      // Envelope evidence must survive a large records array consuming the path budget.
      const keys = [
        ...metadata.filter((key) => Object.hasOwn(value, key)),
        ...Object.keys(value).filter((key) => !metadata.includes(key))
      ];
      for (const key of keys) {
        if (paths >= 100) break;
        if (
          !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key) ||
          /[0-9]{7,}|^[a-f0-9]{16,}$/iu.test(key) ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          secrets.some((secret) => secret && key.includes(secret))
        )
          continue;
        visit(value[key], path + '.' + key, depth + 1, key);
      }
    }
  };
  visit(source, '$', 0);
  return shape;
}
function discoveryRows(source: unknown, product: boolean): Row[] {
  assert(record(source) && (source.code === '0' || source.code === 0), 'DISCOVERY_RESPONSE_INVALID');
  const value = product ? source.result : source.value;
  assert(record(value), 'DISCOVERY_RESPONSE_INVALID');
  assert(
    source.success !== false &&
      value.success !== false &&
      source.biz_success !== false &&
      value.biz_success !== false,
    'DISCOVERY_BUSINESS_REJECTED'
  );
  const items = value[product ? 'products' : 'order_list'];
  const total = value[product ? 'total_item' : 'total_count'];
  assert(Array.isArray(items) && items.length <= 1 && items.every(record), 'DISCOVERY_RESPONSE_INVALID');
  assert(
    (typeof total === 'number' && Number.isSafeInteger(total) && total >= 0) ||
      (typeof total === 'string' && /^(0|[1-9][0-9]*)$/u.test(total)),
    'DISCOVERY_RESPONSE_INVALID'
  );
  assert(items.length > 0 || total === 0 || total === '0', 'DISCOVERY_RESPONSE_INVALID');
  return items;
}
function fulfillmentCount(method: FulfillmentReadMethod, data: Row): number {
  const list =
    method === methods.warehouses && record(data.response)
      ? data.response.records
      : method === methods.ggsWarehouses && record(data.result)
        ? data.result.data
        : method === methods.tracking
          ? data.tracking_list
          : data.value;
  assert(Array.isArray(list), 'FULFILLMENT_READ_RESPONSE_INVALID');
  return list.length;
}
export function fulfillmentSmokeReceipt(observations: FulfillmentSmokeObservation[], requests: number) {
  const count = (status: Status) => observations.filter((row) => row.status === status).length;
  return {
    observations,
    counts: {
      requests,
      passed: count('passed'),
      'valid-empty': count('valid-empty'),
      'permission-denied': count('permission-denied'),
      'missing-prerequisite': count('missing-prerequisite'),
      'platform-error': count('platform-error'),
      'contract-drift': count('contract-drift')
    }
  };
}

/** Real and offline tests share the fixed gateway -> client -> guarded transport execution. */
export async function runOrderFulfillmentSmoke(
  credentials: GatewayCredentials,
  guard: FulfillmentSmokeGuard,
  persist: (receipt: ReturnType<typeof fulfillmentSmokeReceipt>) => Promise<void> = () => Promise.resolve()
) {
  assert(
    credentials.protocol === 'iop' && credentials.endpoint === IOP_BUSINESS_ENDPOINT,
    'EXPLICIT_IOP_REQUIRED'
  );
  const native = new AlibabaReadGatewayClient(credentials, { transport: guard, maxAttempts: 1 });
  const context = {
    identity: await opaqueGalleryId('fulfillment-read:' + credentials.appKey),
    gateway: await galleryGatewayId(credentials),
    storage: null
  };
  let requestId = '';
  const gateway: GatewayClient = {
    galleryTransferContext(operation, payload) {
      assert(
        operation === 'callCapability' && payload && isFulfillmentReadMethod(payload.method),
        'READ_ONLY_PLAN_DENIED'
      );
      return Promise.resolve({ ...context });
    },
    request: (operation, payload, options) => native.request(operation, payload, { ...options, requestId })
  };
  const client = new OrderFulfillmentReadClient(gateway, () => context.identity);
  const observations: FulfillmentSmokeObservation[] = [];
  const secrets = [credentials.appKey, credentials.appSecret, credentials.accessToken];
  const save = () => persist(fulfillmentSmokeReceipt(observations, guard.count));
  const observe = async <T>(
    method: string,
    parameters: Row,
    action: () => Promise<T>,
    summary: (result: T) => { count: number; shape: FulfillmentSmokeObservation['shape'] }
  ): Promise<T | undefined> => {
    requestId = randomUUID();
    const observation: FulfillmentSmokeObservation = {
      method,
      requestId,
      status: 'platform-error',
      errorCode: 'READ_NOT_COMPLETED',
      count: null,
      shape: {}
    };
    observations.push(observation);
    guard.arm(method, parameters, requestId);
    try {
      await save();
      const result = await action();
      const shape = summary(result);
      observation.count = shape.count;
      observation.shape = { ...shape.shape, httpStatus: guard.status };
      observation.status = shape.count ? 'passed' : 'valid-empty';
      observation.errorCode = null;
      return result;
    } catch (cause) {
      const raw = record(guard.source) ? guard.source : {};
      const business = record(raw.result) ? raw.result : raw;
      const rejected =
        raw.success === false ||
        raw.biz_success === false ||
        business.success === false ||
        business.biz_success === false;
      const providerCodes = [
        raw.code,
        raw.sub_code,
        raw.msg_code,
        business.code,
        business.sub_code,
        business.msg_code
      ]
        .map((value) => stableShapeCode(value, secrets))
        .filter((value): value is string => value !== null);
      Object.assign(
        observation,
        classifyFulfillmentSmokeError(
          cause,
          secrets,
          Array.from(new Set(providerCodes)).join(':') || undefined
        )
      );
      if (guard.status === 401 || guard.status === 403) observation.status = 'permission-denied';
      else if (rejected && observation.status !== 'permission-denied') observation.status = 'platform-error';
      observation.shape = { httpStatus: guard.status, ...fulfillmentFailureShape(guard.source, secrets) };
      return undefined;
    } finally {
      guard.disarm();
      await save();
    }
  };
  const missing = async (method: string, errorCode: string) => {
    observations.push({
      method,
      requestId: null,
      status: 'missing-prerequisite',
      errorCode,
      count: null,
      shape: {}
    });
    await save();
  };
  const product: { id: string | number | null } = { id: null };
  const orders: (string | number | null)[] = [];
  try {
    await observe(
      FULFILLMENT_SMOKE_PATHS[0],
      { language: 'ENGLISH', current_page: 1, page_size: 1 },
      () => gateway.request('listProducts', { page: 1, pageSize: 1 }),
      (page) => {
        const rows = discoveryRows(guard.source, true);
        assert(page.items.length === rows.length, 'DISCOVERY_RESPONSE_INVALID');
        product.id = numericSourceId(rows[0]?.id);
        if (product.id !== null) secrets.push(String(product.id));
        return {
          count: rows.length,
          shape: { root: 'object', products: 'array', firstId: typeof rows[0]?.id }
        };
      }
    );
    for (const role of ['seller', 'buyer'] as const) {
      let tradeId: string | number | null = null;
      await observe(
        FULFILLMENT_SMOKE_PATHS[1],
        { role, start_page: 0, page_size: 1 },
        () => gateway.request('listTradeOrders', { role, page: 1, pageSize: 1 }),
        (page) => {
          const rows = discoveryRows(guard.source, false);
          assert(
            page.items.length === rows.length && page.items.every((row) => row.role === role),
            'DISCOVERY_RESPONSE_INVALID'
          );
          // Only this raw trade_id is eligible. No normalized/obfuscated ID, decoding or lookup.
          tradeId = numericSourceId(rows[0]?.trade_id);
          if (tradeId !== null) secrets.push(String(tradeId));
          return {
            count: rows.length,
            shape: { root: 'object', orders: 'array', firstId: typeof rows[0]?.trade_id }
          };
        }
      );
      orders.push(tradeId);
    }
    for (const method of [methods.warehouses, methods.ggsWarehouses, methods.basicFreight] as const) {
      if (product.id === null) {
        await missing(method, 'NO_NUMERIC_SOURCE_PRODUCT');
        continue;
      }
      const parameters: Row =
        method === methods.ggsWarehouses
          ? { product_id: product.id, page_size: 1, current_page: 1 }
          : method === methods.basicFreight
            ? { product_id: product.id, quantity: 1, destination_country: 'US' }
            : { product_id: product.id, current_page: 1 };
      await observe(
        method,
        parameters,
        () => client.query(method, parameters),
        (result) => ({
          count: fulfillmentCount(method, result.data),
          shape: {
            root: 'object',
            payload: method === methods.warehouses || method === methods.ggsWarehouses ? 'object' : 'array'
          }
        })
      );
    }
    for (const tradeId of orders) {
      if (tradeId === null) {
        await missing(methods.tracking, 'NO_NUMERIC_SOURCE_TRADE_ID');
        continue;
      }
      const parameters = { trade_id: tradeId };
      await observe(
        methods.tracking,
        parameters,
        () => client.query(methods.tracking, parameters),
        (result) => ({
          count: fulfillmentCount(methods.tracking, result.data),
          shape: { root: 'object', tracking_list: 'array' }
        })
      );
    }
    await missing(methods.advancedFreight, 'VALID_COMPANY_ID_AND_SKU_CONTEXT_REQUIRED');
    return fulfillmentSmokeReceipt(observations, guard.count);
  } finally {
    client.dispose();
  }
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseFulfillmentSmokeOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const credentialPath = resolve(root, options.credential),
    receiptPath = resolve(root, options.receipt);
  const credentialRoot = [root, resolve(root, '..', 'oneVegetable')].find((candidate) =>
    credentialPath.toLowerCase().startsWith((candidate + sep).toLowerCase())
  );
  assert(
    credentialRoot && receiptPath.toLowerCase().startsWith((resolve(root, 'artifacts') + sep).toLowerCase()),
    'IGNORED_PATHS_REQUIRED'
  );
  await assertIgnoredFile(credentialRoot, credentialPath);
  await assertIgnoredFile(root, receiptPath);
  const stat = await lstat(credentialPath);
  assert(stat.isFile() && stat.size <= 2 * 1024 * 1024, 'IOP_CREDENTIAL_INVALID');
  // Shared parser calls parseAlibabaOpenApiCredentialBundle and requires explicit, unexpired IOP.
  const bundle = readIopBundle(JSON.parse(await readFile(credentialPath, 'utf8')) as unknown);
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    endpoint: IOP_BUSINESS_ENDPOINT,
    signMethod: 'hmac-sha256',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await assertIgnoredFile(root, receiptPath);
  const output = await open(receiptPath, 'wx', 0o600);
  try {
    const persist = async (receipt: ReturnType<typeof fulfillmentSmokeReceipt>) => {
      const text = JSON.stringify(receipt, null, 2) + '\n';
      await output.truncate(0);
      await output.write(text, 0, 'utf8');
      await output.sync();
    };
    const receipt = await runOrderFulfillmentSmoke(
      credentials,
      new FulfillmentSmokeGuard(new NativeFetchTransport()),
      persist
    );
    process.stdout.write(JSON.stringify(receipt) + '\n');
    process.exitCode =
      receipt.counts['permission-denied'] ||
      receipt.counts['platform-error'] ||
      receipt.counts['contract-drift']
        ? 1
        : receipt.counts['missing-prerequisite']
          ? 2
          : 0;
  } finally {
    await output.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help')
    process.stdout.write(
      'IOP-only: --confirm-readonly --credential=<ignored remote JSON> --receipt=artifacts/<new>.json; no refresh, TOP or upload.\n'
    );
  else {
    try {
      await main(process.argv.slice(2));
    } catch {
      process.stderr.write('ORDER_FULFILLMENT_READ_PREFLIGHT_FAILED\n');
      process.exitCode = 1;
    }
  }
}
