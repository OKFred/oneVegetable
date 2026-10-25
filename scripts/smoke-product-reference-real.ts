/**
 * Isolated, authenticated, in-process Node BFF acceptance (not MV3/browser acceptance).
 * TOP: not applicable; these five native IOP reference APIs never fall back or renew tokens.
 * pnpm exec tsx scripts/smoke-product-reference-real.ts --confirm-readonly
 *   --credential=<ignored IOP bundle> --product-id=<known own product> --output=<new ignored receipt>
 * Never invoke this file merely to run its offline tests. No provider calls occur on import.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_API_ORIGIN, IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { NativeFetchTransport, isRequestId } from '../packages/core/src/network';
import { selectAlibabaOperationProtocol } from '../packages/core/src/alibaba-protocol-routing';
import type { AsyncAlibabaCredentialProvider } from '../apps/api/src/gateway/credentials';
import type { NetworkTransport } from '../packages/core/src/network';
import type { CapabilityCallResult, GatewayClient, GatewayCredentials } from '../packages/core/src/types';

// Independent, immutable acceptance allowlist, deliberately not the growing capability registry.
export const REFERENCE_METHODS = Object.freeze({
  getProduct: '/alibaba/icbu/product/get/v2',
  listCategories: '/alibaba/icbu/category/get/v2',
  predictCategory: '/alibaba/icbu/category/predict/v2',
  getAttributes: '/alibaba/icbu/category/attribute/get/v2',
  listShippingTemplates: '/alibaba/icbu/product/list/shipping/templates'
} as const);
export type ReferenceOperation = keyof typeof REFERENCE_METHODS;
export interface AcceptanceOptions {
  credential: string;
  productId: string;
  output: string;
  predictionTitle?: string;
}
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown): string | null => {
  if (typeof value === 'string' && /^[1-9][0-9]{0,63}$/u.test(value)) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
};

export function parseOptions(args: readonly string[]): AcceptanceOptions {
  const prefixes = ['--credential=', '--product-id=', '--output='] as const;
  if (
    (args.length !== 4 && args.length !== 5) ||
    args.filter((arg) => arg === '--confirm-readonly').length !== 1 ||
    prefixes.some((prefix) => args.filter((arg) => arg.startsWith(prefix)).length !== 1) ||
    args.filter((arg) => arg.startsWith('--prediction-title=')).length > 1 ||
    args.some(
      (arg) =>
        arg !== '--confirm-readonly' &&
        !arg.startsWith('--prediction-title=') &&
        !prefixes.some((prefix) => arg.startsWith(prefix))
    )
  )
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? '';
  const credential = value('--credential='),
    output = value('--output='),
    productId = value('--product-id=');
  if (!credential.trim() || credential.trim() !== credential || !output.trim() || output.trim() !== output)
    throw new Error('IGNORED_PATHS_REQUIRED');
  if (!positiveId(productId)) throw new Error('PRODUCT_ID_INVALID');
  if (resolve(credential).toLowerCase() === resolve(output).toLowerCase())
    throw new Error('NEW_RECEIPT_REQUIRED');
  const predictionTitle = args
    .find((arg) => arg.startsWith('--prediction-title='))
    ?.slice('--prediction-title='.length);
  if (predictionTitle !== undefined) validatePredictionTitle(predictionTitle);
  return { credential, productId, output, ...(predictionTitle !== undefined ? { predictionTitle } : {}) };
}

/** An explicit human descriptor is validated, never silently trimmed, rewritten or persisted. */
export function validatePredictionTitle(value: string): void {
  if (
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    !/\p{L}/u.test(value) ||
    !/^[\p{L}\p{N} ,.'()/+&-]+$/u.test(value) ||
    /https?:|www\.|@/iu.test(value)
  )
    throw new Error('PREDICTION_TITLE_INVALID');
}

export function readIopBundle(input: unknown) {
  const candidate = record(input) && 'authorization' in input ? input.authorization : input;
  if (!record(candidate) || candidate.protocol !== 'iop') throw new Error('EXPLICIT_IOP_BUNDLE_REQUIRED');
  try {
    const bundle = parseAlibabaOpenApiCredentialBundle(candidate);
    if (bundle.oauth.expiresAtUtc === null || Date.parse(bundle.oauth.expiresAtUtc) <= Date.now() + 600_000)
      throw new Error('REAUTHORIZE_BEFORE_ACCEPTANCE');
    return bundle;
  } catch {
    throw new Error('VALID_UNEXPIRED_IOP_BUNDLE_REQUIRED');
  }
}

export function sanitizeOwnTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/giu, ' ')
    .replace(/\S+@\S+/gu, ' ')
    .replace(/\b[0-9]{7,}\b/gu, ' ')
    .replace(/[^\p{L}\p{N} ,./()+&-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160)
    .trim();
  return /\p{L}/u.test(title) ? title : null;
}

