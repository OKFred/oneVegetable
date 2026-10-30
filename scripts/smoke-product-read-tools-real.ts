/**
 * Explicit four-method, read-only acceptance. Importing this module never reads
 * credentials, creates reports or sends requests. Offline tests use injected transport.
 * --confirm-readonly --iop-credential=<ignored bundle> --top-credential=<ignored bundle>
 * --output=<new ignored artifacts receipt>
 * Optional exact inputs: --model-number / --sku-code; --translation-text,
 * --source-language, --target-language; --shipping-template-id, --weight-kg,
 * --length-cm, --width-cm, --height-cm, --sale-type, --product-type, --moq, --batch-num.
 * A saved --product-result=<ignored get/v2 envelope> requires --product-id=<exact ID>.
 * With --product-id but no saved result, get/v2 is read exactly once, in memory only.
 * Its model/SKU/title/logistics may supply inputs. No template list, store scan,
 * next page, OAuth call, modification or other support method is permitted (max 5).
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import productWorkbenchDocs from '../docs/alibaba-product-workbench-docs.json';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { NativeFetchTransport, isRequestId, type NetworkTransport } from '../packages/core/src/network';
import {
  createShippingCoverageRequest,
  createTranslationReadRequest
} from '../packages/core/src/product-read-tools';
import type { CapabilityCallResult, GatewayCredentials } from '../packages/core/src/types';
import {
  assertIgnoredFile,
  businessAccepted,
  readIopBundle,
  safeErrorCode
} from './smoke-product-reference-real';

export const PRODUCT_READ_ACCEPTANCE_METHODS = Object.freeze({
  search: '/alibaba/icbu/product/search/v2',
  translation: 'alibaba.icbu.text.trans',
  countries: 'alibaba.icbu.product.country.getcountrylist',
  coverage: 'alibaba.icbu.product.logistics.country.getcoststatus'
} as const);
type AcceptanceOperation = keyof typeof PRODUCT_READ_ACCEPTANCE_METHODS;
export type ReadToolOperation = AcceptanceOperation | 'getProduct';
export const PRODUCT_READ_GUARD_METHODS = Object.freeze({
  ...PRODUCT_READ_ACCEPTANCE_METHODS,
  getProduct: '/alibaba/icbu/product/get/v2'
} as const);
const operations = Object.keys(PRODUCT_READ_ACCEPTANCE_METHODS) as AcceptanceOperation[];
const inputKeys = [
  'product-result',
  'product-id',
  'model-number',
  'sku-code',
  'translation-text',
  'source-language',
  'target-language',
  'shipping-template-id',
  'weight-kg',
  'length-cm',
  'width-cm',
  'height-cm',
  'sale-type',
  'product-type',
  'moq',
  'batch-num',
  'result-language'
] as const;
type InputKey = (typeof inputKeys)[number];
export interface ProductReadSmokeOptions {
  iopCredential: string;
  topCredential: string;
  output: string;
  inputs: Partial<Record<InputKey, string>>;
}
type Row = Record<string, unknown>;
function record(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 4096 &&
    Array.from(value).every((character) => character.charCodeAt(0) >= 32)
    ? value
    : undefined;
}
function scalar(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
}
function exactLookupKey(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate && candidate.length <= 256 && /[\p{L}\p{N}]/u.test(candidate) && !/[*?%]/u.test(candidate)
    ? candidate
    : undefined;
}
function positiveId(value: unknown): string | undefined {
  const result = scalar(value);
  return result &&
    /^[1-9][0-9]{0,63}$/u.test(result) &&
    (typeof value !== 'number' || Number.isSafeInteger(value))
    ? result
    : undefined;
}
export function parseProductReadOptions(args: readonly string[]): ProductReadSmokeOptions {
  const required = ['iop-credential', 'top-credential', 'output'];
  const allowed = new Set([...required, ...inputKeys]);
  const values = new Map<string, string>();
  if (args.filter((arg) => arg === '--confirm-readonly').length !== 1)
    throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  for (const arg of args) {
    if (arg === '--confirm-readonly') continue;
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    const key = match?.[1],
      value = match?.[2];
    if (!key || !value || !allowed.has(key) || values.has(key) || !text(value))
      throw new Error('READ_ONLY_ARGUMENTS_INVALID');
    values.set(key, value);
  }
  if (required.some((key) => !values.has(key))) throw new Error('READ_ONLY_ARGUMENTS_REQUIRED');
  if (values.has('model-number') && values.has('sku-code')) throw new Error('EXACT_ONE_SEARCH_KEY_REQUIRED');
  if (
    (values.has('product-result') && !values.has('product-id')) ||
    (values.has('product-id') && !positiveId(values.get('product-id')))
  )
    throw new Error('EXACT_PRODUCT_RESULT_ID_REQUIRED');
  const inputs: Partial<Record<InputKey, string>> = {};
  for (const key of inputKeys) {
    const value = values.get(key);
    if (value !== undefined) inputs[key] = value;
  }
  return {
    iopCredential: values.get('iop-credential') ?? '',
    topCredential: values.get('top-credential') ?? '',
    output: values.get('output') ?? '',
    inputs
  };
}

/** Reuses the existing strict read-only bundle parser; never discovers env/vaults or refreshes. */
export function readReadonlyProductBundle(input: unknown, protocol: 'top' | 'iop') {
  if (protocol === 'iop') return readIopBundle(input);
  const candidate = record(input) && 'authorization' in input ? input.authorization : input;
  try {
    const bundle = parseAlibabaOpenApiCredentialBundle(candidate);
    if (
      (bundle.protocol ?? 'top') !== 'top' ||
      (bundle.oauth.expiresAtUtc !== null && Date.parse(bundle.oauth.expiresAtUtc) <= Date.now())
    )
      throw new Error('VALID_UNEXPIRED_TOP_BUNDLE_REQUIRED');
    return bundle;
  } catch {
    throw new Error('VALID_UNEXPIRED_TOP_BUNDLE_REQUIRED');
  }
}

