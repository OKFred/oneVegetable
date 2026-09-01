import { GatewayException, META_GRAPH_ORIGIN, NetworkManager } from '@one-vegetable/core';

import type { NetworkResponse, NetworkTransport } from '@one-vegetable/core';

export interface MetaMutationResult {
  id: string;
  requestId: string | null;
  traceId: string | null;
}

export type InstagramContainerStatus =
  | { status: 'finished'; requestId: string | null; traceId: string | null }
  | { status: 'processing'; requestId: string | null; traceId: string | null }
  | { status: 'failed'; requestId: string | null; traceId: string | null };

export class MetaPublisherError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly ambiguous: boolean,
    readonly platformRequestId: string | null,
    readonly platformTraceId: string | null,
    readonly tokenInvalid = false
  ) {
    super(message);
    this.name = 'MetaPublisherError';
  }
}

export class MetaPublisher {
  readonly #network: NetworkManager;

  constructor(transport?: NetworkTransport) {
    this.#network = new NetworkManager({
      ...(transport ? { transport } : {}),
      policies: {
        meta: {
          allowedOrigins: [META_GRAPH_ORIGIN],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 6 * 1024 * 1024,
          maxResponseBytes: 1024 * 1024,
          redirect: 'error'
        }
      }
    });
  }

  publishFacebook(input: {
    graphApiVersion: string;
    pageId: string;
    accessToken: string;
    image: { bytes: Uint8Array; contentType: string; fileName: string };
    caption: string;
    requestId: string;
  }): Promise<MetaMutationResult> {
    const body = new FormData();
    body.set(
      'source',
      new Blob([Uint8Array.from(input.image.bytes).buffer], { type: input.image.contentType }),
      input.image.fileName
    );
    body.set('caption', input.caption);
    body.set('published', 'true');
    body.set('access_token', input.accessToken);
    return this.mutationBody(
      input.graphApiVersion,
      `/${encodeURIComponent(input.pageId)}/photos`,
      body,
      input.image.bytes.byteLength + new TextEncoder().encode(input.caption).byteLength + 4096,
      input.requestId
    );
  }

  createInstagramContainer(input: {
    graphApiVersion: string;
    instagramAccountId: string;
    accessToken: string;
    imageUrl: string;
    caption: string;
    requestId: string;
  }): Promise<MetaMutationResult> {
    return this.mutation(
      input.graphApiVersion,
      `/${encodeURIComponent(input.instagramAccountId)}/media`,
      {
        image_url: input.imageUrl,
        caption: input.caption,
        access_token: input.accessToken
      },
      input.requestId
    );
  }

  publishInstagramContainer(input: {
    graphApiVersion: string;
    instagramAccountId: string;
    accessToken: string;
    containerId: string;
    requestId: string;
  }): Promise<MetaMutationResult> {
    return this.mutation(
      input.graphApiVersion,
      `/${encodeURIComponent(input.instagramAccountId)}/media_publish`,
      { creation_id: input.containerId, access_token: input.accessToken },
      input.requestId
    );
  }

  async readInstagramContainerStatus(input: {
    graphApiVersion: string;
    containerId: string;
    accessToken: string;
    requestId: string;
  }): Promise<InstagramContainerStatus> {
    const url = new URL(
      `/${input.graphApiVersion}/${encodeURIComponent(input.containerId)}`,
      META_GRAPH_ORIGIN
    );
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', input.accessToken);
    const response = await this.request({
      url,
      method: 'GET',
      requestId: input.requestId
    });
    const data = readGraphData(response);
    const statusCode = optionalString(data.status_code)?.toUpperCase();
    const ids = readPlatformIds(response, data);
    if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') {
      return { status: 'finished', ...ids };
    }
    if (statusCode === 'IN_PROGRESS') return { status: 'processing', ...ids };
    return { status: 'failed', ...ids };
  }

  private async mutation(
    graphApiVersion: string,
    path: string,
    parameters: Record<string, string>,
    requestId: string
  ): Promise<MetaMutationResult> {
    const body = new URLSearchParams(parameters);
    return this.mutationBody(
      graphApiVersion,
      path,
      body,
      new TextEncoder().encode(body.toString()).byteLength,
      requestId
    );
  }

  private async mutationBody(
    graphApiVersion: string,
    path: string,
    body: URLSearchParams | FormData,
    bodySizeBytes: number,
    requestId: string
  ): Promise<MetaMutationResult> {
    const url = new URL(`/${graphApiVersion}${path}`, META_GRAPH_ORIGIN);
    const response = await this.request({
      url,
      method: 'POST',
      requestId,
      body,
      bodySizeBytes
    });
    const data = readGraphData(response);
    const ids = readPlatformIds(response, data);
    const id = optionalString(data.post_id) ?? optionalString(data.id);
    if (!id) {
      throw new MetaPublisherError(
        'META_MUTATION_RESPONSE_INVALID',
        'Meta 已响应，但未返回可确认的发布 ID',
        true,
        ids.requestId,
        ids.traceId
      );
    }
    return { id, ...ids };
  }

  private async request(input: {
    url: URL;
    method: 'GET' | 'POST';
    requestId: string;
    body?: URLSearchParams | FormData;
    bodySizeBytes?: number;
  }): Promise<NetworkResponse> {
    try {
      const response = await this.#network.request({
        service: 'meta',
        url: input.url,
        method: input.method,
        requestId: input.requestId,
        ...(input.body ? { body: input.body } : {}),
        ...(input.bodySizeBytes === undefined ? {} : { bodySizeBytes: input.bodySizeBytes }),
        ...(input.body instanceof URLSearchParams
          ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } }
          : {}),
        responseType: 'json',
        maxAttempts: 1
      });
      const data = asRecord(response.data);
      const graphError = isRecord(data.error) ? data.error : null;
      if (!response.ok || graphError) throw explicitGraphError(response, graphError);
      return response;
    } catch (error: unknown) {
      if (error instanceof MetaPublisherError) throw error;
      if (error instanceof GatewayException) {
        throw new MetaPublisherError(
          error.gatewayError.code,
          '无法确认 Meta 是否已收到发布请求，请勿自动重发',
          requestMayHaveReachedPlatform(error.gatewayError.code),
          null,
          error.gatewayError.traceId ?? null
        );
      }
      throw new MetaPublisherError(
        'META_NETWORK_FAILED',
        '无法确认 Meta 是否已收到发布请求，请勿自动重发',
        true,
        null,
        null
      );
    }
  }
}