export interface ReferenceGuardSnapshot {
  sent: number;
  total: number;
  activeSent: number;
  blocked: number;
}
export interface ReferencePlanGuard {
  arm(operation: ReferenceOperation, requestId: string): void | Promise<void>;
  disarm(): void | Promise<void>;
  snapshot(): ReferenceGuardSnapshot | Promise<ReferenceGuardSnapshot>;
}
export class ReferenceReadGuard implements NetworkTransport, ReferencePlanGuard {
  #active: { operation: ReferenceOperation; requestId: string; attempts: number; sent: number } | null = null;
  #used = new Set<ReferenceOperation>();
  #busy = false;
  #lastStarted: number | null = null;
  #total = 0;
  #blocked = 0;
  constructor(
    private readonly transport: NetworkTransport,
    private readonly clock: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = async (ms) => {
      await delay(ms);
    }
  ) {}
  arm(operation: ReferenceOperation, requestId: string): void {
    if (
      this.#active ||
      this.#busy ||
      this.#used.has(operation) ||
      !Object.hasOwn(REFERENCE_METHODS, operation) ||
      !isRequestId(requestId)
    )
      throw new Error('READ_GUARD_ARM_DENIED');
    this.#active = { operation, requestId, attempts: 0, sent: 0 };
    this.#used.add(operation);
  }
  disarm(): void {
    this.#active = null;
  }
  snapshot() {
    // Cumulative sent survives disarm; activeSent is only this method's on-wire attempt count.
    return {
      sent: this.#total,
      total: this.#total,
      activeSent: this.#active?.sent ?? 0,
      blocked: this.#blocked
    };
  }
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const deny = (): never => {
      this.#blocked++;
      throw new Error('READ_ONLY_NETWORK_DENIED');
    };
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      return deny();
    }
    const url = new URL(request.url),
      current = this.#active;
    if (
      !current ||
      this.#busy ||
      current.attempts !== 0 ||
      this.#total >= 10 ||
      url.origin !== IOP_API_ORIGIN ||
      url.pathname !== '/rest' + REFERENCE_METHODS[current.operation] ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      request.method !== 'POST' ||
      request.headers.get('X-Request-ID') !== current.requestId
    )
      return deny();
    // Reserve before awaiting: parallel requests and transport retries cannot pass.
    current.attempts++;
    this.#busy = true;
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
      const wait = this.#lastStarted === null ? 0 : Math.max(0, 350 - (this.clock() - this.#lastStarted));
      if (wait) await this.wait(wait);
      if (this.#active !== current) return deny();
      this.#lastStarted = this.clock();
      this.#total++;
      current.sent++;
      return await this.transport.send(request.url, { ...init, redirect: 'error' });
    } finally {
      this.#busy = false;
    }
  }
}

