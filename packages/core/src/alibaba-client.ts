import { GatewayException, normalizeGatewayError } from './errors';
import { NetworkManager, type NetworkResponse } from './network';
import { createAlibabaRequest } from './signing';
import type { GatewayCredentials, GatewayError } from './types';

export interface AlibabaCallResult {
  method: string;
  data: unknown;
  traceId?: string;
}

export interface AlibabaClientOptions {
  maxAttempts?: number;
  shouldRetry?: (method: string, error: GatewayError, attempt: number) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  requestId?: string;
}

export class AlibabaClient {
  readonly #network: NetworkManager;
  readonly #credentials: GatewayCredentials;
  readonly #options: AlibabaClientOptions;

  constructor(credentials: GatewayCredentials, network: NetworkManager, options: AlibabaClientOptions = {}) {
    this.#credentials = credentials;
    this.#network = network;
    this.#options = options;
  }

  static create(credentials: GatewayCredentials, options: AlibabaClientOptions = {}): AlibabaClient {
    return new AlibabaClient(
      credentials,
      new NetworkManager({
        policies: {
          alibaba: {
            allowedOrigins: [new URL(credentials.endpoint).origin],
            timeoutMilliseconds: 30_000,
            maxRequestBytes: 30 * 1024 * 1024,
            maxResponseBytes: 30 * 1024 * 1024,
            defaultHeaders: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }
          },
          bff: { allowedOrigins: [] },
          'external-photo': { allowedOrigins: [] }
        },
        ...(options.wait ? { wait: options.wait } : {})
      }),
      options
    );
  }

  async call(method: string, parameters: Readonly<Record<string, unknown>>): Promise<AlibabaCallResult> {
    const maxAttempts = Math.max(1, Math.min(3, this.#options.maxAttempts ?? 1));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const body = new URLSearchParams(createAlibabaRequest(this.#credentials, method, parameters));
        const response = await this.#network.request({
          service: 'alibaba',
          url: this.#credentials.endpoint,
          method: 'POST',
          body,
          responseType: 'json',
          ...(this.#options.requestId ? { requestId: this.#options.requestId } : {})
        });
        const transport = getTransportError(response);
        if (transport) throw new GatewayException(transport);
        const apiError = getAlibabaError(response.data);
        if (apiError) throw new GatewayException(apiError);
        return { method, data: response.data };
      } catch (error: unknown) {
        const normalized = normalizeGatewayError(error);
        const retry =
          attempt < maxAttempts &&
          normalized.retryable &&
          (this.#options.shouldRetry?.(method, normalized, attempt) ?? false);
        if (!retry) throw new GatewayException(normalized);
        await (this.#options.wait ?? wait)(250 * 2 ** (attempt - 1));
      }
    }
    throw new GatewayException({ code: 'RETRY_EXHAUSTED', message: '请求重试已耗尽', retryable: false });
  }
}

function getTransportError(response: NetworkResponse): GatewayError | null {
  if (response.ok) return null;
  if (response.status === 401) {
    return { code: 'AUTHENTICATION_FAILED', message: '上游认证失败', retryable: false };
  }
  if (response.status === 403) {
    return { code: 'PERMISSION_DENIED', message: '上游拒绝访问', retryable: false };
  }
  if (response.status === 429) {
    return { code: 'RATE_LIMITED', message: '上游请求频率受限', retryable: true };
  }
  if (response.status >= 500) {
    return { code: 'UPSTREAM_UNAVAILABLE', message: '上游服务暂时不可用', retryable: true };
  }
  return { code: 'NETWORK_ERROR', message: `上游返回 HTTP ${response.status}`, retryable: false };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getAlibabaError(value: unknown): GatewayError | null {
  if (typeof value !== 'object' || value === null || !('error_response' in value)) return null;
  const response = value.error_response;
  if (typeof response !== 'object' || response === null) {
    return { code: 'ALIBABA_ERROR', message: 'Alibaba API 返回错误', retryable: false };
  }
  const code = 'code' in response ? String(response.code) : 'ALIBABA_ERROR';
  const message =
    ('sub_msg' in response && typeof response.sub_msg === 'string' && response.sub_msg) ||
    ('msg' in response && typeof response.msg === 'string' && response.msg) ||
    'Alibaba API 返回错误';
  return {
    code,
    message,
    ...('sub_code' in response && typeof response.sub_code === 'string'
      ? { subCode: response.sub_code }
      : {}),
    ...('request_id' in response && typeof response.request_id === 'string'
      ? { traceId: response.request_id }
      : {}),
    retryable: false
  };
}
