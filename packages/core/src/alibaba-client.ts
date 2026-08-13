import type { AxiosInstance } from 'axios';

import { GatewayException, normalizeGatewayError } from './errors';
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
}

export class AlibabaClient {
  readonly #http: AxiosInstance;
  readonly #credentials: GatewayCredentials;
  readonly #options: AlibabaClientOptions;

  constructor(credentials: GatewayCredentials, http: AxiosInstance, options: AlibabaClientOptions = {}) {
    this.#credentials = credentials;
    this.#http = http;
    this.#options = options;
  }

  static async create(
    credentials: GatewayCredentials,
    options: AlibabaClientOptions = {}
  ): Promise<AlibabaClient> {
    const { default: axios } = await import('axios');
    return new AlibabaClient(credentials, axios.create({ timeout: 30_000 }), options);
  }

  async call(method: string, parameters: Readonly<Record<string, unknown>>): Promise<AlibabaCallResult> {
    const maxAttempts = Math.max(1, Math.min(3, this.#options.maxAttempts ?? 1));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const body = new URLSearchParams(createAlibabaRequest(this.#credentials, method, parameters));
        const response = await this.#http.post<unknown>(this.#credentials.endpoint, body, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }
        });
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