/** Peel only documented response containers, not arbitrary nested account data. */
function payload(value: unknown): unknown {
  let next = value;
  for (let depth = 0; depth < 6 && record(next); depth++) {
    const child: unknown = next.data ?? next.result ?? next.value ?? next.product;
    if (child === undefined || child === null) break;
    next = child;
  }
  return next;
}
export function referenceRows(value: unknown): Row[] | null {
  const data = payload(value);
  if (Array.isArray(data)) return data.every(record) ? data : null;
  if (!record(data)) return null;
  if (positiveId(data.categoryId) && Object.hasOwn(data, 'categoryName')) return [data];
  if (Array.isArray(data.attributes) && Array.isArray(data.saleAttributes))
    return data.attributes.every(record) && data.saleAttributes.every(record)
      ? [...data.attributes, ...data.saleAttributes]
      : null;
  for (const key of [
    'items',
    'categories',
    'category_list',
    'attributes',
    'attribute_list',
    'templates',
    'shipping_templates',
    'shipping_template_list'
  ]) {
    const rows: unknown = data[key];
    if (Array.isArray(rows)) return rows.every(record) ? rows : null;
  }
  return null; // Absent is unknown, never an invented empty list.
}
export function productIdentity(value: unknown): {
  id: string | null;
  categoryId: string | null;
  title: string | null;
} {
  const data = payload(value);
  if (!record(data)) return { id: null, categoryId: null, title: null };
  return {
    id: positiveId(data.productId ?? data.product_id ?? data.id),
    categoryId: positiveId(data.categoryId ?? data.category_id ?? data.leaf_category_id),
    title: sanitizeOwnTitle(data.title ?? data.subject ?? data.product_title)
  };
}
export function businessAccepted(value: unknown): boolean {
  let next = value,
    explicit = false;
  for (let depth = 0; depth < 6 && record(next); depth++) {
    if (
      [next.success, next.biz_success, next.is_success].some((flag) => flag === false || flag === 'false') ||
      (next.code !== undefined && next.code !== 0 && next.code !== '0') ||
      (next.error_code !== undefined &&
        next.error_code !== null &&
        next.error_code !== '' &&
        next.error_code !== '0' &&
        next.error_code !== 0)
    )
      return false;
    explicit ||=
      next.code === 0 ||
      next.code === '0' ||
      next.success === true ||
      next.biz_success === true ||
      next.is_success === true;
    const child: unknown = next.data ?? next.result ?? next.value;
    if (child === undefined || child === null) break;
    next = child;
  }
  return explicit;
}
const SAFE_ERRORS = new Set([
  'ALIBABA_IOP_API_REJECTED',
  'ALIBABA_IOP_BUSINESS_REJECTED',
  'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
  'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
  'ALIBABA_IOP_RESPONSE_INVALID',
  'ALIBABA_IOP_METHOD_UNSUPPORTED',
  'REQUEST_CONTRACT_INVALID',
  'RESPONSE_CONTRACT_INVALID',
  'CAPABILITY_RESTRICTED',
  'NETWORK_ERROR',
  'NETWORK_HTTP_ERROR',
  'NETWORK_REDIRECT_DENIED',
  'NETWORK_URL_DENIED',
  'REQUEST_TIMEOUT',
  'INVALID_JSON_RESPONSE',
  'READ_ONLY_NETWORK_DENIED',
  'READ_CORRELATION_NOT_CONFIRMED',
  'READ_RESULT_NOT_CONFIRMED'
]);
export function safeErrorCode(error: unknown): string {
  const gateway = record(error) && record(error.gatewayError) ? error.gatewayError : error;
  const code = record(gateway) ? gateway.code : null;
  if (typeof code === 'string' && SAFE_ERRORS.has(code)) return code;
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return 'ERROR_REDACTED';
}
export function safeTraceId(value: unknown, secrets: readonly string[] = []): string | null {
  return typeof value === 'string' &&
    /^[a-f0-9-]{8,128}$/iu.test(value) &&
    !secrets.some((secret) => secret && value.includes(secret))
    ? value
    : null;
}
export interface ReferenceReader {
  getProduct(productId: string): Promise<unknown>;
  listCategories(parentId?: string): Promise<unknown>;
  predictCategory(input: { title: string }): Promise<unknown>;
  getAttributes(categoryId: string): Promise<unknown>;
  listShippingTemplates(): Promise<unknown>;
}
export interface ReadObservation {
  operation: ReferenceOperation;
  method: string;
  protocol: 'iop';
  requestId: string | null;
  traceId: string | null;
  contractValid: boolean | null;
  accepted: boolean;
  status: 'accepted' | 'failed' | 'skipped-prerequisite';
  rowCount: number | null;
  networkRequests: number;
  errorCode: string | null;
}
export interface EqualityChecks {
  productIdExact: boolean | null;
  attributeCategoryFromDetail: boolean | null;
  predictionCategoryMatchesDetail: boolean | null;
}
export async function runReadPlan(
  reader: ReferenceReader,
  productId: string,
  observe: (
    operation: ReferenceOperation,
    read: () => Promise<unknown>
  ) => Promise<{ value: unknown; accepted: boolean }>,
  skip: (operation: ReferenceOperation) => void,
  predictionTitle?: string
): Promise<EqualityChecks> {
  if (!positiveId(productId)) throw new Error('PRODUCT_ID_INVALID');
  if (predictionTitle !== undefined) validatePredictionTitle(predictionTitle);
  const checks: EqualityChecks = {
    productIdExact: null,
    attributeCategoryFromDetail: null,
    predictionCategoryMatchesDetail: null
  };
  const detail = await observe('getProduct', () => reader.getProduct(productId));
  const identity = productIdentity(detail.value);
  if (detail.accepted && identity.id !== null) checks.productIdExact = identity.id === productId;
  await observe('listCategories', () => reader.listCategories());
  // A wrong/missing product must never unlock dependent reads, even if the HTTP call succeeded.
  if (checks.productIdExact === true && identity.categoryId) {
    const categoryId = identity.categoryId;
    const attributes = await observe('getAttributes', () => reader.getAttributes(categoryId));
    const actualCategory = record(attributes.value) ? positiveId(attributes.value.categoryId) : null;
    checks.attributeCategoryFromDetail =
      attributes.accepted && actualCategory ? actualCategory === categoryId : null;
  } else skip('getAttributes');
  if (checks.productIdExact === true && (predictionTitle ?? identity.title)) {
    const title = predictionTitle ?? identity.title;
    if (title === null) throw new Error('PREDICTION_TITLE_INVALID');
    const prediction = await observe('predictCategory', () => reader.predictCategory({ title }));
    const rows = referenceRows(prediction.value);
    if (prediction.accepted && identity.categoryId && rows !== null)
      checks.predictionCategoryMatchesDetail = rows.some(
        (row) => positiveId(row.categoryId ?? row.category_id ?? row.id) === identity.categoryId
      );
  } else skip('predictCategory');
  await observe('listShippingTemplates', () => reader.listShippingTemplates());
  return checks;
}