function explicitGraphError(
  response: NetworkResponse,
  error: Record<string, unknown> | null
): MetaPublisherError {
  const code = optionalInteger(error?.code);
  const subcode = optionalInteger(error?.error_subcode);
  const ids = readPlatformIds(response, error ?? {});
  return new MetaPublisherError(
    `META_GRAPH_${code ?? response.status}${subcode === null ? '' : `_${subcode}`}`,
    'Meta 拒绝了发布请求，请检查目标权限、素材或文案',
    false,
    ids.requestId,
    ids.traceId,
    code === 190
  );
}

function readGraphData(response: NetworkResponse): Record<string, unknown> {
  const data = asRecord(response.data);
  if (!isRecord(response.data)) {
    const ids = readPlatformIds(response, data);
    throw new MetaPublisherError(
      'META_RESPONSE_INVALID',
      'Meta 响应格式无效',
      response.ok,
      ids.requestId,
      ids.traceId
    );
  }
  return data;
}

function readPlatformIds(
  response: NetworkResponse,
  data: Record<string, unknown>
): { requestId: string | null; traceId: string | null } {
  return {
    requestId: response.headers.get('x-fb-request-id'),
    traceId: response.headers.get('x-fb-trace-id') ?? optionalString(data.fbtrace_id)
  };
}

function requestMayHaveReachedPlatform(code: string): boolean {
  return ![
    'INVALID_REQUEST_ID',
    'NETWORK_SERVICE_NOT_CONFIGURED',
    'NETWORK_URL_DENIED',
    'NETWORK_REQUEST_SIZE_INVALID',
    'NETWORK_REQUEST_TOO_LARGE',
    'NETWORK_REDIRECT_DENIED'
  ].includes(code);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}