export function extractProductReadPrerequisites(
  value: unknown,
  expectedId: string
): Partial<Record<InputKey, string>> {
  if (
    !positiveId(expectedId) ||
    !record(value) ||
    value.method !== '/alibaba/icbu/product/get/v2' ||
    value.contractValid !== true ||
    !record(value.data) ||
    !businessAccepted(value.data) ||
    !record(value.data.product_info)
  )
    return {};
  const product = value.data.product_info;
  const basic = record(product.basic_info) ? product.basic_info : {};
  if (positiveId(basic.product_id) !== expectedId) return {};
  const logistics = record(product.logistics_info) ? product.logistics_info : {};
  const dimensions = record(logistics.dimension) ? logistics.dimension : {};
  const trade = record(product.trade_info) ? product.trade_info : {};
  const skus = Array.isArray(trade.sku_info) ? trade.sku_info : [];
  const sku: unknown = skus.find((item: unknown) => record(item) && text(item.sku_code));
  const result: Partial<Record<InputKey, string>> = {};
  const known: Partial<Record<InputKey, unknown>> = {
    'model-number': basic.model_number,
    'sku-code': record(sku) ? sku.sku_code : undefined,
    'translation-text': basic.title,
    'shipping-template-id': positiveId(logistics.shipping_template_id),
    'weight-kg': logistics.weight,
    'length-cm': dimensions.length,
    'width-cm': dimensions.width,
    'height-cm': dimensions.height,
    moq: trade.moq
  };
  for (const key of inputKeys) {
    const item = scalar(known[key]);
    if (item !== undefined) result[key] = item;
  }
  // sale_type / product_type are never inferred from status, inventory or a sample.
  return result;
}
export interface ProductReadPlanEntry {
  operation: ReadToolOperation;
  method: string;
  protocol: 'iop' | 'top';
  parameters: Record<string, unknown> | null;
}
export function buildProductReadPlan(
  options: ProductReadSmokeOptions,
  applicationAppName: string,
  savedProduct?: unknown
): ProductReadPlanEntry[] {
  const derived = extractProductReadPrerequisites(savedProduct, options.inputs['product-id'] ?? '');
  const values = { ...derived, ...options.inputs };
  const explicitSku = options.inputs['sku-code'];
  const model = explicitSku ? undefined : exactLookupKey(values['model-number']);
  const sku = model ? undefined : exactLookupKey(values['sku-code']);
  const search =
    model || sku
      ? {
          ...(model ? { model_number: model } : { sku_code: sku }),
          page_index: 1,
          page_size: 1
        }
      : null;
  let translation: Record<string, unknown> | null = null;
  try {
    if (applicationAppName.trim().toLowerCase() !== 'xiaoman')
      translation = createTranslationReadRequest({
        appName: applicationAppName,
        text: values['translation-text'] ?? '',
        sourceLanguage: values['source-language'] ?? '',
        targetLanguage: values['target-language'] ?? '',
        fieldType: 'title'
      });
  } catch {
    /* Missing/invalid real inputs are not replaced with examples. */
  }
  let coverage: Record<string, unknown> | null = null;
  try {
    coverage = createShippingCoverageRequest({
      shippingTemplateId: values['shipping-template-id'] ?? '',
      weightKg: values['weight-kg'] ?? '',
      lengthCm: values['length-cm'] ?? '',
      widthCm: values['width-cm'] ?? '',
      heightCm: values['height-cm'] ?? '',
      saleType: values['sale-type'] as 'normal' | 'batch',
      productType: Number(values['product-type']) as 1 | 2,
      moq: Number(values.moq),
      batchNum: Number(values['batch-num']),
      language: values['result-language']
    });
  } catch {
    /* No guessed template, weight, sale type, product type, MOQ or units. */
  }
  const language = values['result-language'];
  const countryRequest =
    language === undefined ? {} : /^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/u.test(language) ? { language } : null;
  return operations.map((operation) => ({
    operation,
    method: PRODUCT_READ_ACCEPTANCE_METHODS[operation],
    protocol: operation === 'search' ? 'iop' : 'top',
    parameters:
      operation === 'search'
        ? search
        : operation === 'translation'
          ? translation
          : operation === 'coverage'
            ? coverage
            : countryRequest === null
              ? null
              : { country_request: countryRequest }
  }));
}

