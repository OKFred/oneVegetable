import { GatewayException } from './errors';

export type NetworkServiceId = 'alibaba' | 'bff' | 'external-photo';
export type NetworkResponseType = 'json' | 'text' | 'bytes';

export interface NetworkTransport {
  send(input: RequestInfo | URL, init: RequestInit): Promise<Response>;
}

export class NativeFetchTransport implements NetworkTransport {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch) {
    this.#fetch = (input, init) => Reflect.apply(fetcher, globalThis, [input, init]);
  }

  send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    return this.#fetch(input, init);
  }
}

export interface NetworkServicePolicy {
  allowedOrigins?: readonly string[];
  allowUrl?: (url: URL) => boolean;
  timeoutMilliseconds?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  defaultHeaders?: Readonly<Record<string, string>>;
  credentials?: RequestCredentials;
  redirect?: RequestRedirect;
}

export interface NetworkRequest {
  service: NetworkServiceId;
  url: string | URL;
  requestId?: string;
  method?: 'GET' | 'POST';
  headers?: Readonly<Record<string, string>>;
  body?: BodyInit | null;
  responseType?: NetworkResponseType;
  signal?: AbortSignal;
  maxAttempts?: number;
  retry?: (response: NetworkResponse, attempt: number) => boolean;
  acceptStatuses?: readonly number[];
}

export interface NetworkResponse {
  requestId: string;
  status: number;
  ok: boolean;
  headers: Headers;
  data: unknown;
  attempt: number;
  durationMilliseconds: number;
}

export interface NetworkLogEntry {
  requestId: string;
  service: NetworkServiceId;
  method: string;
  origin: string;
  statusCode: number;
  attempt: number;
  durationMilliseconds: number;
  outcome: 'success' | 'error';
}

export interface NetworkManagerOptions {
  transport?: NetworkTransport;
  policies: Readonly<Record<NetworkServiceId, NetworkServicePolicy>>;
  clock?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  logger?: (entry: NetworkLogEntry) => void;
}

export const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && REQUEST_ID_PATTERN.test(value);
}

export class NetworkManager {
  readonly #transport: NetworkTransport;
  readonly #policies: Readonly<Record<NetworkServiceId, NetworkServicePolicy>>;
  readonly #clock: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #logger: ((entry: NetworkLogEntry) => void) | undefined;

  constructor(options: NetworkManagerOptions) {
    this.#transport = options.transport ?? new NativeFetchTransport();
    this.#policies = options.policies;
    this.#clock = options.clock ?? Date.now;
    this.#wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
    this.#logger = options.logger;
  }

