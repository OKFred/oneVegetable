import { createHash, randomUUID } from 'node:crypto';
import { GatewayException } from '../../packages/core/src/errors';
import { NetworkManager, type NetworkTransport } from '../../packages/core/src/network';
import { galleryStorageId, requireGalleryContext } from '../../packages/core/src/gallery-transfer-context';
import { S3ObjectStorageClient, type S3StorageConfiguration } from '../../packages/core/src/s3-storage';
import { validateVideoPage } from '../../packages/core/src/generated/validators-video';
import type { VideoPage } from '../../packages/core/src/video';
import {
  assertMp4Header,
  validateVideoUploadResult,
  type VideoUploadResult,
  type VideoUploadTask
} from '../../packages/core/src/video-upload';

export const URL_SOURCE = Object.freeze({
  key: 'onevegetable/video-staging/d6ae6b47-01c7-4f94-b52a-393a250df7ec/source.mp4',
  byteLength: 7203235,
  sha256: 'b84712f8a3e50f92f87bd3738ccc2456db2cea287eebed5b0526357523c6a2f6'
});
export const PUBLIC_S3_ORIGIN = 'https://oss-s3.this-time.com';
const PRIVATE_S3_ORIGIN = 'https://oss-s3.app.fred.wiki';
export const SOURCE_PATH = `/dev/${URL_SOURCE.key}`;
export const ISOLATED_DIRECTORY =
  'artifacts/video-upload-validation/isolated/2026-09-23T04-26-42-359Z-12d00d9b';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const phases = [
  'source.range',
  'login',
  'meta',
  'storage',
  'context',
  'video.list',
  'video.create',
  'video.submit',
  'video.get',
  'video.verify',
  'video.baseline'
] as const;
export type UrlPhase = (typeof phases)[number];
type BffPhase = Exclude<UrlPhase, 'source.range'>;
export class UrlSmokeError extends Error {}
// Exact project-owned codes, not a regex/prefix allowlist. Provider message/subCode are never copied.
const safeBffCodes = [
  'BFF_CALL_REJECTED_NO_RETRY',
  'VIDEO_BASELINE_INCOMPLETE',
  'VIDEO_UPLOAD_RESPONSE_INVALID',
  'VIDEO_UPLOAD_FAILED',
  'VIDEO_UPLOAD_DISABLED',
  'VIDEO_RESPONSE_INVALID',
  'VIDEO_PROVIDER_REJECTED',
  'VIDEO_TASK_CORRUPT',
  'VIDEO_TASK_LIMIT',
  'VIDEO_TASK_NOT_FOUND',
  'VIDEO_TASK_BUSY',
  'VIDEO_TASK_TERMINAL',
  'VIDEO_TITLE_REQUIRED',
  'VIDEO_RECONCILIATION_REQUIRED',
  'VIDEO_CANCELLATION_PENDING',
  'VIDEO_NOT_SUBMITTED',
  'VIDEO_ALREADY_SUBMITTED',
  'VIDEO_NOT_STAGED',
  'VIDEO_SOURCE_CHANGED',
  'VIDEO_REMOTE_RESULT_PRESERVED',
  'VIDEO_MULTIPART_NOT_STARTED',
  'VIDEO_PART_CONFLICT',
  'VIDEO_PART_RECONCILIATION_FAILED',
  'VIDEO_FILE_CHANGED',
  'VIDEO_PART_INVALID',
  'VIDEO_PARTS_INCOMPLETE',
  'VIDEO_OBJECT_NOT_CONFIRMED',
  'VIDEO_FILE_INVALID',
  'VIDEO_PUBLIC_SOURCE_REQUIRED',
  'REQUEST_CONTRACT_INVALID',
  'RESPONSE_CONTRACT_INVALID',
  'ENTITY_VERSION_CONFLICT',
  'GALLERY_CONTEXT_CHANGED',
  'S3_STORAGE_NOT_CONFIGURED',
  'S3_REQUEST_FAILED',
  'CSRF_INVALID',
  'INVALID_CREDENTIALS',
  'USER_DISABLED',
  'LOGIN_LOCKED',
  'CAPABILITY_RESTRICTED',
  'ALIBABA_GATEWAY_DISABLED',
  'INVALID_OPERATION_REQUEST',
  'INVALID_OPERATION_PAYLOAD',
  'INVALID_REQUEST_ID'
] as const;
type SafeBffCode = (typeof safeBffCodes)[number];
export interface BffDiagnostic {
  code: SafeBffCode;
  httpStatus: number | null;
}
function safeBffCode(value: unknown): SafeBffCode {
  return safeBffCodes.find((code) => code === value) ?? 'BFF_CALL_REJECTED_NO_RETRY';
}
function safeHttpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
export class BffDiagnosticError extends UrlSmokeError {
  readonly diagnostic: BffDiagnostic;
  constructor(code: unknown, httpStatus: unknown) {
    super(safeBffCode(code));
    this.diagnostic = { code: safeBffCode(code), httpStatus: safeHttpStatus(httpStatus) };
  }
}
export function failUrlSmoke(code: string): never {
  throw new UrlSmokeError(code);
}
const safeFilesystemCodes = [
  'EPERM',
  'EACCES',
  'EBUSY',
  'ENOSPC',
  'EIO',
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'EMFILE',
  'ENFILE',
  'EROFS',
  'EEXIST',
  'ENAMETOOLONG',
  'EXDEV',
  'EDQUOT'
] as const;
const safeNetworkCodes = [
  'NETWORK_ERROR',
  'INVALID_REQUEST_ID',
  'NETWORK_SERVICE_NOT_CONFIGURED',
  'NETWORK_REDIRECT_DENIED',
  'REQUEST_TIMEOUT',
  'RETRY_EXHAUSTED',
  'NETWORK_URL_DENIED',
  'NETWORK_REQUEST_SIZE_INVALID',
  'NETWORK_REQUEST_TOO_LARGE',
  'NETWORK_RESPONSE_TOO_LARGE',
  'INVALID_JSON_RESPONSE'
] as const;
const safeUrlSmokeCodes = [
  'IGNORED_WORKSPACE_PATH_REQUIRED',
  'SOURCE_DATABASE_READ_ONLY',
  'ENCRYPTED_CONFIGURATION_MISSING',
  'EXISTING_LOCAL_AUTH_REQUIRED',
  'WINDOWS_REQUIRED',
  'NETWORK_DEBUG_OUTPUT_MUST_BE_DISABLED',
  'EXPLICIT_RUN_UUID_REQUIRED',
  'URL_RUN_ALREADY_USED_NO_CALLS',
  'EXISTING_URL_RUN_REQUIRED',
  'RUN_LOCKED_MANUAL_PROCESS_CHECK_REQUIRED',
  'EXACT_VERIFY_TASK_REQUIRED',
  'INVALID_URL_SMOKE_OPTIONS',
  'EXPLICIT_SINGLE_ACTION_REQUIRED',
  'URL_LIVE_OPT_IN_REQUIRED',
  'EXACT_SOURCE_KEY_REQUIRED',
  'VIDEO_WRITE_OPT_IN_REQUIRED',
  'URL_JOURNAL_INVALID',
  'APPROVED_STORED_S3_REQUIRED',
  'SIGNED_SOURCE_INVALID',
  'SIGNED_SOURCE_INVALID_OR_EXPIRING',
  'PUBLIC_RANGE_INVALID',
  'PUBLIC_MP4_INVALID',
  'READ_ONLY_BASELINE_REQUEST_REQUIRED',
  'URL_JOURNAL_LIMIT',
  'URL_WRITE_ALREADY_ATTEMPTED',
  'ACTIVE_ADMIN_REQUIRED',
  'LOCAL_REAL_NODE_REQUIRED',
  'PUBLIC_BFF_STORAGE_REQUIRED',
  'VIDEO_RESULT_INVALID',
  'URL_TASK_MISMATCH',
  'URL_RUN_ALREADY_USED',
  'PUBLIC_OBJECT_SHA256_MISMATCH',
  'VERIFIED_SOURCE_REQUIRED',
  'SIGNING_BFF_STORAGE_MISMATCH',
  'LOCAL_VIDEO_FLAG_REQUIRED',
  'URL_FINGERPRINT_MISMATCH',
  'URL_TASK_CONTEXT_MISMATCH',
  'EXACT_SUBMITTED_TASK_REQUIRED',
  'EXACT_DIAGNOSTIC_TASK_REQUIRED',
  'EXACT_LOCAL_BFF_REQUIRED',
  'NORMAL_LOGIN_CSRF_REQUIRED'
] as const;

