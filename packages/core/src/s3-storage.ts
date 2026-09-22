import { AwsClient } from 'aws4fetch';
import { assertMp4Header } from './video-upload';
import { assertMultipartContainer, multipartScalar, parseMultipartXml } from './s3-multipart-xml';
import type { GalleryRequestOptions } from './gallery-transfer-context';
import type { VideoUploadControl } from './video-upload';

import { NativeFetchTransport, NetworkManager, type NetworkTransport } from './network';

const MAX_GALLERY_OBJECT_BYTES = 5 * 1024 * 1024;
const MAX_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface S3StorageConfiguration {
  allowInsecureLocal?: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  pathStyle: boolean;
  rootPrefix: string;
}

export interface S3StorageConfigurationSummary {
  configured: boolean;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  accessKeyIdSuffix: string | null;
  hasSessionToken: boolean;
  pathStyle: boolean | null;
  rootPrefix: string | null;
  revision: number | null;
  updateTimeUtc: number | null;
  updaterId: string | null;
  remark: string | null;
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

export interface S3MultipartPart {
  partNumber: number;
  size: number;
  etag: string;
  checksumSha256: string | null;
}

/** Shared by the BFF and the trusted extension service worker. */
export interface S3StorageControl {
  videoUpload?: VideoUploadControl['videoUpload'];
  s3StorageConfiguration(): Promise<S3StorageConfigurationSummary>;
  updateS3StorageConfiguration(
    configuration: S3StorageConfiguration,
    revision: number | null,
    remark?: string | null
  ): Promise<S3StorageConfigurationSummary>;
  clearS3StorageConfiguration(revision: number): Promise<void>;
  testS3StorageConnection(): Promise<{ connected: boolean; visibleObjectCount: number }>;
  listS3Objects(
    input?: {
      prefix?: string;
      continuationToken?: string;
      maximum?: number;
    },
    options?: GalleryRequestOptions
  ): Promise<S3ObjectPage>;
  getS3Object(key: string, options?: GalleryRequestOptions): Promise<S3ObjectContent>;
  putS3Object(
    input: {
      key: string;
      bytes: Uint8Array;
      contentType: string;
    },
    options?: GalleryRequestOptions
  ): Promise<{ key: string; etag: string | null }>;
}

export function s3PermissionOrigins(configuration: S3StorageConfiguration): string[] {
  const normalized = validateS3StorageConfiguration(configuration);
  const endpoint = new URL(normalized.endpoint);
  if (!normalized.pathStyle) endpoint.hostname = `${normalized.bucket}.${endpoint.hostname}`;
  return [`${endpoint.origin}/*`];
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

  /** Video-only caller owns the task/key. The ordinary gallery object limit remains 5 MiB. */
  async createMultipart(key: string, requestId: string): Promise<string> {
    const url = this.#multipartUrl(key);
    url.searchParams.set('uploads', '');
    const response = await this.#signedRequest(
      url,
      'POST',
      { 'Content-Type': 'video/mp4', 'x-amz-checksum-algorithm': 'SHA256' },
      undefined,
      requestId,
      'text'
    );
    const xml = this.#multipartXml(response);
    const uploadId = xmlText(xml, 'UploadId');
    if (!uploadId || uploadId.length > 2048) throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    return uploadId;
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    bytes: Uint8Array,
    requestId: string
  ): Promise<S3MultipartPart> {
    if (
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > 10 ||
      !bytes.byteLength ||
      bytes.byteLength > MAX_GALLERY_OBJECT_BYTES
    )
      throw new Error('VIDEO_PART_INVALID');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
    const checksumSha256 = btoa(String.fromCharCode(...digest));
    const url = this.#multipartUrl(key, uploadId);
    url.searchParams.set('partNumber', String(partNumber));
    const response = await this.#signedRequest(
      url,
      'PUT',
      { 'x-amz-checksum-sha256': checksumSha256 },
      bytes,
      requestId,
      'text'
    );
    if (!response.ok) throw s3HttpError(response.status);
    const etag = normalizeEtag(response.headers.get('etag'));
    if (!etag) throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    return { partNumber, size: bytes.byteLength, etag, checksumSha256 };
  }

  /** null means a validated HTTP 404 + NoSuchUpload, never a generic 404 or an empty list. */
  async listParts(key: string, uploadId: string, requestId: string): Promise<S3MultipartPart[] | null> {
    const response = await this.#signedRequest(
      this.#multipartUrl(key, uploadId),
      'GET',
      undefined,
      undefined,
      requestId,
      'text'
    );
    if (this.#isNoSuchUpload(response, key, uploadId)) return null;
    const root = parseMultipartXml(this.#multipartXml(response));
    assertMultipartContainer(root, 'ListPartsResult');
    if (
      multipartScalar(root, 'Bucket') !== this.#configuration.bucket ||
      multipartScalar(root, 'Key') !==
        joinS3Key(this.#configuration.rootPrefix, normalizeS3Key(key, false)) ||
      multipartScalar(root, 'UploadId') !== uploadId
    )
      throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    if (multipartScalar(root, 'IsTruncated') !== 'false' || multipartScalar(root, 'PartNumberMarker') !== '0')
      throw new Error('S3_PAGINATION_INCOMPLETE');
    const maximum = multipartScalar(root, 'MaxParts');
    if (!maximum || !/^[1-9][0-9]*$/u.test(maximum) || Number(maximum) > 1000)
      throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    const parts = root.children
      .filter((node) => node.name === 'Part')
      .map((block) => {
        assertMultipartContainer(block, 'Part');
        const rawPartNumber = multipartScalar(block, 'PartNumber');
        const rawSize = multipartScalar(block, 'Size');
        const partNumber = Number(rawPartNumber);
        const size = Number(rawSize);
        const etag = normalizeEtag(multipartScalar(block, 'ETag'));
        const checksumSha256 = multipartScalar(block, 'ChecksumSHA256', false);
        if (
          !rawPartNumber ||
          !/^[1-9][0-9]*$/u.test(rawPartNumber) ||
          !rawSize ||
          !/^[1-9][0-9]*$/u.test(rawSize) ||
          !Number.isSafeInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > 10 ||
          !Number.isSafeInteger(size) ||
          size < 1 ||
          size > MAX_GALLERY_OBJECT_BYTES ||
          !etag ||
          (checksumSha256 !== null && !/^[A-Za-z0-9+/]{43}=$/u.test(checksumSha256))
        )
          throw new Error('S3_MULTIPART_RESPONSE_INVALID');
        return { partNumber, size, etag, checksumSha256 };
      });
    const next = multipartScalar(root, 'NextPartNumberMarker', false);
    if (
      parts.length > 10 ||
      parts.length > Number(maximum) ||
      new Set(parts.map((part) => part.partNumber)).size !== parts.length ||
      parts.some((part, index) => index > 0 && part.partNumber <= (parts[index - 1]?.partNumber ?? 0)) ||
      (next !== null &&
        (!/^(?:0|[1-9][0-9]*)$/u.test(next) || Number(next) > (parts.at(-1)?.partNumber ?? 0)))
    )
      throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    return parts;
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: readonly S3MultipartPart[],
    requestId: string
  ): Promise<void> {
    const xml = `<CompleteMultipartUpload>${parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag>${part.checksumSha256 ? `<ChecksumSHA256>${escapeXml(part.checksumSha256)}</ChecksumSHA256>` : ''}</Part>`).join('')}</CompleteMultipartUpload>`;
    const response = await this.#signedRequest(
      this.#multipartUrl(key, uploadId),
      'POST',
      { 'Content-Type': 'application/xml' },
      new TextEncoder().encode(xml),
      requestId,
      'text'
    );
    const result = this.#multipartXml(response);
    // S3 may return an embedded Error even with HTTP 200.
    if (!result.includes('<CompleteMultipartUploadResult')) throw new Error('S3_MULTIPART_RESPONSE_INVALID');
  }

  async abortMultipart(key: string, uploadId: string, requestId: string): Promise<void> {
    const response = await this.#signedRequest(
      this.#multipartUrl(key, uploadId),
      'DELETE',
      undefined,
      undefined,
      requestId,
      'text'
    );
    if (response.status !== 204 && !this.#isNoSuchUpload(response, key, uploadId))
      throw s3HttpError(response.status);
  }

  async headVideoObject(
    key: string,
    requestId: string
  ): Promise<{ size: number; etag: string | null } | null> {
    const response = await this.#signedRequest(
      this.#multipartUrl(key),
      'HEAD',
      undefined,
      undefined,
      requestId,
      'text'
    );
    if (response.status === 404) return null;
    if (!response.ok) throw s3HttpError(response.status);
    const rawSize = response.headers.get('content-length');
    const size = rawSize === null ? NaN : Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 1 || size > 50 * 1024 * 1024)
      throw new Error('VIDEO_FILE_INVALID');
    return { size, etag: normalizeEtag(response.headers.get('etag')) };
  }

  async getVideoRange(key: string, start: number, end: number, requestId: string): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end - start + 1 > MAX_GALLERY_OBJECT_BYTES
    )
      throw new Error('VIDEO_PART_INVALID');
    const response = await this.#signedRequest(
      this.#multipartUrl(key),
      'GET',
      { Range: `bytes=${start}-${end}` },
      undefined,
      requestId,
      'bytes'
    );
    if (
      response.status !== 206 ||
      !(response.data instanceof Uint8Array) ||
      response.data.byteLength !== end - start + 1
    )
      throw new Error('S3_RANGE_RESPONSE_INVALID');
    return response.data;
  }

  /** Never expose or persist this short-lived credential. Sign the configured public endpoint itself. */
  async presignVideoGet(key: string): Promise<string> {
    const url = this.#multipartUrl(key);
    if (
      url.protocol !== 'https:' ||
      isPrivateS3Host(url.hostname) ||
      /^(?:localhost|127\.|\[?::1\]?)/u.test(url.hostname)
    )
      throw new Error('VIDEO_PUBLIC_SOURCE_REQUIRED');
    url.searchParams.set('X-Amz-Expires', '1800');
    const signed = await this.#signer.sign(url, { method: 'GET', aws: { signQuery: true } });
    return signed.url;
  }

  /** Anonymous, bounded range check before asking Alibaba to fetch a completed private object. */
  async checkPresignedVideoGet(url: string, requestId: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.origin !== this.#bucketOrigin() || parsed.protocol !== 'https:')
      throw new Error('VIDEO_PUBLIC_SOURCE_REQUIRED');
    const response = await this.#network.request({
      service: 's3',
      url,
      method: 'GET',
      requestId,
      responseType: 'bytes',
      headers: { Range: 'bytes=0-4095' },
      maxAttempts: 1
    });
    if (
      response.status !== 206 ||
      !(response.data instanceof Uint8Array) ||
      response.data.length < 16 ||
      response.data.length > 4096
    )
      throw new Error('VIDEO_PUBLIC_SOURCE_UNREADABLE');
    assertMp4Header(response.data);
  }

  #multipartUrl(key: string, uploadId?: string): URL {
    const url = this.#objectUrl(joinS3Key(this.#configuration.rootPrefix, normalizeS3Key(key, false)));
    if (uploadId) url.searchParams.set('uploadId', uploadId);
    return url;
  }

  #multipartXml(response: { ok: boolean; status: number; data: unknown }): string {
    if (!response.ok) throw s3HttpError(response.status);
    if (typeof response.data !== 'string' || /<!DOCTYPE|<!ENTITY|<Error[ >]/iu.test(response.data))
      throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    return response.data;
  }

  #isNoSuchUpload(response: { status: number; data: unknown }, key: string, uploadId: string): boolean {
    if (response.status !== 404 || typeof response.data !== 'string') return false;
    const root = parseMultipartXml(response.data);
    assertMultipartContainer(root, 'Error');
    if (multipartScalar(root, 'Code') !== 'NoSuchUpload') return false;
    // Error responses may omit target fields; present identifiers must agree with the signed request.
    const expected = {
      Bucket: this.#configuration.bucket,
      Key: joinS3Key(this.#configuration.rootPrefix, normalizeS3Key(key, false)),
      UploadId: uploadId
    };
    for (const [field, value] of Object.entries(expected)) {
      const actual = multipartScalar(root, field, false);
      if (actual !== null && actual !== value) throw new Error('S3_MULTIPART_RESPONSE_INVALID');
    }
    return true;
  }

  async #signedRequest(
    url: URL,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD',
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

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function validateS3StorageConfiguration(value: S3StorageConfiguration): S3StorageConfiguration {
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error('S3 Endpoint 地址无效');
  }
  if (
    (endpoint.protocol !== 'https:' &&
      !(
        value.allowInsecureLocal === true &&
        value.pathStyle &&
        endpoint.protocol === 'http:' &&
        isPrivateS3Host(endpoint.hostname)
      )) ||
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
    rootPrefix: normalizeS3Key(value.rootPrefix, true),
    ...(value.allowInsecureLocal === true ? { allowInsecureLocal: true } : {})
  };
}

export function parseS3StorageConfiguration(value: unknown): S3StorageConfiguration {
  if (!isRecord(value)) throw new Error('S3 配置格式无效');
  const sessionToken = value.sessionToken;
  if (
    typeof value.endpoint !== 'string' ||
    typeof value.region !== 'string' ||
    typeof value.bucket !== 'string' ||
    typeof value.accessKeyId !== 'string' ||
    typeof value.secretAccessKey !== 'string' ||
    !(sessionToken === null || typeof sessionToken === 'string') ||
    typeof value.pathStyle !== 'boolean' ||
    typeof value.rootPrefix !== 'string' ||
    (value.allowInsecureLocal !== undefined && typeof value.allowInsecureLocal !== 'boolean')
  ) {
    throw new Error('S3 配置字段无效');
  }
  return validateS3StorageConfiguration({
    endpoint: value.endpoint,
    region: value.region,
    bucket: value.bucket,
    accessKeyId: value.accessKeyId,
    secretAccessKey: value.secretAccessKey,
    sessionToken,
    pathStyle: value.pathStyle,
    rootPrefix: value.rootPrefix,
    ...(value.allowInsecureLocal === true ? { allowInsecureLocal: true } : {})
  });
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
  if (truncated && !token) throw new Error('S3_PAGINATION_INCOMPLETE');
  return { items, nextContinuationToken: truncated && token ? token : null };
}

export function isPrivateS3Host(host: string): boolean {
  // Literal RFC1918 IPv4 only: no DNS rebinding, loopback, link-local or metadata targets.
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255))
    return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