export function summarizeReceipt(observations: readonly ReadObservation[], checks: EqualityChecks) {
  const acceptedMethods = observations.filter((entry) => entry.accepted).length;
  const rowsKnown = observations.every((entry) => entry.accepted && entry.rowCount !== null);
  const equalities = Object.values(checks);
  return {
    accepted: observations.length === 5 && acceptedMethods === 5,
    dataConsistent:
      rowsKnown && checks.productIdExact === true && checks.attributeCategoryFromDetail === true,
    // Prediction is assistance, not ground truth; a different suggestion is not provider rejection.
    equalityChecks: checks,
    testSummary: {
      methods: observations.length,
      acceptedMethods,
      failedMethods: observations.filter((entry) => entry.status === 'failed').length,
      skippedMethods: observations.filter((entry) => entry.status === 'skipped-prerequisite').length,
      unknownRowCounts: observations.filter((entry) => entry.rowCount === null).length,
      equalitiesPassed: equalities.filter((entry) => entry === true).length,
      equalitiesFailed: equalities.filter((entry) => entry === false).length,
      equalitiesUnknown: equalities.filter((entry) => entry === null).length
    }
  };
}

export async function assertIgnoredFile(root: string, path: string): Promise<void> {
  const name = relative(root, path);
  if (!name || name.startsWith('..') || resolve(root, name) !== path)
    throw new Error('IGNORED_PATHS_REQUIRED');
  // Reject tracked ignored files too. Do not print Git output or file paths on failure.
  try {
    if (
      execFileSync('git', ['ls-files', '--', name], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    )
      throw new Error('TRACKED_FILE_DENIED');
    execFileSync('git', ['check-ignore', '--quiet', '--', name], { cwd: root, stdio: 'ignore' });
  } catch {
    throw new Error('IGNORED_PATHS_REQUIRED');
  }
  let cursor = root;
  for (const part of name.split(sep)) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('SYMLINK_DENIED');
    } catch (error: unknown) {
      if (!record(error) || error.code !== 'ENOENT')
        throw new Error('IGNORED_PATHS_REQUIRED', { cause: error });
    }
  }
}