// Returns only a literal from an exact allowlist, never messages, paths, causes or provider subCodes.
export function classifyUrlSmokeFailure(error: unknown): string {
  const fallback = 'URL_SMOKE_STOPPED_NO_RETRY';
  if (error instanceof BffDiagnosticError) return safeBffCode(error.diagnostic.code);
  if (error instanceof UrlSmokeError)
    return safeUrlSmokeCodes.find((code) => code === error.message) ?? fallback;
  if (error instanceof GatewayException)
    return (
      [...safeNetworkCodes, ...safeBffCodes].find((code) => code === error.gatewayError.code) ?? fallback
    );
  if (record(error))
    return [...safeFilesystemCodes, ...safeNetworkCodes].find((code) => code === error.code) ?? fallback;
  return fallback;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export interface UrlOptions {
  action: 'preflight' | 'submit' | 'verify';
  runId: string | null;
  taskId: string | null;
}
export function parseUrlOptions(args: string[], env: NodeJS.ProcessEnv): UrlOptions {
  const fields = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(preflight|submit|verify|run|task|source-key)(?:=(.+))?$/u.exec(arg);
    if (!match?.[1] || fields.has(match[1])) failUrlSmoke('INVALID_URL_SMOKE_OPTIONS');
    fields.set(match[1], match[2] ?? '');
  }
  const selected = (['preflight', 'submit', 'verify'] as const).filter((name) => fields.has(name));
  if (selected.length > 1 || selected.some((name) => fields.get(name) !== ''))
    failUrlSmoke('EXPLICIT_SINGLE_ACTION_REQUIRED');
  const action = selected[0] ?? 'preflight';
  const runId = fields.get('run') ?? null,
    taskId = fields.get('task') ?? null;
  if (action === 'preflight') {
    if ([...fields.keys()].some((key) => key !== 'preflight'))
      failUrlSmoke('EXPLICIT_SINGLE_ACTION_REQUIRED');
    return { action, runId: null, taskId: null };
  }
  if (!runId || !uuid.test(runId)) failUrlSmoke('EXPLICIT_RUN_UUID_REQUIRED');
  if (env.ONE_VEGETABLE_VIDEO_UPLOAD_URL_REAL_SMOKE !== '1') failUrlSmoke('URL_LIVE_OPT_IN_REQUIRED');
  if (action === 'submit') {
    if (taskId !== null || fields.get('source-key') !== URL_SOURCE.key)
      failUrlSmoke('EXACT_SOURCE_KEY_REQUIRED');
    if (env.ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE !== '1') failUrlSmoke('VIDEO_WRITE_OPT_IN_REQUIRED');
  } else if (!taskId || !uuid.test(taskId) || fields.has('source-key'))
    failUrlSmoke('EXACT_VERIFY_TASK_REQUIRED');
  return { action, runId, taskId };
}

