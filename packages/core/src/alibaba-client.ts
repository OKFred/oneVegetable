import axios, { type AxiosInstance } from 'axios';

import { GatewayException, normalizeGatewayError } from './errors';
import { createAlibabaRequest } from './signing';
import type { GatewayCredentials, GatewayError } from './types';

export interface AlibabaCallResult {
  method: string;
  data: unknown;
  traceId?: string;
}

export class AlibabaClient {
  readonly #http: AxiosInstance;
  readonly #credentials: GatewayCredentials;

  constructor(credentials: GatewayCredentials, http: AxiosInstance = axios.create({ timeout: 30_000 })) {
    this.#credentials = credentials;
    this.#http = http;
  }

  async call(method: string, parameters: Readonly<Record<string, unknown>>): Promise<AlibabaCallResult> {
    const body = new URLSearchParams(createAlibabaRequest(this.#credentials, method, parameters));
    try {
      const response = await this.#http.post<unknown>(this.#credentials.endpoint, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }
      });
      const apiError = getAlibabaError(response.data);
      if (apiError) throw new GatewayException(apiError);
      return { method, data: response.data };
    } catch (error: unknown) {
      if (error instanceof GatewayException) throw error;
      const normalized: GatewayError = normalizeGatewayError(error);
      throw new GatewayException(normalized);
    }
  }
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