const transportFields = new Set([
  'method',
  'app_key',
  'sign',
  'sign_method',
  'timestamp',
  'v',
  'format',
  'simplify',
  'session',
  'access_token',
  'partner_id'
]);
/** Same operation/requestId/budget guard pattern as ReferenceReadGuard, extended to the fixed TOP trio. */
export class ProductReadNetworkGuard implements NetworkTransport {
  private active: {
    operation: ReadToolOperation;
    requestId: string;
    fields: Map<string, string>;
    reserved: boolean;
  } | null = null;
  private used = new Set<ReadToolOperation>();
  private busy = false;
  private lastStarted: number | null = null;
  private sent = 0;
  private blocked = 0;
  constructor(
    private readonly transport: NetworkTransport,
    private readonly clock: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = async (ms) => {
      await delay(ms);
    }
  ) {}
  arm(entry: ProductReadPlanEntry, requestId: string): void {
    if (
      this.active ||
      this.busy ||
      this.used.has(entry.operation) ||
      !Object.hasOwn(PRODUCT_READ_GUARD_METHODS, entry.operation) ||
      entry.method !== PRODUCT_READ_GUARD_METHODS[entry.operation] ||
      !isRequestId(requestId) ||
      entry.protocol !== (entry.operation === 'search' || entry.operation === 'getProduct' ? 'iop' : 'top') ||
      !entry.parameters
    )
      throw new Error('READ_ONLY_NETWORK_DENIED');
    if (Object.keys(entry.parameters).some((key) => transportFields.has(key)))
      throw new Error('READ_ONLY_NETWORK_DENIED');
    if (
      entry.operation === 'getProduct' &&
      (Object.keys(entry.parameters).length !== 1 || !positiveId(entry.parameters.product_id))
    )
      throw new Error('READ_ONLY_NETWORK_DENIED');
    if (entry.operation === 'search') {
      const params = entry.parameters;
      const model = exactLookupKey(params.model_number),
        sku = exactLookupKey(params.sku_code);
      if (
        Boolean(model) === Boolean(sku) ||
        params.page_index !== 1 ||
        params.page_size !== 1 ||
        Object.keys(params).some(
          (key) => !['model_number', 'sku_code', 'page_index', 'page_size'].includes(key)
        )
      )
        throw new Error('READ_ONLY_NETWORK_DENIED');
    }
    if (entry.operation === 'translation') {
      const tasks = entry.parameters.icbu_translate_task_dto;
      const task: unknown = Array.isArray(tasks) ? tasks[0] : null;
      if (
        !Array.isArray(tasks) ||
        tasks.length !== 1 ||
        !record(task) ||
        task.format !== 'text' ||
        !text(task.app_name) ||
        String(task.app_name).trim().toLowerCase() === 'xiaoman'
      )
        throw new Error('READ_ONLY_NETWORK_DENIED');
    }
    const fields = new Map(
      Object.entries(entry.parameters).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value)
      ])
    );
    this.active = { operation: entry.operation, requestId, fields, reserved: false };
    this.used.add(entry.operation);
  }
  disarm(): void {
    this.active = null;
  }
  snapshot() {
    return { sent: this.sent, blocked: this.blocked };
  }
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const deny = (): never => {
      this.blocked++;
      throw new Error('READ_ONLY_NETWORK_DENIED');
    };
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      return deny();
    }
    const current = this.active;
    const url = new URL(request.url);
    const iop = current?.operation === 'search' || current?.operation === 'getProduct';
    if (
      !current ||
      this.busy ||
      current.reserved ||
      this.sent >= 5 ||
      url.origin !== (iop ? 'https://openapi-api.alibaba.com' : 'https://eco.taobao.com') ||
      url.pathname !== (iop ? '/rest' + PRODUCT_READ_GUARD_METHODS[current.operation] : '/router/rest') ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      request.method !== 'POST' ||
      request.headers.get('X-Request-ID') !== current.requestId ||
      !/^application\/x-www-form-urlencoded(?:;|$)/iu.test(request.headers.get('Content-Type') ?? '')
    )
      return deny();
    current.reserved = true;
    this.busy = true;
    try {
      const form = new URLSearchParams(await request.clone().text());
      const keys = [...form.keys()];
      if (
        new Set(keys).size !== keys.length ||
        !form.get('app_key') ||
        !form.get('sign') ||
        keys.some((key) => !transportFields.has(key) && !current.fields.has(key)) ||
        [...current.fields].some(([key, value]) => form.get(key) !== value) ||
        (iop
          ? form.has('method') ||
            form.has('session') ||
            !form.get('access_token') ||
            form.get('sign_method') !== 'sha256'
          : form.get('method') !== PRODUCT_READ_GUARD_METHODS[current.operation] ||
            form.has('access_token') ||
            !['hmac', 'md5', 'hmac-sha256'].includes(form.get('sign_method') ?? '') ||
            (current.operation === 'translation' ? form.has('session') : !form.get('session')))
      )
        return deny();
      const wait = this.lastStarted === null ? 0 : Math.max(0, 350 - (this.clock() - this.lastStarted));
      if (wait) await this.wait(wait);
      if (this.active !== current) return deny();
      this.lastStarted = this.clock();
      this.sent++;
      return await this.transport.send(request.url, { ...init, redirect: 'error' });
    } finally {
      this.busy = false;
    }
  }
}