export interface UrlCall {
  phase: UrlPhase;
  requestId: string;
  outcome: 'intent' | 'response' | 'error';
  diagnostic?: BffDiagnostic;
}
export interface UrlJournal {
  schemaVersion: 1;
  runId: string;
  status: 'started' | 'stopped' | 'submitted-readback-required' | 'readback-pending' | 'readback-confirmed';
  sourceVerified: boolean;
  taskId: string | null;
  taskStatus: VideoUploadTask['status'] | null;
  calls: UrlCall[];
}
const statuses: readonly string[] = [
  'prepared',
  'staging',
  'staged',
  'submitting',
  'accepted',
  'needs-review',
  'confirmed',
  'cancelled',
  'failed'
];
export function newUrlJournal(runId: string): UrlJournal {
  if (!uuid.test(runId)) failUrlSmoke('EXPLICIT_RUN_UUID_REQUIRED');
  return {
    schemaVersion: 1,
    runId,
    status: 'started',
    sourceVerified: false,
    taskId: null,
    taskStatus: null,
    calls: []
  };
}
export function parseUrlJournal(value: unknown, runId: string): UrlJournal {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.runId !== runId ||
    !uuid.test(runId) ||
    !['started', 'stopped', 'submitted-readback-required', 'readback-pending', 'readback-confirmed'].includes(
      String(value.status)
    ) ||
    typeof value.sourceVerified !== 'boolean' ||
    !(value.taskId === null || (typeof value.taskId === 'string' && uuid.test(value.taskId))) ||
    !(
      value.taskStatus === null ||
      (typeof value.taskStatus === 'string' && statuses.includes(value.taskStatus))
    ) ||
    !Array.isArray(value.calls) ||
    value.calls.length > 1000
  )
    failUrlSmoke('URL_JOURNAL_INVALID');
  const calls = value.calls.map((item: unknown): UrlCall => {
    if (
      !record(item) ||
      !phases.some((phase) => phase === item.phase) ||
      typeof item.requestId !== 'string' ||
      !uuid.test(item.requestId) ||
      !['intent', 'response', 'error'].includes(String(item.outcome))
    )
      failUrlSmoke('URL_JOURNAL_INVALID');
    return {
      phase: item.phase as UrlPhase,
      requestId: item.requestId,
      outcome: item.outcome as UrlCall['outcome'],
      ...(item.outcome === 'error' && record(item.diagnostic)
        ? {
            diagnostic: {
              code: safeBffCode(item.diagnostic.code),
              httpStatus: safeHttpStatus(item.diagnostic.httpStatus)
            }
          }
        : {})
    };
  });
  return {
    schemaVersion: 1,
    runId,
    status: value.status as UrlJournal['status'],
    sourceVerified: value.sourceVerified,
    taskId: value.taskId,
    taskStatus: value.taskStatus as UrlJournal['taskStatus'],
    calls
  };
}

