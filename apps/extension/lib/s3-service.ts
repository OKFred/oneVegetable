import { decodeBase64, encodeBase64, isRequestId, GatewayException } from '@one-vegetable/core';
import {
  galleryStorageId,
  assertGalleryContextId,
  requireGalleryContext
} from '@one-vegetable/core/gallery-transfer-context';
import {
  parseS3StorageConfiguration,
  s3PermissionOrigins,
  S3ObjectStorageClient,
  type S3StorageConfiguration,
  type S3StorageConfigurationSummary
} from '@one-vegetable/core/s3-storage';
import { EXTENSION_S3_STORAGE_KEY, type S3Response } from './s3-protocol';

interface EncryptedRecord {
  schemaVersion: 1;
  revision: number;
  iv: string;
  ciphertext: string;
}
interface SavedConfiguration {
  configuration: S3StorageConfiguration;
  remark: string | null;
  updateTimeUtc: number;
}
export interface S3LocalStore {
  read(): Promise<unknown>;
  write(value: EncryptedRecord): Promise<void>;
  remove(): Promise<void>;
  key(create: boolean): Promise<CryptoKey | null>;
  removeKey(): Promise<void>;
}
class S3LocalError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new S3LocalError(code);
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only registered for the options page. No content script may sign requests or read configuration. */
export class ExtensionS3Service {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: S3LocalStore,
    private readonly contains: (origins: string[]) => Promise<boolean>,
    private readonly client = (configuration: S3StorageConfiguration) =>
      new S3ObjectStorageClient(configuration)
  ) {}

  async contextId(): Promise<string | null> {
    const saved = await this.#read();
    return saved ? galleryStorageId(saved.value.configuration) : null;
  }

  handle(value: unknown, trusted: boolean): Promise<S3Response<unknown>> {
    const action = this.#queue.then(() => this.#handle(value, trusted));
    this.#queue = action.catch(() => undefined);
    return action;
  }

  async #handle(value: unknown, trusted: boolean): Promise<S3Response<unknown>> {
    const requestId = record(value) && isRequestId(value.requestId) ? value.requestId : crypto.randomUUID();
    try {
      if (!trusted) fail('S3_UNTRUSTED_SENDER');
      if (!record(value) || !isRequestId(value.requestId)) fail('INVALID_REQUEST_ID');
      if (!record(value.payload) || typeof value.operation !== 'string') fail('INVALID_REQUEST_BODY');
      const allowed: Record<string, string[]> = {
        summary: [],
        save: ['configuration', 'revision', 'remark'],
        clear: ['revision'],
        reset: [],
        test: [],
        list: ['prefix', 'continuationToken', 'maximum'],
        get: ['key'],
        put: ['key', 'contentBase64', 'contentType']
      };
      const keys = allowed[value.operation];
      if (!keys || Object.keys(value.payload).some((key) => !keys.includes(key)))
        fail('INVALID_REQUEST_BODY');
      const expectedStorage =
        value.galleryContext === undefined ? undefined : requireGalleryContext(value.galleryContext).storage;
      const data = await this.#execute(value.operation, value.payload, requestId, expectedStorage);
      return { requestId, ok: true, data };
    } catch (cause: unknown) {
      // Never serialize provider errors, configuration, signing headers or response bodies.
      const code =
        cause instanceof S3LocalError
          ? cause.code
          : cause instanceof GatewayException && cause.gatewayError.code.startsWith('GALLERY_CONTEXT_')
            ? cause.gatewayError.code
            : 'S3_STORAGE_FAILED';
      return { requestId, ok: false, error: { code, message: code, retryable: false } };
    }
  }

  async #read(): Promise<{ stored: EncryptedRecord; value: SavedConfiguration } | null> {
    const raw = await this.store.read();
    if (raw === undefined || raw === null) return null;
    if (
      !record(raw) ||
      raw.schemaVersion !== 1 ||
      !Number.isSafeInteger(raw.revision) ||
      typeof raw.revision !== 'number' ||
      raw.revision < 1 ||
      typeof raw.iv !== 'string' ||
      typeof raw.ciphertext !== 'string'
    )
      fail('S3_CONFIGURATION_CORRUPT');
    const stored: EncryptedRecord = {
      schemaVersion: 1,
      revision: raw.revision,
      iv: raw.iv,
      ciphertext: raw.ciphertext
    };
    try {
      const key = await this.store.key(false);
      if (!key) fail('S3_CONFIGURATION_CORRUPT');
      const bytes = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: Uint8Array.from(decodeBase64(stored.iv)),
          additionalData: this.#aad(stored.revision)
        },
        key,
        Uint8Array.from(decodeBase64(stored.ciphertext))
      );
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !record(value) ||
        typeof value.updateTimeUtc !== 'number' ||
        !(value.remark === null || typeof value.remark === 'string')
      )
        fail('S3_CONFIGURATION_CORRUPT');
      return {
        stored,
        value: {
          configuration: parseS3StorageConfiguration(value.configuration),
          remark: value.remark,
          updateTimeUtc: value.updateTimeUtc
        }
      };
    } catch {
      return fail('S3_CONFIGURATION_CORRUPT');
    }
  }

  #aad(revision: number): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(`${EXTENSION_S3_STORAGE_KEY}:${revision}`);
  }

  #summary(
    saved: { stored: EncryptedRecord; value: SavedConfiguration } | null
  ): S3StorageConfigurationSummary {
    const configuration = saved?.value.configuration;
    return {
      configured: !!saved,
      endpoint: configuration?.endpoint ?? null,
      region: configuration?.region ?? null,
      bucket: configuration?.bucket ?? null,
      accessKeyIdSuffix: configuration?.accessKeyId.slice(-4) ?? null,
      hasSessionToken: !!configuration?.sessionToken,
      pathStyle: configuration?.pathStyle ?? null,
      rootPrefix: configuration?.rootPrefix ?? null,
      revision: saved?.stored.revision ?? null,
      updateTimeUtc: saved?.value.updateTimeUtc ?? null,
      updaterId: saved ? 'extension:local-admin' : null,
      remark: saved?.value.remark ?? null
    };
  }

  async #execute(
    operation: string,
    payload: Record<string, unknown>,
    requestId: string,
    expectedStorage?: string | null
  ): Promise<unknown> {
    if (operation === 'reset') {
      await this.store.remove();
      await this.store.removeKey();
      return null;
    }
    const saved = await this.#read();
    assertGalleryContextId(expectedStorage, saved ? await galleryStorageId(saved.value.configuration) : null);
    if (operation === 'summary') return this.#summary(saved);
    if (operation === 'save' || operation === 'clear') {
      if (payload.revision !== (saved?.stored.revision ?? null)) fail('ENTITY_VERSION_CONFLICT');
      if (operation === 'clear') {
        await this.store.remove();
        await this.store.removeKey();
        return null;
      }
      let configuration: S3StorageConfiguration;
      try {
        configuration = parseS3StorageConfiguration(payload.configuration);
      } catch {
        return fail('S3_CONFIGURATION_INVALID');
      }
      if (
        !(payload.remark === null || typeof payload.remark === 'string') ||
        (typeof payload.remark === 'string' && Array.from(payload.remark).length > 500)
      )
        fail('INVALID_REQUEST_BODY');
      if (!(await this.contains(s3PermissionOrigins(configuration)))) fail('S3_PERMISSION_REQUIRED');
      const revision = (saved?.stored.revision ?? 0) + 1;
      const value: SavedConfiguration = {
        configuration,
        remark: typeof payload.remark === 'string' ? payload.remark.trim() || null : null,
        updateTimeUtc: Date.now()
      };
      const key = await this.store.key(true);
      if (!key) fail('S3_CONFIGURATION_CORRUPT');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: this.#aad(revision) },
        key,
        new TextEncoder().encode(JSON.stringify(value))
      );
      const stored: EncryptedRecord = {
        schemaVersion: 1,
        revision,
        iv: encodeBase64(iv),
        ciphertext: encodeBase64(new Uint8Array(ciphertext))
      };
      await this.store.write(stored);
      return this.#summary({ stored, value });
    }
    if (!saved) fail('S3_NOT_CONFIGURED');
    if (!(await this.contains(s3PermissionOrigins(saved.value.configuration))))
      fail('S3_PERMISSION_REQUIRED');
    const client = this.client(saved.value.configuration);
    if (operation === 'test') {
      const page = await client.listObjects({ maximum: 1, requestId });
      return { connected: true, visibleObjectCount: page.items.length };
    }
    if (operation === 'list') {
      if (
        (payload.prefix !== undefined && typeof payload.prefix !== 'string') ||
        (payload.continuationToken !== undefined && typeof payload.continuationToken !== 'string') ||
        (payload.maximum !== undefined &&
          (typeof payload.maximum !== 'number' ||
            !Number.isSafeInteger(payload.maximum) ||
            payload.maximum < 1 ||
            payload.maximum > 1000))
      )
        fail('INVALID_REQUEST_BODY');
      return client.listObjects({
        ...(typeof payload.prefix === 'string' ? { prefix: payload.prefix } : {}),
        ...(typeof payload.continuationToken === 'string'
          ? { continuationToken: payload.continuationToken }
          : {}),
        ...(typeof payload.maximum === 'number' ? { maximum: payload.maximum } : {}),
        requestId
      });
    }
    if (typeof payload.key !== 'string' || payload.key.length > 1024) fail('INVALID_REQUEST_BODY');
    if (operation === 'get') {
      const result = await client.getObject(payload.key, requestId);
      return {
        key: result.key,
        contentBase64: encodeBase64(result.bytes),
        byteLength: result.bytes.byteLength,
        contentType: result.contentType,
        etag: result.etag
      };
    }
    if (operation === 'put') {
      if (
        typeof payload.contentBase64 !== 'string' ||
        payload.contentBase64.length > 7_000_000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload.contentBase64) ||
        typeof payload.contentType !== 'string' ||
        !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/json'].includes(
          payload.contentType
        )
      )
        fail('INVALID_REQUEST_BODY');
      const bytes = decodeBase64(payload.contentBase64);
      if (bytes.byteLength > 5 * 1024 * 1024) fail('S3_OBJECT_TOO_LARGE');
      const result = await client.putObject({
        key: payload.key,
        bytes,
        contentType: payload.contentType,
        requestId
      });
      return { key: payload.key, etag: result.etag };
    }
    return fail('INVALID_REQUEST_BODY');
  }
}