export interface ProductReadObservation {
  method: string;
  protocol: 'top' | 'iop';
  requestId: string | null;
  status: 'accepted' | 'failed' | 'missing-prerequisite';
  errorCode: string | null;
  subCode: string | null;
  /** Search-only schema diagnostics: public field paths/keywords, never messages or values. */
  contractIssues?: { instancePath: string; keyword: string }[];
  counts: { networkRequests: number; results: number | null };
}
const searchContractPaths = new Set<string>(['']);
function collectSearchContractPaths(nodes: unknown, prefix: string): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!record(node) || typeof node.name !== 'string' || typeof node.type !== 'string') continue;
    const path = prefix + '/' + node.name;
    searchContractPaths.add(path);
    const childPath = node.type.endsWith('[]') ? path + '/*' : path;
    searchContractPaths.add(childPath);
    collectSearchContractPaths(node.children, childPath);
  }
}
collectSearchContractPaths(
  productWorkbenchDocs.documents.find((doc) => doc.path === PRODUCT_READ_ACCEPTANCE_METHODS.search)?.response,
  ''
);
const contractKeywords = new Set([
  'type',
  'required',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'enum',
  'const',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'format',
  'contains'
]);
/** Accept only paths present in the saved public search document; normalize array indices. */
export function safeSearchContractIssues(
  envelope: unknown,
  redacted: readonly string[] = []
): NonNullable<ProductReadObservation['contractIssues']> {
  if (
    !record(envelope) ||
    envelope.method !== PRODUCT_READ_ACCEPTANCE_METHODS.search ||
    envelope.contractValid !== false ||
    !Array.isArray(envelope.contractIssues)
  )
    return [];
  const result: NonNullable<ProductReadObservation['contractIssues']> = [];
  const seen = new Set<string>();
  for (const issue of envelope.contractIssues.slice(0, 100)) {
    if (
      !record(issue) ||
      typeof issue.instancePath !== 'string' ||
      issue.instancePath.length > 512 ||
      typeof issue.keyword !== 'string' ||
      !contractKeywords.has(issue.keyword)
    )
      continue;
    const keyword = issue.keyword;
    const instancePath = issue.instancePath.replace(/\/(?:0|[1-9][0-9]*)(?=\/|$)/gu, '/*');
    if (
      !searchContractPaths.has(instancePath) ||
      redacted.some((secret) => secret && (instancePath.includes(secret) || keyword.includes(secret)))
    )
      continue;
    const key = instancePath + ':' + keyword;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ instancePath, keyword });
    if (result.length === 20) break;
  }
  return result;
}
export interface ProductReadReceipt {
  observations: ProductReadObservation[];
  counts: {
    methods: number;
    accepted: number;
    failed: number;
    missingPrerequisite: number;
    networkRequests: number;
  };
}
const extraErrors = new Set([
  'ALIBABA_API_ERROR',
  'ALIBABA_API_REJECTED',
  'READ_NOT_COMPLETED',
  'PRODUCT_READ_RESPONSE_INVALID',
  'PRODUCT_READ_PARTIAL_FAILURE',
  'READ_PLAN_INVALID'
]);
function safeProviderCode(value: unknown, redacted: readonly string[]): string | null {
  return typeof value === 'string' &&
    /^(?:[1-9][0-9]{0,4}|(?:isv|isp)\.[a-z0-9_.-]{1,120}|SYS_ERROR|PARAM_ERROR)$/u.test(value) &&
    !redacted.some((secret) => secret && value.includes(secret))
    ? value
    : null;
}
function safeFailure(error: unknown, redacted: readonly string[]) {
  const normalized = normalizeGatewayError(error);
  const reused = safeErrorCode(error);
  return {
    errorCode:
      reused !== 'ERROR_REDACTED'
        ? reused
        : extraErrors.has(normalized.code)
          ? normalized.code
          : (safeProviderCode(normalized.code, redacted) ?? 'ERROR_REDACTED'),
    subCode: safeProviderCode(normalized.subCode, redacted)
  };
}
function list(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.every(record)) throw new Error('PRODUCT_READ_RESPONSE_INVALID');
  return value;
}
function countCountries(value: unknown): number {
  const continents = list(Array.isArray(value) ? value : record(value) ? value.continent_d_t_o : null);
  return continents.reduce((total, continent) => {
    const countries = continent.country_list;
    return (
      total +
      list(Array.isArray(countries) ? countries : record(countries) ? countries.country_d_t_o : null).length
    );
  }, 0);
}
export function assessProductReadEnvelope(
  entry: ProductReadPlanEntry,
  envelope: CapabilityCallResult,
  redacted: readonly string[] = []
): { count: number | null; errorCode: string | null } {
  if (envelope.method !== entry.method || !envelope.contractValid || !record(envelope.data))
    return { count: null, errorCode: 'RESPONSE_CONTRACT_INVALID' };
  const data = envelope.data;
  if (data.biz_success === false || data.success === false)
    return {
      count: null,
      errorCode: safeProviderCode(data.msg_code, redacted) ?? 'READ_RESULT_NOT_CONFIRMED'
    };
  try {
    if (entry.operation === 'getProduct') {
      const product = record(data.product_info) ? data.product_info : {};
      const basic = record(product.basic_info) ? product.basic_info : {};
      if (
        data.success !== true ||
        !businessAccepted(data) ||
        positiveId(basic.product_id) !== positiveId(entry.parameters?.product_id)
      )
        throw new Error('PRODUCT_READ_RESPONSE_INVALID');
      return { count: 1, errorCode: null };
    }
    if (entry.operation === 'search') {
      if (data.success !== true) throw new Error('PRODUCT_READ_RESPONSE_INVALID');
      const items = list(data.product_info);
      if (
        items.length > 1 ||
        (record(data.page) &&
          ((data.page.page_index !== undefined && Number(data.page.page_index) !== 1) ||
            (data.page.page_size !== undefined && Number(data.page.page_size) !== 1)))
      )
        throw new Error('PRODUCT_READ_RESPONSE_INVALID');
      return { count: items.length, errorCode: null };
    }
    if (entry.operation === 'translation') {
      const items = list(data.result);
      const failed = items.find((item) => item.success === false);
      if (failed)
        return {
          count: null,
          errorCode: items.some((item) => item.success === true)
            ? 'PRODUCT_READ_PARTIAL_FAILURE'
            : record(failed.error_code)
              ? (safeProviderCode(failed.error_code.code, redacted) ?? 'READ_RESULT_NOT_CONFIRMED')
              : 'READ_RESULT_NOT_CONFIRMED'
        };
      if (items.length !== 1 || items[0]?.success !== true || !text(items[0].translate_result_text))
        throw new Error('PRODUCT_READ_RESPONSE_INVALID');
      return { count: 1, errorCode: null };
    }
    if (data.biz_success !== true) throw new Error('PRODUCT_READ_RESPONSE_INVALID');
    if (entry.operation === 'countries') return { count: countCountries(data.data), errorCode: null };
    if (
      !record(data.data) ||
      (data.data.core_country_logistics_cost_list === undefined &&
        data.data.non_core_country_logistics_cost_list === undefined)
    )
      throw new Error('PRODUCT_READ_RESPONSE_INVALID');
    const items = [
      ...list(data.data.core_country_logistics_cost_list ?? []),
      ...list(data.data.non_core_country_logistics_cost_list ?? [])
    ];
    return { count: items.length, errorCode: null };
  } catch {
    return { count: null, errorCode: 'PRODUCT_READ_RESPONSE_INVALID' };
  }
}
export function productReadReceipt(observations: ProductReadObservation[]): ProductReadReceipt {
  return {
    observations,
    counts: {
      methods: observations.length,
      accepted: observations.filter((row) => row.status === 'accepted').length,
      failed: observations.filter((row) => row.status === 'failed').length,
      missingPrerequisite: observations.filter((row) => row.status === 'missing-prerequisite').length,
      networkRequests: observations.reduce((sum, row) => sum + row.counts.networkRequests, 0)
    }
  };
}

