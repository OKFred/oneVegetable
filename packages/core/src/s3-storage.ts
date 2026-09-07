import { AwsClient } from 'aws4fetch';

import { NativeFetchTransport, NetworkManager, type NetworkTransport } from './network';

const MAX_GALLERY_OBJECT_BYTES = 5 * 1024 * 1024;
const MAX_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface S3StorageConfiguration {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  pathStyle: boolean;
  rootPrefix: string;
}

export interface S3ObjectSummary {
  key: string;
  size: number;
  etag: string | null;
  lastModifiedTimeUtc: number | null;
}

export interface S3ObjectPage {
  items: S3ObjectSummary[];
  nextContinuationToken: string | null;
}

export interface S3ObjectContent {
  key: string;
  bytes: Uint8Array;
  contentType: string | null;
  etag: string | null;
}

export class S3ObjectStorageClient {
  readonly #configuration: S3StorageConfiguration;
  readonly #signer: AwsClient;
  readonly #network: NetworkManager;

  constructor(configuration: S3StorageConfiguration, transport?: NetworkTransport) {
    this.#configuration = validateS3StorageConfiguration(configuration);
    this.#signer = new AwsClient({
      accessKeyId: this.#configuration.accessKeyId,
      secretAccessKey: this.#configuration.secretAccessKey,
      ...(this.#configuration.sessionToken ? { sessionToken: this.#configuration.sessionToken } : {}),
      service: 's3',
      region: this.#configuration.region,
      retries: 0
    });
    const endpointOrigin = new URL(this.#configuration.endpoint).origin;
    this.#network = new NetworkManager({
      transport: transport ?? new NativeFetchTransport(),
      policies: {
        s3: {
          allowedOrigins: [endpointOrigin, this.#bucketOrigin()],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: MAX_GALLERY_OBJECT_BYTES,
          maxResponseBytes: Math.max(MAX_GALLERY_OBJECT_BYTES, MAX_LIST_RESPONSE_BYTES),
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store'
        }
      }
    });
  }

  async listObjects(input: {
    prefix?: string;
    continuationToken?: string;
    maximum?: number;
    requestId?: string;
  }): Promise<S3ObjectPage> {
    const url = this.#bucketUrl();
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', String(Math.max(1, Math.min(1000, input.maximum ?? 100))));
    const prefix = joinS3Key(this.#configuration.rootPrefix, input.prefix ?? '');
    if (prefix) url.searchParams.set('prefix', prefix);
    if (input.continuationToken) url.searchParams.set('continuation-token', input.continuationToken);
    const response = await this.#signedRequest(url, 'GET', undefined, undefined, input.requestId, 'text');
    if (!response.ok || typeof response.data !== 'string') throw s3HttpError(response.status);
    const page = parseListObjectsV2(response.data);
    const rootPrefix = this.#configuration.rootPrefix;
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        key: stripRootPrefix(item.key, rootPrefix)
      }))
    };
  }

  async getObject(key: string, requestId?: string): Promise<S3ObjectContent> {
    const normalizedKey = joinS3Key(this.#configuration.rootPrefix, normalizeS3Key(key, false));
    const response = await this.#signedRequest(
      this.#objectUrl(normalizedKey),
      'GET',
      undefined,
      undefined,
      requestId,
      'bytes'
    );
    if (!response.ok || !(response.data instanceof Uint8Array)) throw s3HttpError(response.status);
    return {
      key,
      bytes: response.data,
      contentType: response.headers.get('content-type')?.split(';')[0]?.trim().toLocaleLowerCase() ?? null,
      etag: normalizeEtag(response.headers.get('etag'))
    };
  }

  async putObject(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    requestId?: string;
  }): Promise<{ etag: string | null }> {
    if (input.bytes.byteLength > MAX_GALLERY_OBJECT_BYTES) throw new Error('S3 图库对象不能超过 5 MiB');
    const normalizedKey = joinS3Key(this.#configuration.rootPrefix, normalizeS3Key(input.key, false));
    const body = Uint8Array.from(input.bytes);
    const response = await this.#signedRequest(
      this.#objectUrl(normalizedKey),
      'PUT',
      { 'Content-Type': input.contentType },
      body,
      input.requestId,
      'text'
    );
    if (!response.ok) throw s3HttpError(response.status);
    return { etag: normalizeEtag(response.headers.get('etag')) };
  }

  async #signedRequest(
    url: URL,
    method: 'GET' | 'PUT',
    headers: Record<string, string> | undefined,
    body: Uint8Array | undefined,
    requestId: string | undefined,
    responseType: 'text' | 'bytes'
  ) {
    const signed = await this.#signer.sign(url, {
      method,
      ...(headers ? { headers } : {}),
      ...(body ? { body: Uint8Array.from(body) } : {})
    });
    return this.#network.request({
      service: 's3',
      url: signed.url,
      method,
      headers: Object.fromEntries(signed.headers.entries()),
      ...(body ? { body: Uint8Array.from(body), bodySizeBytes: body.byteLength } : {}),
      ...(requestId ? { requestId } : {}),
      responseType,
      maxAttempts: 1
    });
  }

  #bucketUrl(): URL {
    const endpoint = new URL(this.#configuration.endpoint);
    if (this.#configuration.pathStyle) {
      endpoint.pathname = `/${encodeURIComponent(this.#configuration.bucket)}`;
      return endpoint;
    }
    endpoint.hostname = `${this.#configuration.bucket}.${endpoint.hostname}`;
    return endpoint;
  }

  #objectUrl(key: string): URL {
    const url = this.#bucketUrl();
    url.pathname = `${url.pathname.replace(/\/$/u, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
    return url;
  }

  #bucketOrigin(): string {
    return this.#bucketUrl().origin;
  }
}

export function validateS3StorageConfiguration(value: S3StorageConfiguration): S3StorageConfiguration {
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error('S3 Endpoint 地址无效');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('S3 Endpoint 必须是无凭据、Query 和 Fragment 的 HTTPS 地址');
  }
  if (endpoint.pathname !== '/' && endpoint.pathname !== '') throw new Error('S3 Endpoint 不能包含路径');
  const bucket = value.bucket.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) throw new Error('S3 Bucket 名称无效');
  const region = value.region.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(region)) throw new Error('S3 Region 无效');
  const accessKeyId = value.accessKeyId.trim();
  if (!accessKeyId || !value.secretAccessKey) throw new Error('S3 访问密钥不完整');
  return {
    endpoint: endpoint.origin,
    region,
    bucket,
    accessKeyId,
    secretAccessKey: value.secretAccessKey,
    sessionToken: value.sessionToken?.trim() ? value.sessionToken.trim() : null,
    pathStyle: value.pathStyle,
    rootPrefix: normalizeS3Key(value.rootPrefix, true)
  };
}

function parseListObjectsV2(xml: string): S3ObjectPage {
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)].map((match) => {
    const block = match[1] ?? '';
    const key = xmlText(block, 'Key');
    const size = Number(xmlText(block, 'Size'));
    if (!key || !Number.isSafeInteger(size) || size < 0) throw new Error('S3 对象列表响应无效');
    const modified = Date.parse(xmlText(block, 'LastModified'));
    return {
      key,
      size,
      etag: normalizeEtag(xmlText(block, 'ETag')),
      lastModifiedTimeUtc: Number.isFinite(modified) ? modified : null
    };
  });
  const truncated = xmlText(xml, 'IsTruncated').toLocaleLowerCase() === 'true';
  const token = xmlText(xml, 'NextContinuationToken');
  return { items, nextContinuationToken: truncated && token ? token : null };
}

function xmlText(xml: string, tag: string): string {
  const escapedTag = tag.replace(/[^A-Za-z0-9]/gu, '');
  const match = new RegExp(`<${escapedTag}>([\\s\\S]*?)</${escapedTag}>`, 'u').exec(xml)?.[1] ?? '';
  return decodeXml(match.trim());
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function normalizeS3Key(value: string, allowEmpty: boolean): string {
  const key = value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/gu, '');
  if (
    (!allowEmpty && !key) ||
    key.includes('\0') ||
    key.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('S3 对象路径无效');
  }
  return key;
}

function joinS3Key(left: string, right: string): string {
  return [left, right].filter(Boolean).join('/');
}

function stripRootPrefix(key: string, rootPrefix: string): string {
  if (!rootPrefix) return key;
  const prefix = `${rootPrefix}/`;
  if (!key.startsWith(prefix)) throw new Error('S3 返回了根目录之外的对象');
  return key.slice(prefix.length);
}

function normalizeEtag(value: string | null): string | null {
  const normalized = value?.trim().replace(/^"|"$/gu, '') ?? '';
  return normalized.length > 0 ? normalized : null;
}

function s3HttpError(status: number): Error {
  return new Error(`S3 请求失败（HTTP ${status}）`);
}
