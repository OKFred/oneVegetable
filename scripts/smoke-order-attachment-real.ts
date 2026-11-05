/** One-shot, explicitly confirmed acceptance only. Importing this module performs no I/O. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNodeDatabase, type NodeDatabaseHandle } from '../apps/api/src/db/node-database';
import { SqlOrderAttachmentRepository } from '../apps/api/src/order-attachments/repository';
import { createAlibabaFileRequest } from '../packages/core/src/alibaba-client';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { normalizeIopBusinessResponse } from '../packages/core/src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../packages/core/src/alibaba-iop';
import { GatewayException } from '../packages/core/src/errors';
import {
  galleryGatewayId,
  galleryStorageId,
  opaqueGalleryId
} from '../packages/core/src/gallery-transfer-context';
import { NativeFetchTransport, NetworkManager, type NetworkTransport } from '../packages/core/src/network';
import {
  createOrderAttachmentFile,
  uploadOrderAttachmentPlatform,
  type OrderAttachmentPlatformClient
} from '../packages/core/src/order-attachment-platform';
import {
  ORDER_ATTACHMENT_METHOD,
  OrderAttachmentService,
  type OrderAttachmentRepository
} from '../packages/core/src/order-attachments';
import {
  parseS3StorageConfiguration,
  S3ObjectStorageClient,
  type S3StorageConfiguration
} from '../packages/core/src/s3-storage';
import type { EncodedFilePayload } from '../packages/core/src/encoded-file';
import type { GatewayCredentials } from '../packages/core/src/types';

export const ATTACHMENT_SOURCE = Object.freeze({
  endpoint: 'https://oss-s3.this-time.com',
  bucket: 'dev',
  rootPrefix: 'onevegetable/file-manager-test',
  key: 'extension-check-20261105-5a0d2af8.png',
  bytes: 2635,
  sha256: '55e5de235bdeda85d13a056fca171ba9d332ac756c57b27e56cee9706623f3ed'
});
export const ATTACHMENT_CREDENTIAL_FILE =
  'D:/workspace/okfred/oneVegetable/artifacts/local-dual-authorization/iop-credentials.json';
export const ATTACHMENT_S3_FILE =
  'D:/workspace/okfred/oneVegetable-s3-file-manager/artifacts/s3-file-manager/s3-test.private.json';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OWNER = 'acceptance:order-attachment';
const UPLOAD_URL = IOP_BUSINESS_ENDPOINT + ORDER_ATTACHMENT_METHOD;
const SOURCE_URL =
  ATTACHMENT_SOURCE.endpoint +
  '/' +
  ATTACHMENT_SOURCE.bucket +
  '/' +
  ATTACHMENT_SOURCE.rootPrefix +
  '/' +
  ATTACHMENT_SOURCE.key;
const INTERPRETATION = 'accepted but not order association/content-readback';

export interface AttachmentSmokeOptions {
  credential: string;
  s3Config: string;
  sourceKey: string;
  receiptDir: string;
}
export interface AttachmentSmokeSummary {
  status: 'accepted' | 'unknown' | 'failed' | 'preflight-failed';
  bytes: number | null;
  sha256: string | null;
  requestId: string | null;
  traceId: string | null;
  referenceSha256: string | null;
}
export class AttachmentSmokeError extends Error {
  constructor(
    code: string,
    readonly summary?: AttachmentSmokeSummary
  ) {
    super(code);
  }
}
function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AttachmentSmokeError('ORDER_ATTACHMENT_SMOKE_' + code);
}
const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const nameFor = (id: string) => 'ov-order-attachment-test-' + id + '.png';

export function parseAttachmentSmokeOptions(args: readonly string[]): AttachmentSmokeOptions {
  ensure(args.length === 5 && args.includes('--confirm-test-attachment'), 'EXPLICIT_OPTIONS_REQUIRED');
  const option = (key: string) => {
    const values = args.filter((arg) => arg.startsWith('--' + key + '='));
    ensure(values.length === 1 && values[0], 'OPTIONS_INVALID');
    const value = values[0].slice(key.length + 3);
    ensure(value.length > 0, 'OPTIONS_INVALID');
    return value;
  };
  const credential = option('credential');
  const s3Config = option('s3-config');
  const sourceKey = option('source-key');
  const receiptDir = option('receipt-dir');
  ensure(samePath(credential, ATTACHMENT_CREDENTIAL_FILE), 'CREDENTIAL_PATH_DENIED');
  ensure(samePath(s3Config, ATTACHMENT_S3_FILE), 'S3_CONFIG_PATH_DENIED');
  ensure(sourceKey === ATTACHMENT_SOURCE.key, 'SOURCE_KEY_DENIED');
  ensure(/^artifacts\/[A-Za-z0-9][A-Za-z0-9_-]{7,119}$/u.test(receiptDir), 'NEW_ARTIFACT_DIRECTORY_REQUIRED');
  return { credential, s3Config, sourceKey, receiptDir };
}

export function parseAttachmentSmokeS3(value: unknown): S3StorageConfiguration {
  ensure(isRecord(value), 'S3_CONFIG_INVALID');
  const configuration = parseS3StorageConfiguration({
    ...value,
    sessionToken: value.sessionToken ?? null,
    pathStyle: value.pathStyle ?? true
  });
  ensure(
    configuration.endpoint === ATTACHMENT_SOURCE.endpoint &&
      value.endpoint === ATTACHMENT_SOURCE.endpoint &&
      configuration.bucket === ATTACHMENT_SOURCE.bucket &&
      value.rootPrefix === ATTACHMENT_SOURCE.rootPrefix &&
      configuration.rootPrefix === ATTACHMENT_SOURCE.rootPrefix &&
      configuration.pathStyle &&
      !configuration.allowInsecureLocal &&
      configuration.sessionToken === null,
    'S3_SCOPE_DENIED'
  );
  return configuration;
}

export function parseAttachmentSmokeCredentials(value: unknown, now = Date.now()) {
  const bundle = parseAlibabaOpenApiCredentialBundle(value);
  ensure(bundle.protocol === 'iop', 'EXPLICIT_IOP_REQUIRED');
  const expiresAt = bundle.oauth.expiresAtUtc === null ? NaN : Date.parse(bundle.oauth.expiresAtUtc);
  ensure(Number.isFinite(expiresAt) && expiresAt > now + 120_000, 'UNEXPIRED_IOP_REQUIRED');
  const credentials: GatewayCredentials = {
    protocol: 'iop',
    endpoint: IOP_BUSINESS_ENDPOINT,
    signMethod: 'hmac-sha256',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken
  };
  return {
    credentials,
    expiresAt,
    secrets: [
      credentials.appKey,
      credentials.appSecret,
      credentials.accessToken,
      bundle.oauth.refreshToken
    ].filter((v): v is string => !!v)
  };
}

/** A second fence beneath both shared clients: one exact GET, one exact POST, no redirects/cookies. */
export class AttachmentAcceptanceTransport implements NetworkTransport {
  s3Reads = 0;
  uploads = 0;
  constructor(
    private readonly repository: OrderAttachmentRepository,
    private readonly requestId: string,
    private readonly gatewayId: string,
    private readonly native: NetworkTransport = new NativeFetchTransport()
  ) {}
  async send(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    ensure(
      request.credentials === 'omit' &&
        request.redirect === 'manual' &&
        !request.headers.has('Cookie') &&
        !request.headers.has('Cookie2') &&
        request.headers.get('X-Request-ID') === this.requestId,
      'TRANSPORT_POLICY_DENIED'
    );
    if (request.url === SOURCE_URL && request.method === 'GET') {
      ensure(this.s3Reads === 0 && this.uploads === 0, 'SOURCE_READ_LIMIT');
      this.s3Reads++;
    } else {
      ensure(
        request.url === UPLOAD_URL && request.method === 'POST' && !request.headers.has('Authorization'),
        'FIXED_IOP_ATTACHMENT_ONLY'
      );
      ensure(this.s3Reads === 1 && this.uploads === 0, 'UPLOAD_LIMIT');
      const record = await this.repository.get(this.requestId, OWNER);
      ensure(
        record?.receipt.status === 'sending' &&
          record.receipt.jobId === this.requestId &&
          record.receipt.requestId === this.requestId &&
          record.receipt.gatewayId === this.gatewayId &&
          record.receipt.fileName === nameFor(this.requestId) &&
          record.receipt.size === ATTACHMENT_SOURCE.bytes &&
          record.receipt.sha256 === ATTACHMENT_SOURCE.sha256,
        'DURABLE_SENDING_REQUIRED'
      );
      this.uploads++;
    }
    return this.native.send(request, {});
  }
}

