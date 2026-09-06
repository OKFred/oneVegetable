import { GatewayException, normalizeGatewayError } from './errors';
import {
  isProductMutationJob,
  isProductMutationJobPage,
  type ProductMutationJobClient,
  type ProductMutationJobListInput
} from './product-mutation-job-client';

import type { GatewayError } from './types';
import {
  productMutationJobIsTerminal,
  type ProductMutationJob,
  type ProductMutationJobPage
} from './product-mutation-job';
import type { ProductMutationFingerprintComparison } from './product-mutation-fingerprint';

export type ExtensionProductMutationJobOperation =
  'list' | 'get' | 'refresh' | 'complete-update-readback' | 'recover';

export type ExtensionProductUpdateReadbackResult =
  | { kind: 'comparison'; comparison: ProductMutationFingerprintComparison }
  | { kind: 'error'; error: GatewayError };

export interface ExtensionProductUpdateReadbackProvider {
  compare(job: ProductMutationJob): Promise<ProductMutationFingerprintComparison>;
}

export interface ExtensionProductMutationJobRequest {
  requestId: string;
  kind: 'product-mutation-job-request';
  operation: ExtensionProductMutationJobOperation;
  payload?: unknown;
}

export type ExtensionProductMutationJobResponse =
  { requestId: string; ok: true; data: unknown } | { requestId: string; ok: false; error: GatewayError };

export interface ExtensionProductMutationJobMessenger {
  send(message: ExtensionProductMutationJobRequest): Promise<unknown>;
}

export class ExtensionProductMutationJobClient implements ProductMutationJobClient {
  constructor(
    private readonly messenger: ExtensionProductMutationJobMessenger,
    private readonly updateReadback?: ExtensionProductUpdateReadbackProvider
  ) {}

  async list(input: ProductMutationJobListInput = {}): Promise<ProductMutationJobPage> {
    const data = await this.#call('list', input);
    if (!isProductMutationJobPage(data)) throw invalidResponse();
    return data;
  }

  async get(id: string): Promise<ProductMutationJob> {
    const data = await this.#call('get', { id });
    if (!isProductMutationJob(data)) throw invalidResponse();
    return data;
  }

  async refresh(id: string, revision: number): Promise<ProductMutationJob> {
    const current = await this.get(id);
    if (current.revision !== revision) {
      throw new GatewayException({
        code: 'ENTITY_VERSION_CONFLICT',
        message: '商品写入任务状态已更新，请刷新后重试',
        retryable: false
      });
    }
    if (productMutationJobIsTerminal(current.status)) return current;
    if (current.operation === 'updateProduct') {
      if (!this.updateReadback) {
        throw new GatewayException({
          code: 'PRODUCT_MUTATION_READBACK_UNAVAILABLE',
          message: '当前扩展页面不支持商品更新回读',
          retryable: false
        });
      }
      let result: ExtensionProductUpdateReadbackResult;
      try {
        result = { kind: 'comparison', comparison: await this.updateReadback.compare(current) };
      } catch (error: unknown) {
        result = { kind: 'error', error: normalizeGatewayError(error) };
      }
      const data = await this.#call('complete-update-readback', { id, revision, result });
      if (!isProductMutationJob(data)) throw invalidResponse();
      return data;
    }
    const data = await this.#call('refresh', { id, revision });
    if (!isProductMutationJob(data)) throw invalidResponse();
    return data;
  }

  async recover(id: string, revision: number): Promise<ProductMutationJob> {
    const data = await this.#call('recover', { id, revision });
    if (!isProductMutationJob(data)) throw invalidResponse();
    return data;
  }

  async #call(operation: ExtensionProductMutationJobOperation, payload: unknown): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const message: ExtensionProductMutationJobRequest = {
      requestId,
      kind: 'product-mutation-job-request',
      operation,
      payload
    };
    const response = await this.messenger.send(message);
    if (!isExtensionProductMutationJobResponse(response) || response.requestId !== requestId) {
      throw invalidResponse();
    }
    if (!response.ok) throw new GatewayException(response.error, response.requestId);
    return response.data;
  }
}

export function isExtensionProductMutationJobResponse(
  value: unknown
): value is ExtensionProductMutationJobResponse {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.ok !== 'boolean') {
    return false;
  }
  return value.ok ? 'data' in value : isGatewayError(value.error);
}

function isGatewayError(value: unknown): value is GatewayError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): GatewayException {
  return new GatewayException({
    code: 'INVALID_RUNTIME_RESPONSE',
    message: '插件商品写入任务响应无效',
    retryable: false
  });
}