/** Uses real authentication/ABAC/operation routes without a socket or active on-disk database. */
export async function createNodeBffSession(credentials: GatewayCredentials, transport: NetworkTransport) {
  const [
    { CredentialBackedAlibabaGatewayClient },
    { createApiApp },
    { BffGatewayClient },
    { applyNodeMigrations, openNodeDatabase },
    { SqlAuthRepository },
    { AuthService },
    { AdminService }
  ] = await Promise.all([
    import('../apps/api/src/gateway/alibaba-read-gateway'),
    import('../apps/api/src/app'),
    import('../packages/core/src/bff-client'),
    import('../apps/api/src/db/node-database'),
    import('../apps/api/src/auth/repository'),
    import('../apps/api/src/auth/service'),
    import('../apps/api/src/auth/admin-service')
  ]);
  const database = openNodeDatabase(':memory:');
  try {
    applyNodeMigrations(database);
    const repository = new SqlAuthRepository(database.executor),
      bootstrapToken = randomBytes(32).toString('hex');
    const authService = new AuthService({ repository, bootstrapToken });
    const session = await authService.bootstrap({
      requestId: randomUUID(),
      bootstrapToken,
      username: 'reference-acceptance',
      password: randomBytes(32).toString('base64url')
    });
    const snapshot = Object.freeze({ ...credentials });
    const protocol = snapshot.protocol ?? 'top';
    const provider: AsyncAlibabaCredentialProvider = {
      status: () =>
        Promise.resolve({
          source: 'credential-bundle',
          configured: true,
          hasAppKey: true,
          hasAppSecret: true,
          hasAccessToken: true,
          endpointOrigin: new URL(snapshot.endpoint).origin,
          protocol,
          signMethod: snapshot.signMethod
        }),
      credentialSnapshot: () => Promise.resolve(snapshot),
      requireCredentials: (_requestId, forceRefresh) => {
        if (forceRefresh) throw new Error('READ_ONLY_NETWORK_DENIED');
        return Promise.resolve(snapshot);
      },
      selectProtocol: (operation, input) =>
        Promise.resolve(
          selectAlibabaOperationProtocol(operation, input, {
            top: protocol === 'top',
            iop: protocol === 'iop',
            defaultProtocol: protocol,
            bindingConfirmed: false
          })
        ),
      resolveForOperation: (operation, input) => {
        selectAlibabaOperationProtocol(operation, input, {
          top: protocol === 'top',
          iop: protocol === 'iop',
          defaultProtocol: protocol,
          bindingConfirmed: false
        });
        return Promise.resolve(snapshot);
      }
    };
    // The production wrapper selects first, then constructs AlibabaReadGatewayClient.
    // This provider has no vault, renewal implementation, environment lookup or alternate profile.
    const gateway = new CredentialBackedAlibabaGatewayClient(provider, { transport, maxAttempts: 1 });
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'isolated-product-reference',
      gatewayMode: 'real',
      gateway,
      authService,
      adminService: new AdminService(repository),
      allowedOrigins: ['http://localhost']
    });
    const client = new BffGatewayClient({
      baseUrl: 'http://localhost',
      transport: {
        async send(input, init) {
          const request = new Request(input, init),
            url = new URL(request.url);
          if (
            url.origin !== 'http://localhost' ||
            url.pathname !== '/api/v1/operations/call' ||
            url.search ||
            request.method !== 'POST'
          )
            throw new Error('READ_ONLY_NETWORK_DENIED');
          request.headers.set('Cookie', `ov_session=${session.sessionToken}`);
          request.headers.set('Origin', 'http://localhost');
          return app.fetch(request);
        }
      }
    });
    return {
      client,
      close: () => {
        database.connection.close();
      }
    };
  } catch (error: unknown) {
    database.connection.close();
    throw error;
  }
}

