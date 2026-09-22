import { sha256 } from '@noble/hashes/sha2.js';
import { assertPublicPhotoUrl } from './photo-transfer';
import { decodeBase64 } from './encoded-file';
import { assertGalleryContextId } from './gallery-transfer-context';
import type { GalleryTransferContext } from './gallery-transfer-task';
import type { S3ObjectStorageClient, S3MultipartPart } from './s3-storage';
import {
  assertMp4Header,
  hashVideoBytes,
  hex,
  VIDEO_UPLOAD_PART_BYTES,
  VIDEO_UPLOAD_VERIFY_WINDOW_MS,
  validateVideoUploadRequest,
  validateVideoUploadTask,
  videoUploadFail,
  type VideoUploadTask,
  type VideoUploadRequest,
  type VideoUploadResult
} from './video-upload';

export interface VideoUploadRecord {
  task: VideoUploadTask;
  ownerId: string;
  uploadId: string | null;
  baselineIds: string[];
  busy: { action: string; until: number } | null;
  completeAttempted: boolean;
  submitAttempted: boolean;
  /** Optional for older records; once set, recovery can only verify or retry cancellation. */
  cancelAttempted?: boolean;
}
export interface VideoUploadRepository {
  get(id: string, ownerId: string): Promise<VideoUploadRecord | null>;
  list(ownerId: string): Promise<VideoUploadRecord[]>;
  /** Atomically insert or compare-and-swap. Throw on conflict; never fall back to memory. */
  save(record: VideoUploadRecord, expectedRevision: number | null): Promise<void>;
}
export interface VideoUploadPlatform {
  find(title: string): Promise<{ id: string; title: string | null }[]>;
  upload(url: string, title: string): Promise<{ accepted: boolean; traceId: string | null }>;
}
export interface VideoUploadRuntime {
  context: GalleryTransferContext;
  storage: VideoUploadStorage | null;
  platform: VideoUploadPlatform;
  enabled: boolean;
}
export type VideoUploadStorage = Pick<
  S3ObjectStorageClient,
  | 'createMultipart'
  | 'uploadPart'
  | 'listParts'
  | 'completeMultipart'
  | 'abortMultipart'
  | 'headVideoObject'
  | 'getVideoRange'
  | 'presignVideoGet'
  | 'checkPresignedVideoGet'
>;

export function parseVideoUploadRecord(value: unknown): VideoUploadRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) videoUploadFail('VIDEO_TASK_CORRUPT');
  const raw = value as Record<string, unknown>;
  if (
    !validateVideoUploadTask(raw.task) ||
    typeof raw.ownerId !== 'string' ||
    !(raw.uploadId === null || typeof raw.uploadId === 'string') ||
    !Array.isArray(raw.baselineIds) ||
    raw.baselineIds.length > 100 ||
    !raw.baselineIds.every((id: unknown) => typeof id === 'string') ||
    typeof raw.completeAttempted !== 'boolean' ||
    typeof raw.submitAttempted !== 'boolean' ||
    (raw.cancelAttempted !== undefined && typeof raw.cancelAttempted !== 'boolean')
  )
    videoUploadFail('VIDEO_TASK_CORRUPT');
  let busy: VideoUploadRecord['busy'] = null;
  if (raw.busy !== null) {
    if (
      !raw.busy ||
      typeof raw.busy !== 'object' ||
      !('action' in raw.busy) ||
      typeof raw.busy.action !== 'string' ||
      !('until' in raw.busy) ||
      typeof raw.busy.until !== 'number' ||
      !Number.isSafeInteger(raw.busy.until)
    )
      videoUploadFail('VIDEO_TASK_CORRUPT');
    busy = { action: raw.busy.action, until: raw.busy.until };
  }
  return {
    task: raw.task as VideoUploadTask,
    ownerId: raw.ownerId,
    uploadId: raw.uploadId,
    baselineIds: raw.baselineIds,
    busy,
    completeAttempted: raw.completeAttempted,
    submitAttempted: raw.submitAttempted,
    cancelAttempted: raw.cancelAttempted === true
  };
}