/** Real and offline execution share the same fixed GatewayClient -> NetworkManager -> guard chain. */
export async function runProductReadAcceptance(
  plan: readonly ProductReadPlanEntry[],
  credentials: Readonly<Record<'top' | 'iop', GatewayCredentials>>,
  guard: ProductReadNetworkGuard,
  persist: (receipt: ProductReadReceipt) => Promise<void> = () => Promise.resolve(),
  redacted: readonly string[] = []
): Promise<ProductReadReceipt> {
  if (
    plan.length !== 4 ||
    plan.some(
      (entry, index) =>
        entry.operation !== operations[index] ||
        entry.method !== PRODUCT_READ_GUARD_METHODS[entry.operation] ||
        entry.protocol !== (entry.operation === 'search' ? 'iop' : 'top')
    ) ||
    (credentials.top.protocol ?? 'top') !== 'top' ||
    credentials.iop.protocol !== 'iop'
  )
    throw new Error('READ_PLAN_INVALID');
  const secrets = [
    ...redacted,
    ...Object.values(credentials).flatMap((item) => [item.appKey, item.appSecret, item.accessToken])
  ];
  const observations: ProductReadObservation[] = plan.map((entry) => ({
    method: entry.method,
    protocol: entry.protocol,
    requestId: null,
    status: entry.parameters ? 'failed' : 'missing-prerequisite',
    errorCode: entry.parameters ? 'READ_NOT_COMPLETED' : 'MISSING_PREREQUISITE',
    subCode: null,
    counts: { networkRequests: 0, results: null }
  }));
  const save = () => persist(productReadReceipt(observations));
  await save();
  for (const [index, entry] of plan.entries()) {
    const row = observations[index];
    if (!row || !entry.parameters) continue;
    row.requestId = randomUUID();
    guard.arm(entry, row.requestId);
    const before = guard.snapshot().sent;
    try {
      await save(); // Persist correlation before any provider request.
      const gateway = new AlibabaReadGatewayClient(credentials[entry.protocol], {
        transport: guard,
        maxAttempts: 1
      });
      const response = await gateway.request(
        'callCapability',
        {
          method: entry.method,
          parameters: entry.parameters
        },
        { requestId: row.requestId }
      );
      if (guard.snapshot().sent - before !== 1) throw new Error('READ_CORRELATION_NOT_CONFIRMED');
      const contractIssues = safeSearchContractIssues(response, secrets);
      if (contractIssues.length) row.contractIssues = contractIssues;
      const result = assessProductReadEnvelope(entry, response, secrets);
      row.counts.results = result.count;
      row.errorCode = result.errorCode;
      row.status = result.errorCode === null ? 'accepted' : 'failed';
    } catch (error: unknown) {
      row.status = 'failed';
      Object.assign(row, safeFailure(error, secrets));
    } finally {
      row.counts.networkRequests = guard.snapshot().sent - before;
      guard.disarm();
      await save();
    }
    if (guard.snapshot().blocked) throw new Error('READ_ONLY_NETWORK_DENIED');
  }
  return productReadReceipt(observations);
}

