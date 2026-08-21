import { GatewayException, normalizeGatewayError } from './errors';
import { NetworkManager, type NetworkResponse } from './network';
import { createAlibabaRequest, createAlibabaSyncRequest } from './signing';
import type { GatewayCredentials, GatewayError } from './types';

export interface AlibabaCallResult {
  method: string;
  data: unknown;
  traceId?: string;
}

export interface AlibabaFilePart {
  fieldName: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface AlibabaClientOptions {
  maxAttempts?: number;
  shouldRetry?: (method: string, error: GatewayError, attempt: number) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  requestId?: string;
  protocol?: 'top' | 'sync';
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
            maxResponseBytes: 30 * 1024 * 1024
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
        const requestParameters =
          this.#options.protocol === 'sync'
            ? createAlibabaSyncRequest(this.#credentials, method, parameters)
            : createAlibabaRequest(this.#credentials, method, parameters);
        const body = new URLSearchParams(requestParameters);
        const response = await this.#network.request({
          service: 'alibaba',
          url: this.#credentials.endpoint,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
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

  async callWithFile(
    method: string,
    parameters: Readonly<Record<string, unknown>>,
    file: AlibabaFilePart
  ): Promise<AlibabaCallResult> {
    const bytes = new Uint8Array(file.bytes);
    const signedParameters = createAlibabaRequest(this.#credentials, method, parameters);
    const multipart = encodeMultipartBody(signedParameters, file, bytes);

    const response = await this.#network.request({
      service: 'alibaba',
      url: this.#credentials.endpoint,
      method: 'POST',
      headers: { 'Content-Type': multipart.contentType },
      body: multipart.body,
      bodySizeBytes: multipart.body.byteLength,
      responseType: 'text',
      ...(this.#options.requestId ? { requestId: this.#options.requestId } : {})
    });
    if (!response.ok) {
      throw multipartTransportError(response);
    }
    const transport = getTransportError(response);
    if (transport) throw new GatewayException(transport);
    const data = parseMultipartJson(response.data, response.headers);
    const apiError = getAlibabaError(data);
    if (apiError) throw new GatewayException(apiError);
    return { method, data };
  }
}

function encodeMultipartBody(
  fields: Readonly<Record<string, string>>,
  file: AlibabaFilePart,
  bytes: Uint8Array
): { body: ArrayBuffer; contentType: string } {
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.contentType)) {
    throw new Error('multipart 文件 Content-Type 无效');
  }
  const boundary = `----oneVegetable${crypto.randomUUID().replaceAll('-', '')}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${multipartToken(name)}"\r\n\r\n${value}\r\n`
      )
    );
  }
  chunks.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${multipartToken(file.fieldName)}"; filename="${multipartToken(file.fileName)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
    ),
    bytes,
    encoder.encode(`\r\n--${boundary}--\r\n`)
  );
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new ArrayBuffer(size);
  const output = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function multipartToken(value: string): string {
  return value.replace(/["\r\n]/g, '_');
}

function multipartTransportError(response: NetworkResponse): GatewayException {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'unknown';
  return new GatewayException({
    code: response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'NETWORK_ERROR',
    message: `Alibaba 文件上传返回 HTTP ${response.status}（${contentType}）`,
    retryable: response.status >= 500 || response.status === 429
  });
}

function parseMultipartJson(value: unknown, headers: Headers): unknown {
  if (typeof value !== 'string') {
    throw new GatewayException({
      code: 'INVALID_JSON_RESPONSE',
      message: 'Alibaba 文件上传响应格式无效',
      retryable: false
    });
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    const contentType = headers.get('content-type')?.split(';')[0]?.trim() ?? 'unknown';
    throw new GatewayException({
      code: 'INVALID_JSON_RESPONSE',
      message: `Alibaba 文件上传响应不是 JSON（Content-Type: ${contentType}）`,
      retryable: false
    });
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