/** Copy in memory BEFORE signing. Neither source DB nor an already-signed URL is ever modified. */
export function publicUrlConfiguration(stored: S3StorageConfiguration): S3StorageConfiguration {
  if (
    ![PUBLIC_S3_ORIGIN, PRIVATE_S3_ORIGIN].includes(stored.endpoint) ||
    stored.bucket !== 'dev' ||
    !stored.pathStyle ||
    stored.allowInsecureLocal === true
  )
    failUrlSmoke('APPROVED_STORED_S3_REQUIRED');
  return { ...stored, endpoint: PUBLIC_S3_ORIGIN, bucket: 'dev', pathStyle: true, rootPrefix: '' };
}
export async function signPublicUrl(
  stored: S3StorageConfiguration
): Promise<{ url: string; storageContext: string }> {
  const configuration = publicUrlConfiguration(stored);
  const url = await new S3ObjectStorageClient(configuration).presignVideoGet(URL_SOURCE.key);
  assertSignedSource(url);
  return { url, storageContext: await galleryStorageId(configuration) };
}
export function assertSignedSource(value: string, now = Date.now()): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return failUrlSmoke('SIGNED_SOURCE_INVALID');
  }
  const date = url.searchParams.get('X-Amz-Date') ?? '';
  const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(date);
  const signedAt = parts
    ? Date.parse(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}Z`)
    : NaN;
  if (
    url.origin !== PUBLIC_S3_ORIGIN ||
    url.pathname !== SOURCE_PATH ||
    url.href !== value ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
    url.searchParams.get('X-Amz-Expires') !== '1800' ||
    !/^[a-f0-9]{64}$/u.test(url.searchParams.get('X-Amz-Signature') ?? '') ||
    url.searchParams.get('X-Amz-SignedHeaders') !== 'host' ||
    !url.searchParams.get('X-Amz-Credential') ||
    !Number.isFinite(signedAt) ||
    signedAt > now + 60_000 ||
    now - signedAt > 25 * 60_000
  )
    failUrlSmoke('SIGNED_SOURCE_INVALID_OR_EXPIRING');
  for (const name of url.searchParams.keys())
    if (url.searchParams.getAll(name).length !== 1) failUrlSmoke('SIGNED_SOURCE_INVALID_OR_EXPIRING');
}
export function assertRange(
  response: { status: number; headers: Headers; bytes: Uint8Array },
  start: number,
  end: number
): void {
  if (
    response.status !== 206 ||
    response.bytes.byteLength !== end - start + 1 ||
    response.headers.get('content-range') !== `bytes ${start}-${end}/${URL_SOURCE.byteLength}` ||
    response.headers.get('content-length') !== String(end - start + 1)
  )
    failUrlSmoke('PUBLIC_RANGE_INVALID');
  if (start === 0) {
    try {
      assertMp4Header(response.bytes);
    } catch {
      failUrlSmoke('PUBLIC_MP4_INVALID');
    }
  }
}

export interface UrlIo {
  sign: () => Promise<{ url: string; storageContext: string }>;
  range: (
    url: string,
    start: number,
    end: number,
    requestId: string
  ) => Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;
  credentials: () => Promise<{ username: string; password: string }>;
  bff: (phase: BffPhase, payload: Record<string, unknown>, requestId: string) => Promise<unknown>;
}
type ReadonlyBffIo = Pick<UrlIo, 'credentials' | 'bff'>;
export interface BaselineDiagnostic {
  count: number | null;
  page: 1;
  total: number | null;
  code: SafeBffCode | null;
}
function baselineSummary(value: unknown): BaselineDiagnostic {
  if (!validateVideoPage(value)) return { count: null, page: 1, total: null, code: 'VIDEO_RESPONSE_INVALID' };
  const page = value as VideoPage;
  if (page.page !== 1 || page.pageSize !== 20 || page.items.length > 20)
    return { count: null, page: 1, total: null, code: 'VIDEO_RESPONSE_INVALID' };
  return {
    count: page.items.length,
    page: 1,
    total: page.total,
    code: page.total === null || page.total > page.items.length ? 'VIDEO_BASELINE_INCOMPLETE' : null
  };
}

function assertBaselinePayload(value: Record<string, unknown>): void {
  if (
    Object.keys(value).some((key) => !['operation', 'payload', 'galleryContext'].includes(key)) ||
    value.operation !== 'listVideos' ||
    !record(value.payload) ||
    Object.keys(value.payload).some((key) => !['page', 'pageSize', 'title'].includes(key)) ||
    value.payload.page !== 1 ||
    value.payload.pageSize !== 20 ||
    typeof value.payload.title !== 'string' ||
    !value.payload.title.trim() ||
    value.payload.title.length > 512
  )
    failUrlSmoke('READ_ONLY_BASELINE_REQUEST_REQUIRED');
  requireGalleryContext(value.galleryContext);
}

/** Durable intents contain phase/UUID/outcome and optional safe error metadata, never payloads. */
export class UrlAcceptanceRun {
  constructor(
    readonly journal: UrlJournal,
    private readonly persist: () => Promise<void>
  ) {}
  async call<T>(phase: UrlPhase, invoke: (requestId: string) => Promise<T>): Promise<T> {
    if (this.journal.calls.length >= 1000) failUrlSmoke('URL_JOURNAL_LIMIT');
    if (
      ['video.create', 'video.submit'].includes(phase) &&
      this.journal.calls.some((call) => call.phase === phase)
    )
      failUrlSmoke('URL_WRITE_ALREADY_ATTEMPTED');
    const receipt: UrlCall = { phase, requestId: randomUUID(), outcome: 'intent' };
    this.journal.calls.push(receipt);
    await this.persist();
    try {
      const value = await invoke(receipt.requestId);
      receipt.outcome = 'response';
      await this.persist();
      return value;
    } catch (error) {
      receipt.outcome = 'error';
      if (error instanceof BffDiagnosticError) receipt.diagnostic = { ...error.diagnostic };
      await this.persist();
      throw error;
    }
  }
  private bff(io: ReadonlyBffIo, phase: BffPhase, payload: Record<string, unknown> = {}) {
    return this.call(phase, (id) => io.bff(phase, payload, id));
  }
  private async session(io: ReadonlyBffIo) {
    const login = await this.bff(io, 'login', await io.credentials());
    if (
      !record(login) ||
      !record(login.user) ||
      login.user.role !== 'admin' ||
      login.user.status !== 'active'
    )
      failUrlSmoke('ACTIVE_ADMIN_REQUIRED');
    const meta = await this.bff(io, 'meta');
    if (
      !record(meta) ||
      meta.runtime !== 'node' ||
      meta.environment !== 'local-node' ||
      meta.gatewayMode !== 'real'
    )
      failUrlSmoke('LOCAL_REAL_NODE_REQUIRED');
    const storage = await this.bff(io, 'storage');
    if (
      !record(storage) ||
      storage.endpoint !== PUBLIC_S3_ORIGIN ||
      storage.bucket !== 'dev' ||
      storage.rootPrefix !== '' ||
      storage.pathStyle !== true
    )
      failUrlSmoke('PUBLIC_BFF_STORAGE_REQUIRED');
    return requireGalleryContext(await this.bff(io, 'context'));
  }
  private task(value: unknown, expectedId?: string): VideoUploadTask {
    if (!validateVideoUploadResult(value)) failUrlSmoke('VIDEO_RESULT_INVALID');
    const result = value as VideoUploadResult;
    const task = result.tasks[0];
    if (
      result.tasks.length !== 1 ||
      !task ||
      (expectedId && task.id !== expectedId) ||
      task.source !== 'url' ||
      task.file !== null ||
      task.objectKey !== null ||
      task.parts.length !== 0
    )
      failUrlSmoke('URL_TASK_MISMATCH');
    this.journal.taskId = task.id;
    this.journal.taskStatus = task.status;
    return task;
  }
  async submit(io: UrlIo): Promise<void> {
    // An entire submit invocation is single-use, even if its first read failed. Never resign/recreate on resume.
    if (this.journal.calls.length || this.journal.taskId || this.journal.status !== 'started')
      failUrlSmoke('URL_RUN_ALREADY_USED');
    const source = await io.sign();
    assertSignedSource(source.url);
    const digest = createHash('sha256');
    // Anonymous public range comes FIRST, before login or task creation. Verify all pinned bytes in bounded reads.
    for (let start = 0; start < URL_SOURCE.byteLength;) {
      const end = Math.min(URL_SOURCE.byteLength - 1, start + (start === 0 ? 4096 : 5 * 1024 * 1024) - 1);
      const response = await this.call('source.range', (id) => io.range(source.url, start, end, id));
      assertRange(response, start, end);
      digest.update(response.bytes);
      start = end + 1;
    }
    if (digest.digest('hex') !== URL_SOURCE.sha256) failUrlSmoke('PUBLIC_OBJECT_SHA256_MISMATCH');
    this.journal.sourceVerified = true;
    await this.persist();
    await this.submitVerified(io, source);
  }
  /** Shared orchestration after the public hash check; separate for offline dependency-injected tests. */
  async submitVerified(io: UrlIo, source: { url: string; storageContext: string }): Promise<void> {
    if (
      !this.journal.sourceVerified ||
      this.journal.calls.length !== 3 ||
      this.journal.calls.some((call) => call.phase !== 'source.range' || call.outcome !== 'response')
    )
      failUrlSmoke('VERIFIED_SOURCE_REQUIRED');
    const context = await this.session(io);
    if (context.storage !== source.storageContext) failUrlSmoke('SIGNING_BFF_STORAGE_MISMATCH');
    const listed = await this.bff(io, 'video.list', { context, command: { action: 'list' } });
    if (!validateVideoUploadResult(listed) || !(listed as VideoUploadResult).uploadEnabled)
      failUrlSmoke('LOCAL_VIDEO_FLAG_REQUIRED');
    assertSignedSource(source.url);
    const fingerprint = createHash('sha256').update(source.url).digest('hex');
    const task = this.task(
      await this.bff(io, 'video.create', {
        context,
        command: {
          action: 'create',
          title: `URL video acceptance ${this.journal.runId}`,
          source: { kind: 'url', url: source.url }
        }
      })
    );
    await this.persist();
    if (task.status !== 'prepared' || task.sourceFingerprint !== fingerprint)
      failUrlSmoke('URL_FINGERPRINT_MISMATCH');
    for (const field of ['identity', 'gateway', 'storage'] as const)
      if (task.context[field] !== context[field]) failUrlSmoke('URL_TASK_CONTEXT_MISMATCH');
    // No new URL/signing/canonicalization here: same ephemeral string, immediately after creation.
    assertSignedSource(source.url);
    this.task(
      await this.bff(io, 'video.submit', {
        context,
        command: {
          action: 'submit',
          taskId: task.id,
          revision: task.revision,
          sourceUrl: source.url,
          confirmed: true
        }
      }),
      task.id
    );
    this.journal.status = 'submitted-readback-required';
    await this.persist();
  }
  async verify(io: UrlIo, taskId: string): Promise<void> {
    if (this.journal.taskId !== taskId || !this.journal.calls.some((call) => call.phase === 'video.submit'))
      failUrlSmoke('EXACT_SUBMITTED_TASK_REQUIRED');
    // This path NEVER signs a URL, reads the source, creates or submits a task.
    const context = await this.session(io);
    let task = this.task(
      await this.bff(io, 'video.get', { context, command: { action: 'get', taskId } }),
      taskId
    );
    if (task.status !== 'confirmed')
      task = this.task(
        await this.bff(io, 'video.verify', {
          context,
          command: { action: 'verify', taskId, revision: task.revision }
        }),
        taskId
      );
    this.journal.status = task.status === 'confirmed' ? 'readback-confirmed' : 'readback-pending';
    await this.persist();
  }
  /** One read-only first-page title baseline. Does NOT verify/submit/change the remote task. */
  async diagnoseBaseline(io: ReadonlyBffIo, taskId: string): Promise<BaselineDiagnostic> {
    if (!uuid.test(taskId) || this.journal.taskId !== taskId) failUrlSmoke('EXACT_DIAGNOSTIC_TASK_REQUIRED');
    try {
      const context = await this.session(io);
      const task = this.task(
        await this.bff(io, 'video.get', { context, command: { action: 'get', taskId } }),
        taskId
      );
      for (const field of ['identity', 'gateway', 'storage'] as const)
        if (task.context[field] !== context[field]) failUrlSmoke('URL_TASK_CONTEXT_MISMATCH');
      // The persisted task supplies the exact title (including its suffix); never accept/print a guessed title.
      const result = await this.bff(io, 'video.baseline', {
        operation: 'listVideos',
        payload: { page: 1, pageSize: 20, title: task.title },
        galleryContext: context
      });
      return baselineSummary(result);
    } catch (error) {
      if (error instanceof BffDiagnosticError)
        return { count: null, page: 1, total: null, code: error.diagnostic.code };
      throw error;
    }
  }
}

export function localUrlBff(value = 'http://127.0.0.1:8798'): string {
  if (!['http://127.0.0.1:8798', 'http://localhost:8798'].includes(value))
    failUrlSmoke('EXACT_LOCAL_BFF_REQUIRED');
  return value;
}
/** Production HTTP adapter: one attempt, no redirects/cookies/auth on public S3 reads. */
export function urlNetworkIo(base: string, transport?: NetworkTransport): Pick<UrlIo, 'range' | 'bff'> {
  localUrlBff(base);
  const network = new NetworkManager({
    ...(transport ? { transport } : {}),
    policies: {
      s3: {
        allowedOrigins: [PUBLIC_S3_ORIGIN],
        timeoutMilliseconds: 60_000,
        maxResponseBytes: 5 * 1024 * 1024,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store'
      },
      bff: {
        allowedOrigins: [base],
        timeoutMilliseconds: 180_000,
        maxRequestBytes: 64 * 1024,
        maxResponseBytes: 2 * 1024 * 1024,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store'
      }
    }
  });
  const cookies = new Map<string, string>();
  let csrf = '';
  const paths: Record<BffPhase, string> = {
    login: '/auth/login',
    meta: '/meta/get',
    storage: '/admin/storage/s3/get',
    context: '/gallery-transfers/context/get',
    'video.list': '/video-uploads/call',
    'video.create': '/video-uploads/call',
    'video.submit': '/video-uploads/call',
    'video.get': '/video-uploads/call',
    'video.verify': '/video-uploads/call',
    'video.baseline': '/operations/call'
  };
  return {
    async range(url, start, end, requestId) {
      assertSignedSource(url);
      const response = await network.request({
        service: 's3',
        url,
        method: 'GET',
        requestId,
        responseType: 'bytes',
        headers: { Range: `bytes=${start}-${end}` },
        maxAttempts: 1
      });
      if (!(response.data instanceof Uint8Array)) failUrlSmoke('PUBLIC_RANGE_INVALID');
      return { status: response.status, headers: response.headers, bytes: response.data };
    },
    async bff(phase, payload, requestId) {
      if (phase === 'video.baseline') assertBaselinePayload(payload);
      if (phase !== 'login' && (!csrf || !cookies.has('ov_session') || !cookies.has('ov_csrf')))
        failUrlSmoke('NORMAL_LOGIN_CSRF_REQUIRED');
      const response = await network.request({
        service: 'bff',
        url: `${base}/api/v1${paths[phase]}`,
        method: 'POST',
        requestId,
        // Keep HTTP status even when a proxy returns bounded non-JSON error text. Never persist that text.
        responseType: 'text',
        maxAttempts: 1,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          ...(cookies.size
            ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
            : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {})
        },
        body: JSON.stringify({ requestId, ...payload })
      });
      let value: unknown = null;
      try {
        value = typeof response.data === 'string' ? (JSON.parse(response.data) as unknown) : null;
      } catch {
        /* Invalid JSON: preserve only HTTP status and the generic stable code. */
      }
      if (
        !record(value) ||
        value.requestId !== requestId ||
        value.ok !== true ||
        !response.ok ||
        !('data' in value)
      )
        throw new BffDiagnosticError(
          record(value) && value.requestId === requestId && value.ok === false && record(value.error)
            ? value.error.code
            : undefined,
          response.status
        );
      for (const header of response.headers.getSetCookie()) {
        const match = /^(ov_session|ov_csrf)=([^;]+)(?:;|$)/u.exec(header);
        if (match?.[1] && match[2]) cookies.set(match[1], match[2]);
      }
      if (phase === 'login') {
        if (
          !record(value.data) ||
          !record(value.data.session) ||
          typeof value.data.session.csrfToken !== 'string' ||
          !value.data.session.csrfToken ||
          !cookies.has('ov_session') ||
          !cookies.has('ov_csrf')
        )
          failUrlSmoke('NORMAL_LOGIN_CSRF_REQUIRED');
        csrf = value.data.session.csrfToken;
      }
      return value.data;
    }
  };
}