export interface AttachmentProviderRejection {
  code: string;
  subCode: string | null;
  traceId: string | null;
  httpStatus: number | null;
}
const safeAtom = (value: unknown, secrets: readonly string[], max = 128): string | null =>
  typeof value === 'string' &&
  new RegExp('^[A-Za-z0-9_-]{1,' + String(max) + '}$', 'u').test(value) &&
  !secrets.some((secret) => secret && value.includes(secret))
    ? value
    : null;

export async function createAttachmentAcceptanceClient(input: {
  credentials: GatewayCredentials;
  expiresAt: number;
  file: EncodedFilePayload;
  requestId: string;
  secrets: readonly string[];
  transport: NetworkTransport;
}): Promise<OrderAttachmentPlatformClient & { rejection(): AttachmentProviderRejection | null }> {
  const { credentials, file, requestId, secrets } = input;
  ensure(
    credentials.protocol === 'iop' &&
      credentials.endpoint === IOP_BUSINESS_ENDPOINT &&
      input.expiresAt > Date.now() + 30_000 &&
      file.fileName === nameFor(requestId) &&
      file.byteLength === ATTACHMENT_SOURCE.bytes,
    'CLIENT_PREFLIGHT_FAILED'
  );
  // Pure signing is completed before the service claims the mutation, never through AlibabaClient.
  const bytes = Uint8Array.from(Buffer.from(file.contentBase64, 'base64'));
  ensure(hash(bytes) === ATTACHMENT_SOURCE.sha256, 'SOURCE_FINGERPRINT_MISMATCH');
  const multipart = await createAlibabaFileRequest(
    credentials,
    ORDER_ATTACHMENT_METHOD,
    { file_name: file.fileName },
    {
      fieldName: 'data',
      fileName: file.fileName,
      contentType: file.contentType,
      bytes
    }
  );
  ensure(multipart.url === UPLOAD_URL, 'FIXED_IOP_ATTACHMENT_ONLY');
  const network = new NetworkManager({
    transport: input.transport,
    policies: {
      alibaba: {
        allowUrl: (url) => url.href === UPLOAD_URL,
        maxRequestBytes: 64 * 1024,
        maxResponseBytes: 64 * 1024,
        timeoutMilliseconds: 30_000,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store'
      }
    }
  });
  let called = false;
  let rejection: AttachmentProviderRejection | null = null;
  return {
    rejection: () => rejection,
    async callWithFile(method, parameters, part) {
      ensure(
        !called &&
          method === ORDER_ATTACHMENT_METHOD &&
          Object.keys(parameters).length === 1 &&
          parameters.file_name === file.fileName &&
          part.fieldName === 'data' &&
          part.fileName === file.fileName &&
          part.contentType === 'image/png' &&
          part.bytes.byteLength === ATTACHMENT_SOURCE.bytes &&
          hash(part.bytes) === ATTACHMENT_SOURCE.sha256,
        'FIXED_UPLOAD_CONTRACT_ONLY'
      );
      called = true;
      let httpStatus: number | null = null;
      try {
        ensure(input.expiresAt > Date.now() + 30_000, 'CREDENTIAL_EXPIRED_BEFORE_SEND');
        const response = await network.request({
          service: 'alibaba',
          url: multipart.url,
          method: 'POST',
          requestId,
          maxAttempts: 1,
          headers: { 'Content-Type': multipart.contentType },
          body: multipart.body,
          bodySizeBytes: multipart.body.byteLength,
          responseType: 'json'
        });
        httpStatus = response.status;
        const normalized = normalizeIopBusinessResponse(response.data, ORDER_ATTACHMENT_METHOD, credentials);
        ensure(response.ok, 'HTTP_RESULT_UNKNOWN');
        ensure(isRecord(normalized), 'RESULT_UNKNOWN');
        // The shared platform adapter requires native code=0 and a safe nonempty filepath.
        const reference = normalized.value;
        ensure(
          typeof reference === 'string' && !secrets.some((secret) => secret && reference.includes(secret)),
          'REFERENCE_REDACTED'
        );
        const { request_id: trace, ...data } = normalized;
        return { method, data: { ...data, ...(safeAtom(trace, secrets, 160) ? { request_id: trace } : {}) } };
      } catch (error) {
        const known =
          error instanceof GatewayException &&
          [
            'ALIBABA_IOP_API_REJECTED',
            'ALIBABA_IOP_BUSINESS_REJECTED',
            'ALIBABA_IOP_UPSTREAM_ERROR'
          ].includes(error.gatewayError.code);
        rejection = {
          code: known ? error.gatewayError.code : 'ORDER_ATTACHMENT_RESULT_UNKNOWN',
          subCode: known ? safeAtom(error.gatewayError.subCode, secrets) : null,
          traceId:
            error instanceof GatewayException ? safeAtom(error.gatewayError.traceId, secrets, 160) : null,
          httpStatus
        };
        throw new AttachmentSmokeError('ORDER_ATTACHMENT_SMOKE_RESULT_UNKNOWN');
      }
    }
  };
}

