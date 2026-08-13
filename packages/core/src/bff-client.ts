import { GatewayException } from './errors';
import { createRequestId, NetworkManager } from './network';
import { DEFAULT_API_PREFIX, normalizeApiPrefix } from './api-contract';

import type { ApiResponse } from './api-contract';
import type { NetworkTransport } from './network';
import type { GatewayClient, OperationId, RequestOf, ResponseOf } from './types';

export interface BffGatewayClientOptions {
  baseUrl: string;
  apiPrefix?: string | undefined;
  transport?: NetworkTransport;
  csrfToken?: () => string | null;
  maxUploadRequestBytes?: number;
}

export class BffGatewayClient implements GatewayClient {
  readonly #endpoint: URL;
  readonly #network: NetworkManager;
  readonly #csrfToken: (() => string | null) | undefined;

  constructor(options: BffGatewayClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
      throw new Error('BFF 地址仅允许 HTTP(S)');
    }
    const apiPrefix = normalizeApiPrefix(options.apiPrefix ?? DEFAULT_API_PREFIX);
    this.#endpoint = new URL(`${apiPrefix}/operations/call`, baseUrl);
    this.#csrfToken = options.csrfToken;
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      policies: {
        alibaba: { allowedOrigins: [] },
        bff: {
          allowedOrigins: [baseUrl.origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: options.maxUploadRequestBytes ?? 28 * 1024 * 1024,
          maxResponseBytes: 28 * 1024 * 1024,
          credentials: 'include',
          redirect: 'error'
        },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  async request<K extends OperationId>(operation: K, request: RequestOf<K>): Promise<ResponseOf<K>> {
    const payload = request ?? {};
    const requestId = createRequestId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = this.#csrfToken?.();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await this.#network.request({
      service: 'bff',
      url: this.#endpoint,
      method: 'POST',
      headers,
      requestId,
      body: JSON.stringify({ requestId, operation, payload }),
      responseType: 'json'
    });
    if (!isApiResponse(response.data) || response.data.requestId !== response.requestId) {
      throw new GatewayException({
        code: 'INVALID_BFF_RESPONSE',
        message: 'BFF 响应契约或 requestId 无效',
        retryable: false
      });
    }
    if (!response.data.ok) throw new GatewayException(response.data.error);
    return response.data.data as ResponseOf<K>;
  }
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.ok !== 'boolean') return false;
  return value.ok ? 'data' in value : isRecord(value.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