/** Synchronous request-sized commands, durable CAS receipts; never starts a background scheduler. */
export class VideoUploadService {
  constructor(
    private readonly repository: VideoUploadRepository,
    private readonly resolve: (
      context: GalleryTransferContext,
      requestId: string
    ) => Promise<VideoUploadRuntime>,
    private readonly now: () => number = Date.now
  ) {}

  async execute(ownerId: string, value: unknown): Promise<VideoUploadResult> {
    if (!validateVideoUploadRequest(value)) videoUploadFail('REQUEST_CONTRACT_INVALID');
    const request = structuredClone(value) as VideoUploadRequest;
    const runtime = await this.resolve(request.context, request.requestId);
    for (const field of ['identity', 'gateway', 'storage'] as const)
      assertGalleryContextId(request.context[field], runtime.context[field]);
    const command = request.command;
    if (command.action === 'list')
      return this.result(
        (await this.repository.list(ownerId)).map((item) => item.task),
        runtime.enabled
      );
    if (command.action === 'create') {
      if (!command.title.trim()) videoUploadFail('VIDEO_TITLE_REQUIRED');
      if ((await this.repository.list(ownerId)).length >= 100) videoUploadFail('VIDEO_TASK_LIMIT');
      const id = crypto.randomUUID();
      const file = command.source.kind === 'file' ? command.source.file : null;
      if (file && /[\\/\0]/u.test(file.fileName)) videoUploadFail('VIDEO_FILE_INVALID');
      const sourceFingerprint =
        file?.sha256 ??
        hashVideoBytes(
          new TextEncoder().encode(
            validateVideoSourceUrl(command.source.kind === 'url' ? command.source.url : '')
          )
        );
      const task: VideoUploadTask = {
        schemaVersion: 1,
        id,
        context: request.context,
        revision: 1,
        title: `${command.title.trim()} [ov-${id.slice(0, 8)}]`,
        source: command.source.kind,
        file,
        sourceFingerprint,
        objectKey: file ? `onevegetable/video-staging/${id}/source.mp4` : null,
        parts: file
          ? Array.from({ length: Math.ceil(file.byteLength / VIDEO_UPLOAD_PART_BYTES) }, (_, index) => ({
              partNumber: index + 1,
              byteLength: Math.min(
                VIDEO_UPLOAD_PART_BYTES,
                file.byteLength - index * VIDEO_UPLOAD_PART_BYTES
              ),
              sha256: null,
              etag: null,
              status: 'pending',
              requestId: null
            }))
          : [],
        status: 'prepared',
        createTimeUtc: this.now(),
        updateTimeUtc: this.now(),
        acceptedTimeUtc: null,
        videoId: null,
        traceId: null,
        reasonCode: null,
        requestId: request.requestId
      };
      await this.repository.save(
        {
          task,
          ownerId,
          uploadId: null,
          baselineIds: [],
          busy: null,
          completeAttempted: false,
          submitAttempted: false
        },
        null
      );
      return this.result([task], runtime.enabled);
    }
    const stored = await this.repository.get(command.taskId, ownerId);
    if (!stored || !validateVideoUploadTask(stored.task)) videoUploadFail('VIDEO_TASK_NOT_FOUND');
    for (const field of ['identity', 'gateway', 'storage'] as const)
      assertGalleryContextId(stored.task.context[field], runtime.context[field]);
    if (command.action === 'get') return this.result([stored.task], runtime.enabled);
    if (command.revision !== stored.task.revision) videoUploadFail('ENTITY_VERSION_CONFLICT');
    if (stored.busy && stored.busy.until > this.now()) videoUploadFail('VIDEO_TASK_BUSY');
    if (['confirmed', 'cancelled'].includes(stored.task.status)) videoUploadFail('VIDEO_TASK_TERMINAL');
    const record = structuredClone(stored);
    // Crashed/in-flight requests are evidence of possible writes, never retry instructions.
    for (const part of record.task.parts) if (part.status === 'in-flight') part.status = 'unknown';
    if (
      record.busy &&
      command.action !== 'reconcile' &&
      command.action !== 'verify' &&
      command.action !== 'cancel'
    )
      videoUploadFail('VIDEO_RECONCILIATION_REQUIRED');
    if (['initiate', 'part', 'complete', 'submit', 'cancel'].includes(command.action) && !runtime.enabled)
      videoUploadFail('VIDEO_UPLOAD_DISABLED');
    record.busy = { action: command.action, until: this.now() + 90_000 };
    record.task.requestId = request.requestId;
    await this.save(record);
    try {
      await this.command(record, request, runtime);
      record.busy = null;
      await this.save(record);
    } catch (error) {
      // The current owner won the CAS. Never attempt to persist this stale snapshot again.
      if (error instanceof Error && error.message === 'ENTITY_VERSION_CONFLICT') throw error;
      // Keep the original request deadline after an uncertain part write. ListParts must not
      // race a request which may still be completing remotely after a client-side timeout.
      const uncertainPart = record.task.parts.some((part) => part.status === 'in-flight');
      if (!uncertainPart) record.busy = null;
      record.task.status = 'needs-review';
      // Never persist provider text: it may echo a signed URL or credentials.
      record.task.reasonCode = record.cancelAttempted
        ? 'VIDEO_CANCELLATION_PENDING'
        : 'VIDEO_RESULT_REQUIRES_REVIEW';
      for (const part of record.task.parts) if (part.status === 'in-flight') part.status = 'unknown';
      await this.save(record);
      throw error;
    }
    return this.result([record.task], runtime.enabled);
  }