/** An explicit product ID permits one bounded get/v2 read; its response stays in memory. */
export async function runProductReadSmoke(
  options: ProductReadSmokeOptions,
  credentials: Readonly<Record<'top' | 'iop', GatewayCredentials>>,
  applicationAppName: string,
  guard: ProductReadNetworkGuard,
  persist: (receipt: ProductReadReceipt) => Promise<void> = () => Promise.resolve(),
  savedProduct?: unknown,
  redacted: readonly string[] = []
): Promise<ProductReadReceipt> {
  if (credentials.iop.protocol !== 'iop' || (credentials.top.protocol ?? 'top') !== 'top')
    throw new Error('READ_PLAN_INVALID');
  const prefix: ProductReadObservation[] = [];
  const secrets = [
    ...redacted,
    applicationAppName,
    ...Object.values(credentials).flatMap((item) => [item.appKey, item.appSecret, item.accessToken])
  ];
  let product = savedProduct;
  const productId = options.inputs['product-id'];
  if (productId && !options.inputs['product-result']) {
    if (!positiveId(productId)) throw new Error('EXACT_PRODUCT_RESULT_ID_REQUIRED');
    const entry: ProductReadPlanEntry = {
      operation: 'getProduct',
      method: PRODUCT_READ_GUARD_METHODS.getProduct,
      protocol: 'iop',
      parameters: { product_id: productId }
    };
    const row: ProductReadObservation = {
      method: entry.method,
      protocol: 'iop',
      requestId: randomUUID(),
      status: 'failed',
      errorCode: 'READ_NOT_COMPLETED',
      subCode: null,
      counts: { networkRequests: 0, results: null }
    };
    prefix.push(row);
    if (!row.requestId) throw new Error('READ_PLAN_INVALID');
    guard.arm(entry, row.requestId);
    const before = guard.snapshot().sent;
    try {
      await persist(productReadReceipt(prefix));
      const gateway = new AlibabaReadGatewayClient(credentials.iop, { transport: guard, maxAttempts: 1 });
      const envelope = await gateway.request(
        'callCapability',
        {
          method: entry.method,
          parameters: { product_id: productId }
        },
        { requestId: row.requestId }
      );
      if (guard.snapshot().sent - before !== 1) throw new Error('READ_CORRELATION_NOT_CONFIRMED');
      const assessment = assessProductReadEnvelope(entry, envelope, secrets);
      row.errorCode = assessment.errorCode;
      row.counts.results = assessment.count;
      row.status = assessment.errorCode === null ? 'accepted' : 'failed';
      if (row.status === 'accepted') product = envelope;
    } catch (error: unknown) {
      Object.assign(row, safeFailure(error, secrets));
    } finally {
      row.counts.networkRequests = guard.snapshot().sent - before;
      guard.disarm();
      await persist(productReadReceipt(prefix));
    }
    if (guard.snapshot().blocked) throw new Error('READ_ONLY_NETWORK_DENIED');
  }
  const result = await runProductReadAcceptance(
    buildProductReadPlan(options, applicationAppName, product),
    credentials,
    guard,
    (receipt) => persist(productReadReceipt([...prefix, ...receipt.observations])),
    secrets
  );
  return productReadReceipt([...prefix, ...result.observations]);
}