/** Same orchestration used by the real command and offline BFF integration tests. */
export async function runGatewayAcceptance(
  bff: GatewayClient,
  guard: ReferencePlanGuard,
  productId: string,
  observations: ReadObservation[] = [],
  secrets: readonly string[] = [],
  persist: () => Promise<void> = () => Promise.resolve(),
  predictionTitle?: string
): Promise<EqualityChecks> {
  const { ProductReferenceClient } = await import('../packages/core/src/product-reference');
  let active: {
    operation: ReferenceOperation;
    requestId: string;
    envelope: CapabilityCallResult | null;
    calls: number;
  } | null = null;
  const gateway: GatewayClient = {
    async request(operation, request, options) {
      if (
        !active ||
        operation !== 'callCapability' ||
        !record(request) ||
        Reflect.get(request, 'method') !== REFERENCE_METHODS[active.operation] ||
        ++active.calls !== 1
      )
        throw new Error('READ_ONLY_NETWORK_DENIED');
      const response = await bff.request(operation, request, { ...options, requestId: active.requestId });
      active.envelope = response as unknown as CapabilityCallResult;
      return response;
    }
  };
  const reader: ReferenceReader = new ProductReferenceClient(gateway);
  return runReadPlan(
    reader,
    productId,
    async (operation, read) => {
      const requestId = randomUUID();
      const entry: ReadObservation = {
        operation,
        method: REFERENCE_METHODS[operation],
        protocol: 'iop',
        requestId,
        traceId: null,
        contractValid: null,
        accepted: false,
        status: 'failed',
        rowCount: null,
        networkRequests: 0,
        errorCode: null
      };
      observations.push(entry);
      const call = { operation, requestId, envelope: null as CapabilityCallResult | null, calls: 0 };
      active = call;
      await guard.arm(operation, requestId);
      const before = (await guard.snapshot()).total;
      let value: unknown = null;
      try {
        await persist();
        value = await read();
        const envelope = call.envelope;
        if (
          envelope?.method !== entry.method ||
          call.calls !== 1 ||
          (await guard.snapshot()).activeSent !== 1
        )
          throw new Error('READ_CORRELATION_NOT_CONFIRMED');
        entry.contractValid = envelope.contractValid;
        entry.traceId = safeTraceId(envelope.traceId, secrets);
        entry.accepted = envelope.contractValid && businessAccepted(envelope.data);
        entry.status = entry.accepted ? 'accepted' : 'failed';
        if (entry.accepted) {
          entry.rowCount =
            operation === 'getProduct'
              ? productIdentity(value).id === null
                ? null
                : 1
              : (referenceRows(value)?.length ?? null);
          if (operation === 'getAttributes') {
            // Core intentionally tolerates absent optional arrays. Do not turn that into a proven zero.
            const raw = payload(envelope.data);
            entry.rowCount =
              record(raw) && Array.isArray(raw.category_attributes) && Array.isArray(raw.sale_attributes)
                ? raw.category_attributes.length + raw.sale_attributes.length
                : null;
          }
        } else entry.errorCode = 'READ_RESULT_NOT_CONFIRMED';
      } catch (error: unknown) {
        entry.errorCode = safeErrorCode(error);
        const detail = record(error) && record(error.gatewayError) ? error.gatewayError : null;
        entry.traceId = safeTraceId(detail?.traceId, secrets);
      } finally {
        entry.networkRequests = (await guard.snapshot()).total - before;
        await guard.disarm();
        active = null;
        if (call.envelope) {
          entry.traceId = safeTraceId(call.envelope.traceId, secrets);
          entry.contractValid = call.envelope.contractValid;
        }
        await persist();
      }
      if ((await guard.snapshot()).blocked > 0) throw new Error('READ_ONLY_NETWORK_DENIED');
      return { value, accepted: entry.accepted };
    },
    (operation) => {
      observations.push({
        operation,
        method: REFERENCE_METHODS[operation],
        protocol: 'iop',
        requestId: null,
        traceId: null,
        contractValid: null,
        accepted: false,
        status: 'skipped-prerequisite',
        rowCount: null,
        networkRequests: 0,
        errorCode: 'PRODUCT_PREREQUISITE_NOT_CONFIRMED'
      });
    },
    predictionTitle
  );
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
  const credentialStat = await lstat(credentialPath);
  if (!credentialStat.isFile() || credentialStat.size > 256 * 1024) throw new Error('IOP_BUNDLE_INVALID');
  const bundle = readIopBundle(JSON.parse(await readFile(credentialPath, 'utf8')) as unknown);
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: IOP_BUSINESS_ENDPOINT,
    signMethod: 'hmac-sha256'
  };
  const secrets = [credentials.appKey, credentials.appSecret, credentials.accessToken];
  await mkdir(dirname(outputPath), { recursive: true });
  await assertIgnoredFile(root, outputPath);
  const output = await open(outputPath, 'wx', 0o600); // Exclusive claim, never overwrite or replay.
  const observations: ReadObservation[] = [];
  const guard = new ReferenceReadGuard(new NativeFetchTransport());
  let checks: EqualityChecks = {
    productIdExact: null,
    attributeCategoryFromDetail: null,
    predictionCategoryMatchesDetail: null
  };
  let failure: string | null = null;
  let session: Awaited<ReturnType<typeof createNodeBffSession>> | undefined;
  const report = () => ({
    schemaVersion: 2,
    runtime: 'node-bff-in-process',
    protocol: 'iop',
    predictionTitleSource:
      options.predictionTitle === undefined ? 'own-sanitized-title' : 'explicit-descriptor',
    capturedAtUtc: new Date().toISOString(),
    maxRequests: 10,
    minimumIntervalMs: 350,
    maxAttempts: 1,
    ...summarizeReceipt(observations, checks),
    observations,
    network: guard.snapshot(),
    failure,
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
    session = await createNodeBffSession(credentials, guard);
    checks = await runGatewayAcceptance(
      session.client,
      guard,
      options.productId,
      observations,
      secrets,
      persist,
      options.predictionTitle
    );
  } catch (error: unknown) {
    failure = safeErrorCode(error);
  } finally {
    session?.close();
    try {
      await persist();
    } finally {
      await output.close();
    }
  }
  const summary = summarizeReceipt(observations, checks);
  process.stdout.write(
    JSON.stringify({
      runtime: 'node-bff-in-process',
      protocol: 'iop',
      ...summary,
      network: guard.snapshot(),
      failure
    }) + '\n'
  );
  if (failure || guard.snapshot().blocked || !summary.accepted || !summary.dataConsistent)
    process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help')
    process.stdout.write(
      'Isolated in-process Node BFF; exactly five native IOP reads, no refresh/fallback/writes.\n' +
        'pnpm exec tsx scripts/smoke-product-reference-real.ts --confirm-readonly --credential=<ignored IOP bundle> --product-id=<known own product> --output=<new artifacts receipt> [--prediction-title=<explicit human descriptor>]\n'
    );
  else {
    try {
      await main(process.argv.slice(2));
    } catch {
      process.stderr.write(
        'PRODUCT_REFERENCE_PREFLIGHT_FAILED: no raw errors, credentials or responses are printed.\n'
      );
      process.exitCode = 1;
    }
  }
}