  private async command(
    record: VideoUploadRecord,
    request: VideoUploadRequest,
    runtime: VideoUploadRuntime
  ): Promise<void> {
    const { command, requestId } = request;
    const task = record.task;
    const storage = runtime.storage;
    const key = task.objectKey;
    if (record.cancelAttempted && !['cancel', 'reconcile'].includes(command.action))
      videoUploadFail('VIDEO_CANCELLATION_PENDING');
    if (command.action === 'reconcile' && record.cancelAttempted) {
      if (!storage || !key || !record.uploadId) videoUploadFail('VIDEO_CANCELLATION_PENDING');
      await this.verifyCancellation(record, storage, key, requestId);
      return;
    }
    if (command.action === 'verify') {
      if (!record.submitAttempted) videoUploadFail('VIDEO_NOT_SUBMITTED');
      const found = (await runtime.platform.find(task.title)).filter(
        (item) => item.title === task.title && !record.baselineIds.includes(item.id)
      );
      if (found.length === 1 && found[0]) {
        task.videoId = found[0].id;
        task.status = 'confirmed';
        task.reasonCode = null;
      } else {
        task.status =
          task.acceptedTimeUtc !== null && this.now() - task.acceptedTimeUtc < VIDEO_UPLOAD_VERIFY_WINDOW_MS
            ? 'accepted'
            : 'needs-review';
        task.reasonCode = found.length > 1 ? 'VIDEO_RESULT_AMBIGUOUS' : 'VIDEO_PENDING_READBACK';
      }
      return;
    }
    if (command.action === 'submit') {
      if (record.submitAttempted) videoUploadFail('VIDEO_ALREADY_SUBMITTED');
      let url: string;
      if (task.source === 'file') {
        if (!storage || !key || task.status !== 'staged') videoUploadFail('VIDEO_NOT_STAGED');
        url = await storage.presignVideoGet(key);
        await storage.checkPresignedVideoGet(url, requestId);
      } else {
        url = validateVideoSourceUrl(command.sourceUrl ?? '');
        if (hashVideoBytes(new TextEncoder().encode(url)) !== task.sourceFingerprint)
          videoUploadFail('VIDEO_SOURCE_CHANGED');
      }
      record.baselineIds = (await runtime.platform.find(task.title)).map((item) => item.id);
      record.submitAttempted = true;
      task.status = 'submitting';
      // Persist BEFORE Alibaba sees the mutation. A lost response can never resubmit this task.
      await this.save(record);
      const response = await runtime.platform.upload(url, task.title);
      task.traceId = response.traceId;
      task.status = response.accepted ? 'accepted' : 'needs-review';
      task.acceptedTimeUtc = response.accepted ? this.now() : null;
      task.reasonCode = response.accepted ? 'VIDEO_PENDING_READBACK' : 'VIDEO_RESULT_REQUIRES_REVIEW';
      return;
    }
    if (command.action === 'cancel') {
      if (record.submitAttempted || (record.completeAttempted && task.status !== 'staged'))
        videoUploadFail('VIDEO_REMOTE_RESULT_PRESERVED');
      if (!record.completeAttempted && record.uploadId) {
        if (!storage || !key) videoUploadFail('S3_STORAGE_NOT_CONFIGURED');
        record.cancelAttempted = true;
        task.status = 'needs-review';
        task.reasonCode = 'VIDEO_CANCELLATION_PENDING';
        await this.save(record);
        await storage.abortMultipart(key, record.uploadId, requestId);
        await this.verifyCancellation(record, storage, key, requestId);
        return;
      }
      // A lost initiation response may have created a remote upload whose ID is unknown.
      if (task.source === 'file' && !record.completeAttempted && task.status !== 'prepared')
        videoUploadFail('VIDEO_CANCELLATION_PENDING');
      task.status = 'cancelled';
      task.reasonCode = null;
      return;
    }
    if (!storage || !key || !task.file) videoUploadFail('S3_STORAGE_NOT_CONFIGURED');
    if (record.submitAttempted) videoUploadFail('VIDEO_ALREADY_SUBMITTED');
    if (command.action === 'initiate') {
      if (record.uploadId || task.status !== 'prepared') videoUploadFail('VIDEO_RECONCILIATION_REQUIRED');
      task.status = 'staging';
      await this.save(record);
      record.uploadId = await storage.createMultipart(key, requestId);
      return;
    }
    if (command.action === 'reconcile' && record.completeAttempted) {
      await this.verifyObject(record, storage, key, requestId);
      return;
    }
    if (!record.uploadId) videoUploadFail('VIDEO_MULTIPART_NOT_STARTED');
    if (command.action === 'reconcile') {
      const remote = await storage.listParts(key, record.uploadId, requestId);
      if (remote === null) videoUploadFail('VIDEO_MULTIPART_NOT_STARTED');
      for (const part of task.parts) {
        const found = remote.find((item) => item.partNumber === part.partNumber);
        if (part.status === 'pending') {
          if (found) videoUploadFail('VIDEO_PART_CONFLICT');
          continue;
        }
        if (
          found?.size === part.byteLength &&
          (part.etag === found.etag || (part.sha256 && found.checksumSha256 === hexToBase64(part.sha256)))
        ) {
          part.status = 'confirmed';
          part.etag = found.etag;
        } else if (!found && part.status === 'unknown') {
          // ListParts is authoritative for this upload ID after the old request deadline.
          part.status = 'pending';
          part.etag = null;
        } else videoUploadFail('VIDEO_PART_RECONCILIATION_FAILED');
      }
      task.status = 'staging';
      task.reasonCode = null;
      return;
    }
    if (command.action === 'part') {
      if (record.completeAttempted || command.fileSha256 !== task.file.sha256)
        videoUploadFail('VIDEO_FILE_CHANGED');
      const part = task.parts.find((item) => item.partNumber === command.partNumber);
      if (part?.status !== 'pending') videoUploadFail('VIDEO_RECONCILIATION_REQUIRED');
      const bytes = decodeBase64(command.contentBase64);
      if (bytes.byteLength !== part.byteLength || bytes.byteLength > VIDEO_UPLOAD_PART_BYTES)
        videoUploadFail('VIDEO_PART_INVALID');
      if (command.partNumber === 1) assertMp4Header(bytes);
      part.status = 'in-flight';
      part.sha256 = hashVideoBytes(bytes);
      part.requestId = requestId;
      await this.save(record);
      const receipt = await storage.uploadPart(key, record.uploadId, command.partNumber, bytes, requestId);
      part.status = 'confirmed';
      part.etag = receipt.etag;
      task.status = 'staging';
      return;
    }
    if (command.action === 'complete') {
      if (record.completeAttempted) videoUploadFail('VIDEO_RECONCILIATION_REQUIRED');
      const parts: S3MultipartPart[] = task.parts.map((part) => {
        if (part.status !== 'confirmed' || !part.etag || !part.sha256)
          videoUploadFail('VIDEO_PARTS_INCOMPLETE');
        return {
          partNumber: part.partNumber,
          size: part.byteLength,
          etag: part.etag,
          checksumSha256: hexToBase64(part.sha256)
        };
      });
      record.completeAttempted = true;
      await this.save(record);
      await storage.completeMultipart(key, record.uploadId, parts, requestId);
      await this.verifyObject(record, storage, key, requestId);
    }
  }