async function privateDirectory(root: string, relative: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const artifacts = join(canonicalRoot, 'artifacts');
  const info = await lstat(artifacts);
  ensure(
    info.isDirectory() && !info.isSymbolicLink() && samePath(await realpath(artifacts), artifacts),
    'ARTIFACT_PARENT_DENIED'
  );
  const directory = resolve(canonicalRoot, relative);
  // No recursive mkdir: EEXIST always refuses a second run, even after a preflight failure.
  await mkdir(directory, { recursive: false, mode: 0o700 });
  if (process.platform === 'win32') {
    const system32 = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
    const identity = execFileSync(join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true
    });
    const sid = /S-1-\d+(?:-\d+)+/u.exec(identity)?.[0];
    ensure(sid, 'PRIVATE_DIRECTORY_OWNER_UNKNOWN');
    execFileSync(
      join(system32, 'icacls.exe'),
      [
        directory,
        '/inheritance:r',
        '/grant:r',
        '*' + sid + ':(OI)(CI)F',
        '*S-1-5-18:(OI)(CI)F',
        '*S-1-5-32-544:(OI)(CI)F'
      ],
      { stdio: 'pipe', windowsHide: true }
    );
  } else await chmod(directory, 0o700);
  return directory;
}
async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function runOrderAttachmentSmokeCli(
  args: readonly string[],
  dependencies: {
    root?: string;
    readJson?: (path: string) => Promise<unknown>;
    transport?: NetworkTransport;
  } = {}
): Promise<AttachmentSmokeSummary> {
  const options = parseAttachmentSmokeOptions(args);
  const root = dependencies.root ?? ROOT;
  const directory = await privateDirectory(root, options.receiptDir);
  const requestId = randomUUID();
  let database: NodeDatabaseHandle | undefined;
  let transport: AttachmentAcceptanceTransport | undefined;
  let client: Awaited<ReturnType<typeof createAttachmentAcceptanceClient>> | undefined;
  let summary: AttachmentSmokeSummary = {
    status: 'preflight-failed',
    bytes: null,
    sha256: null,
    requestId,
    traceId: null,
    referenceSha256: null
  };
  const json =
    dependencies.readJson ??
    (async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown);
  try {
    const { credentials, expiresAt, secrets } = parseAttachmentSmokeCredentials(
      await json(options.credential)
    );
    const configuration = parseAttachmentSmokeS3(await json(options.s3Config));
    secrets.push(configuration.accessKeyId, configuration.secretAccessKey);
    const dbPath = join(directory, 'receipts.sqlite');
    const exclusive = await open(dbPath, 'wx', 0o600);
    await exclusive.close();
    database = openNodeDatabase(dbPath);
    database.connection.exec(
      'PRAGMA synchronous = FULL; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_time_utc INTEGER NOT NULL);'
    );
    database.connection.exec(
      await readFile(new URL('../apps/api/drizzle/0019_order_attachment_jobs.sql', import.meta.url), 'utf8')
    );
    const repository = new SqlOrderAttachmentRepository(database.executor);
    const context = {
      identity: await opaqueGalleryId(OWNER),
      gateway: await galleryGatewayId(credentials),
      storage: await galleryStorageId(configuration)
    };
    transport = new AttachmentAcceptanceTransport(
      repository,
      requestId,
      context.gateway,
      dependencies.transport
    );
    const source = await new S3ObjectStorageClient(configuration, transport).getObject(
      options.sourceKey,
      requestId
    );
    ensure(
      source.bytes.byteLength === ATTACHMENT_SOURCE.bytes && hash(source.bytes) === ATTACHMENT_SOURCE.sha256,
      'SOURCE_FINGERPRINT_MISMATCH'
    );
    summary = { ...summary, bytes: source.bytes.byteLength, sha256: hash(source.bytes) };
    const file = createOrderAttachmentFile(nameFor(requestId), source.bytes);
    const acceptance = await createAttachmentAcceptanceClient({
      credentials,
      expiresAt,
      file,
      requestId,
      secrets,
      transport
    });
    client = acceptance;
    const service = new OrderAttachmentService(repository, {
      ownerId: OWNER,
      context,
      protocol: 'iop',
      // This standalone, explicitly confirmed driver authorizes only the single fixed test method.
      enabled: true,
      send: (payload) => uploadOrderAttachmentPlatform(acceptance, payload)
    });
    const receipt = await service.upload({ requestId, file, context });
    summary = {
      ...summary,
      status: receipt.status === 'accepted' ? 'accepted' : 'unknown',
      traceId: receipt.traceId,
      referenceSha256: receipt.platformReference ? hash(receipt.platformReference) : null
    };
  } catch {
    summary.status = transport?.uploads ? 'unknown' : 'preflight-failed';
  } finally {
    database?.connection.close();
  }
  try {
    await writePrivateJson(join(directory, 'report.json'), {
      ...summary,
      protocol: 'iop',
      interpretation: summary.status === 'accepted' ? INTERPRETATION : 'not accepted; no automatic resend',
      orderAssociation: false,
      contentReadback: 'not-provided-by-platform',
      configurationChanged: false,
      topRequests: 0,
      tokenRequests: 0,
      s3Reads: transport?.s3Reads ?? 0,
      uploads: transport?.uploads ?? 0,
      noAutomaticRetry: true
    });
    const rejection = client?.rejection();
    if (rejection) await writePrivateJson(join(directory, 'provider-rejection.json'), rejection);
  } catch {
    throw new AttachmentSmokeError('ORDER_ATTACHMENT_SMOKE_REPORT_PERSISTENCE_FAILED', {
      ...summary,
      status: transport?.uploads ? 'unknown' : 'preflight-failed'
    });
  }
  return summary;
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  let result: AttachmentSmokeSummary;
  try {
    result = await runOrderAttachmentSmokeCli(process.argv.slice(2));
  } catch (error) {
    result =
      error instanceof AttachmentSmokeError && error.summary
        ? error.summary
        : {
            status: 'preflight-failed',
            bytes: null,
            sha256: null,
            requestId: null,
            traceId: null,
            referenceSha256: null
          };
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status !== 'accepted') process.exitCode = 1;
}