  async request(input: NetworkRequest): Promise<NetworkResponse> {
    const requestId = input.requestId ?? createRequestId();
    if (!isRequestId(requestId)) {
      throw new GatewayException({
        code: 'INVALID_REQUEST_ID',
        message: 'requestId 必须是 UUID v4',
        retryable: false
      });
    }
    const url = new URL(input.url);
    const policy = this.#policies[input.service];
    assertAllowedUrl(url, policy);
    assertRequestSize(input.body, policy.maxRequestBytes);

    const maxAttempts = Math.max(1, Math.min(3, input.maxAttempts ?? 1));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = this.#clock();
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, policy.timeoutMilliseconds ?? 30_000);
      const combinedSignal = combineSignals(input.signal, controller.signal);
      try {
        const response = await this.#transport.send(url, {
          method: input.method ?? 'GET',
          ...(input.body !== undefined ? { body: input.body } : {}),
          headers: {
            ...policy.defaultHeaders,
            ...input.headers,
            'X-Request-ID': requestId
          },
          credentials: policy.credentials ?? 'omit',
          redirect: policy.redirect ?? 'error',
          signal: combinedSignal
        });
        const result: NetworkResponse = {
          requestId,
          status: response.status,
          ok: response.ok || (input.acceptStatuses?.includes(response.status) ?? false),
          headers: response.headers,
          data: await readResponse(response, input.responseType ?? 'json', policy.maxResponseBytes),
          attempt,
          durationMilliseconds: Math.max(0, this.#clock() - startedAt)
        };
        this.#log(input, url, result);
        if (attempt < maxAttempts && input.retry?.(result, attempt)) {
          await this.#wait(250 * 2 ** (attempt - 1));
          continue;
        }
        return result;
      } catch (error: unknown) {
        const durationMilliseconds = Math.max(0, this.#clock() - startedAt);
        this.#logger?.({
          requestId,
          service: input.service,
          method: input.method ?? 'GET',
          origin: url.origin,
          statusCode: 0,
          attempt,
          durationMilliseconds,
          outcome: 'error'
        });
        if (isAbortError(error)) {
          throw new GatewayException({
            code: 'REQUEST_TIMEOUT',
            message: '网络请求超时或已取消',
            retryable: true
          });
        }
        if (attempt < maxAttempts) {
          await this.#wait(250 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new GatewayException({ code: 'RETRY_EXHAUSTED', message: '请求重试已耗尽', retryable: false });
  }

  #log(input: NetworkRequest, url: URL, response: NetworkResponse): void {
    this.#logger?.({
      requestId: response.requestId,
      service: input.service,
      method: input.method ?? 'GET',
      origin: url.origin,
      statusCode: response.status,
      attempt: response.attempt,
      durationMilliseconds: response.durationMilliseconds,
      outcome: response.ok ? 'success' : 'error'
    });
  }
}

function assertAllowedUrl(url: URL, policy: NetworkServicePolicy): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GatewayException({
      code: 'NETWORK_URL_DENIED',
      message: '网络请求仅允许 HTTP(S)',
      retryable: false
    });
  }
  const allowedByOrigin = policy.allowedOrigins?.includes(url.origin) ?? false;
  const allowedByPredicate = policy.allowUrl?.(url) ?? false;
  if (!allowedByOrigin && !allowedByPredicate) {
    throw new GatewayException({
      code: 'NETWORK_URL_DENIED',
      message: `网络请求目标 ${url.origin} 不在允许列表`,
      retryable: false
    });
  }
}

function assertRequestSize(body: BodyInit | null | undefined, maxBytes: number | undefined): void {
  if (maxBytes === undefined || body === undefined || body === null) return;
  let bytes: number | undefined;
  if (typeof body === 'string') bytes = new TextEncoder().encode(body).byteLength;
  else if (body instanceof URLSearchParams) bytes = new TextEncoder().encode(body.toString()).byteLength;
  else if (body instanceof ArrayBuffer) bytes = body.byteLength;
  else if (ArrayBuffer.isView(body)) bytes = body.byteLength;
  else if (body instanceof Blob) bytes = body.size;
  if (bytes !== undefined && bytes > maxBytes) {
    throw new GatewayException({
      code: 'NETWORK_REQUEST_TOO_LARGE',
      message: `请求体超过 ${maxBytes} 字节限制`,
      retryable: false
    });
  }
}

async function readResponse(
  response: Response,
  responseType: NetworkResponseType,
  maxBytes = 10 * 1024 * 1024
): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new GatewayException({
      code: 'NETWORK_RESPONSE_TOO_LARGE',
      message: `响应体超过 ${maxBytes} 字节限制`,
      retryable: false
    });
  }
  const bytes = await readBoundedBytes(response, maxBytes);
  if (responseType === 'bytes') return bytes;
  const text = new TextDecoder().decode(bytes);
  if (responseType === 'text') return text;
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GatewayException({
      code: 'INVALID_JSON_RESPONSE',
      message: '上游响应不是有效 JSON',
      retryable: false
    });
  }
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        throw new GatewayException({
          code: 'NETWORK_RESPONSE_TOO_LARGE',
          message: `响应体超过 ${maxBytes} 字节限制`,
          retryable: false
        });
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function combineSignals(external: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!external) return timeout;
  return AbortSignal.any([external, timeout]);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