  private async verifyObject(
    record: VideoUploadRecord,
    storage: VideoUploadStorage,
    key: string,
    requestId: string
  ): Promise<void> {
    const file = record.task.file;
    const head = await storage.headVideoObject(key, requestId);
    if (!file || head?.size !== file.byteLength) videoUploadFail('VIDEO_OBJECT_NOT_CONFIRMED');
    const digest = sha256.create();
    for (let start = 0; start < head.size; start += VIDEO_UPLOAD_PART_BYTES) {
      if (record.busy) record.busy.until = this.now() + 90_000;
      await this.save(record);
      digest.update(
        await storage.getVideoRange(
          key,
          start,
          Math.min(start + VIDEO_UPLOAD_PART_BYTES, head.size) - 1,
          requestId
        )
      );
    }
    if (hex(digest.digest()) !== file.sha256) videoUploadFail('VIDEO_FILE_CHANGED');
    record.task.status = 'staged';
    record.task.reasonCode = null;
  }
  private async save(record: VideoUploadRecord): Promise<void> {
    const revision = record.task.revision;
    const next = { ...record, task: { ...record.task, revision: revision + 1, updateTimeUtc: this.now() } };
    await this.repository.save(next, revision);
    record.task.revision = next.task.revision;
    record.task.updateTimeUtc = next.task.updateTimeUtc;
  }
  private async verifyCancellation(
    record: VideoUploadRecord,
    storage: VideoUploadStorage,
    key: string,
    requestId: string
  ): Promise<void> {
    if (!record.uploadId) videoUploadFail('VIDEO_CANCELLATION_PENDING');
    // Even an empty successful list still describes an extant upload. Only explicit
    // NoSuchUpload confirms that this task's upload ID can no longer accept parts.
    const removed = (await storage.listParts(key, record.uploadId, requestId)) === null;
    record.task.status = removed ? 'cancelled' : 'needs-review';
    record.task.reasonCode = removed ? null : 'VIDEO_CANCELLATION_PENDING';
  }
  private result(tasks: VideoUploadTask[], uploadEnabled: boolean): VideoUploadResult {
    return { tasks, uploadEnabled };
  }
}

export function validateVideoSourceUrl(value: string): string {
  try {
    const url = assertPublicPhotoUrl(value);
    if (url.protocol !== 'https:' || url.hash) videoUploadFail('VIDEO_PUBLIC_SOURCE_REQUIRED');
    return url.href;
  } catch {
    return videoUploadFail('VIDEO_PUBLIC_SOURCE_REQUIRED');
  }
}
function hexToBase64(value: string): string {
  return btoa(
    String.fromCharCode(...Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)))
  );
}