/** Only the source worktree and the explicitly named remote primary repo may hold ignored inputs/reports. */
export function productReadScopedRoot(root: string, path: string): string {
  const permitted = [root, resolve(root, '..', 'oneVegetable')];
  const match = permitted.find((candidate) => path.toLowerCase().startsWith((candidate + sep).toLowerCase()));
  if (!match) throw new Error('IGNORED_PATHS_REQUIRED');
  return match;
}

async function readIgnoredJson(root: string, path: string): Promise<unknown> {
  await assertIgnoredFile(productReadScopedRoot(root, path), path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('IGNORED_INPUT_INVALID');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function main(args: readonly string[]): Promise<void> {
  const options = parseProductReadOptions(args);
  const root = await realpath(resolve(import.meta.dirname, '..'));
  const outputPath = resolve(root, options.output);
  const outputRoot = productReadScopedRoot(root, outputPath);
  const iopPath = resolve(root, options.iopCredential),
    topPath = resolve(root, options.topCredential);
  const productPath = options.inputs['product-result']
    ? resolve(root, options.inputs['product-result'])
    : null;
  if (
    !outputPath.toLowerCase().startsWith((resolve(outputRoot, 'artifacts') + sep).toLowerCase()) ||
    [iopPath, topPath, productPath].some((path) => path?.toLowerCase() === outputPath.toLowerCase())
  )
    throw new Error('NEW_IGNORED_RECEIPT_REQUIRED');
  await assertIgnoredFile(outputRoot, outputPath);
  const iop = readReadonlyProductBundle(await readIgnoredJson(root, iopPath), 'iop');
  const top = readReadonlyProductBundle(await readIgnoredJson(root, topPath), 'top');
  const product: unknown = productPath ? await readIgnoredJson(root, productPath) : undefined;
  const credentials: Record<'top' | 'iop', GatewayCredentials> = {
    iop: {
      protocol: 'iop',
      appKey: iop.application.appKey,
      appSecret: iop.application.appSecret,
      accessToken: iop.oauth.accessToken,
      endpoint: IOP_BUSINESS_ENDPOINT,
      signMethod: 'hmac-sha256'
    },
    top: {
      protocol: 'top',
      appKey: top.application.appKey,
      appSecret: top.application.appSecret,
      accessToken: top.oauth.accessToken,
      endpoint: 'https://eco.taobao.com/router/rest',
      signMethod: 'hmac'
    }
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await assertIgnoredFile(outputRoot, outputPath);
  const output = await open(outputPath, 'wx', 0o600); // No overwrite, replay or credential mutation.
  const persist = async (receipt: ProductReadReceipt) => {
    const content = JSON.stringify(receipt, null, 2) + '\n';
    await output.truncate(0);
    await output.write(content, 0, 'utf8');
    await output.sync();
  };
  try {
    const receipt = await runProductReadSmoke(
      options,
      credentials,
      top.application.appName,
      new ProductReadNetworkGuard(new NativeFetchTransport()),
      persist,
      product,
      [
        top.application.appName,
        ...Object.values(options.inputs).filter((value): value is string => typeof value === 'string')
      ]
    );
    process.stdout.write(JSON.stringify(receipt) + '\n');
    if (receipt.counts.failed) process.exitCode = 1;
    else if (receipt.counts.missingPrerequisite) process.exitCode = 2;
  } finally {
    await output.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help')
    process.stdout.write(
      'Read-only four-method smoke; see source header for explicit inputs. No refresh, scan, retry, fallback or writes.\n'
    );
  else {
    try {
      await main(process.argv.slice(2));
    } catch {
      process.stderr.write(
        'PRODUCT_READ_PREFLIGHT_FAILED: raw errors, input paths and business data are not printed.\n'
      );
      process.exitCode = 1;
    }
  }
}
