import { DEFAULT_API_PREFIX, normalizeApiPrefix } from './api-contract';
import { GatewayException } from './errors';
import { createRequestId, NetworkManager } from './network';

import type { ApiResponse } from './api-contract';
import type { NetworkTransport } from './network';
import type {
  ProductMutationJob,
  ProductMutationJobPage,
  ProductMutationJobStatus
} from './product-mutation-job';

export interface ProductMutationJobListInput {
  page?: number;
  pageSize?: number;
  productId?: string;
  status?: ProductMutationJobStatus;
}

export interface ProductMutationJobClient {
  list(input?: ProductMutationJobListInput): Promise<ProductMutationJobPage>;
  get(id: string): Promise<ProductMutationJob>;
  refresh(id: string, revision: number): Promise<ProductMutationJob>;
  recover(id: string, revision: number): Promise<ProductMutationJob>;
}

export interface BffProductMutationJobClientOptions {
  baseUrl: string;
  apiPrefix?: string | undefined;
  transport?: NetworkTransport;
  csrfToken?: () => string | null;
}

export class BffProductMutationJobClient implements ProductMutationJobClient {
  readonly #baseUrl: URL;
  readonly #apiPrefix: string;
  readonly #network: NetworkManager;
  readonly #csrfToken: (() => string | null) | undefined;

  constructor(options: BffProductMutationJobClientOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(this.#baseUrl.protocol)) throw new Error('BFF 地址仅允许 HTTP(S)');
    this.#apiPrefix = normalizeApiPrefix(options.apiPrefix ?? DEFAULT_API_PREFIX);
    this.#csrfToken = options.csrfToken;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      policies: {
        alibaba: { allowedOrigins: [] },
        bff: {
          allowedOrigins: [this.#baseUrl.origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 64 * 1024,
          maxResponseBytes: 2 * 1024 * 1024,
          credentials: 'include',
          redirect: 'error'
        },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  async list(input: ProductMutationJobListInput = {}): Promise<ProductMutationJobPage> {
    const data = await this.#call('/product-mutation-jobs/list', { ...input });
    if (!isProductMutationJobPage(data)) throw invalidResponse();
    return data;
  }

  async get(id: string): Promise<ProductMutationJob> {
    const data = await this.#call('/product-mutation-jobs/get', { id });
    if (!isProductMutationJob(data)) throw invalidResponse();
    return data;
  }

  async refresh(id: string, revision: number): Promise<ProductMutationJob> {
    const data = await this.#call('/product-mutation-jobs/refresh', { id, revision });
    if (!isProductMutationJob(data)) throw invalidResponse();
    return data;
  }

  async recover(id: string, revision: number): Promise<ProductMutationJob> {
    const data = await this.#call('/product-mutation-jobs/recover', { id, revision });
    if (!isProductMutationJob(data)) throw invalidResponse();
    return data;
  }

  async #call(path: string, body: Record<string, unknown>): Promise<unknown> {
    const requestId = createRequestId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = this.#csrfToken?.();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await this.#network.request({
      service: 'bff',
      url: new URL(`${this.#apiPrefix}${path}`, this.#baseUrl),
      method: 'POST',
      headers,
      requestId,
      body: JSON.stringify({ requestId, ...body }),
      responseType: 'json'
    });
    if (!isApiResponse(response.data) || response.data.requestId !== requestId) {
      throw new GatewayException(invalidResponse().gatewayError, response.requestId);
    }
    if (!response.data.ok) throw new GatewayException(response.data.error, response.data.requestId);
    return response.data.data;
  }
}

function isProductMutationJobPage(value: unknown): value is ProductMutationJobPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isProductMutationJob) &&
    isPositiveInteger(value.page) &&
    isPositiveInteger(value.pageSize) &&
    isNonNegativeInteger(value.total)
  );
}

function isProductMutationJob(value: unknown): value is ProductMutationJob {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.requestId === 'string' &&
    typeof value.productId === 'string' &&
    isEnum(value.operation, ['updateProduct', 'updateProductDisplay']) &&
    isEnum(value.status, [
      'submitted',
      'auditing',
      'verifying',
      'verified',
      'recovery-required',
      'recovering',
      'recovered',
      'failed'
    ]) &&
    (value.categoryId === null || isPositiveInteger(value.categoryId)) &&
    (value.language === null || isEnum(value.language, ['zh_CN', 'en_US'])) &&
    typeof value.payloadFingerprint === 'string' &&
    Array.isArray(value.fieldExpectations) &&
    value.fieldExpectations.every(
      (item) => isRecord(item) && typeof item.fieldId === 'string' && typeof item.fingerprint === 'string'
    ) &&
    isNullableString(value.encryptedProductId) &&
    (value.targetDisplay === null || isEnum(value.targetDisplay, ['online', 'offline'])) &&
    (value.originalDisplay === null || isEnum(value.originalDisplay, ['online', 'offline'])) &&
    isNullableString(value.traceId) &&
    isNullableString(value.reasonCode) &&
    isNullableString(value.message) &&
    isNonNegativeInteger(value.submittedTimeUtc) &&
    isNullableNonNegativeInteger(value.lastCheckedTimeUtc) &&
    isNullableNonNegativeInteger(value.completedTimeUtc) &&
    isNonNegativeInteger(value.createTimeUtc) &&
    isNonNegativeInteger(value.updateTimeUtc) &&
    typeof value.creatorId === 'string' &&
    typeof value.updaterId === 'string' &&
    isPositiveInteger(value.revision) &&
    isNullableString(value.remark)
  );
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.ok !== 'boolean') return false;
  return value.ok ? 'data' in value : isRecord(value.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnum<const T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.some((candidate) => candidate === value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function invalidResponse(): GatewayException {
  return new GatewayException({
    code: 'INVALID_BFF_RESPONSE',
    message: 'BFF 商品写入任务响应契约无效',
    retryable: false
  });
}
