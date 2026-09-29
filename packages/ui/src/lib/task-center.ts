import { isProductMutationJobPage, type ProductMutationJob } from '@one-vegetable/core';
import { requireGalleryContext } from '@one-vegetable/core/gallery-transfer-context';
import { GatewayException } from '@one-vegetable/core/errors';
import {
  validateGalleryTransferTask,
  type GalleryTransferContext,
  type GalleryTransferTaskV1
} from '@one-vegetable/core/gallery-transfer-task';
import {
  validateVideoUploadResult,
  type VideoUploadResult,
  type VideoUploadTask
} from '@one-vegetable/core/video-upload';
import {
  validateVideoAssociationResult,
  validateVideoAssociationVerifyRequest
} from '@one-vegetable/core/video-association';
import type { IndexedDbGalleryTaskRepository } from './gallery-task-repository';
import type { VideoAssociationReceipt } from './product-video-association';
import type { AppServices } from './services';
import { VIDEO_ASSOCIATION_PREFIX } from './video-association-storage';

export type TaskSource = 'product' | 'gallery' | 'video-upload' | 'video-association';
export type TaskState =
  'pending' | 'running' | 'submitted' | 'confirmed' | 'attention' | 'failed' | 'cancelled';
export type TaskGuidance =
  'none' | 'verify' | 'login' | 'unlock' | 'permission' | 'configuration' | 'file' | 'inspect';

export interface TaskSummary {
  id: string;
  source: TaskSource;
  sourceId: string;
  title: string;
  operation: string;
  status: TaskState;
  rawStatus: string;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  requestId: string | null;
  traceId: string | null;
  reasonCode: string | null;
  resourceId: string | null;
  contextChanged: boolean;
  accountMatch: 'matched' | 'changed' | 'unknown';
  guidance: TaskGuidance;
  steps: {
    id: string;
    label: string;
    status: string;
    requestId: string | null;
    resourceId: string | null;
  }[];
  batchItemId?: string;
  maintenanceBatchId?: string;
}

export interface TaskCenterSnapshot {
  context: GalleryTransferContext;
  items: TaskSummary[];
  errors: { source: TaskSource; code: string }[];
  unscopedQueueCount: number;
  productHasMore: boolean;
}

export class TaskCenterError extends Error {
  constructor(readonly code: 'TASK_CONTEXT_CHANGED' | 'TASK_CONTEXT_UNAVAILABLE') {
    super(code);
    this.name = 'TaskCenterError';
  }
}

export const TASK_PRODUCT_PAGE_SIZE = 100;
// Deliberately do not import the queue loader: it migrates, prunes and writes storage.
const QUEUE_KEYS = [
  'one-vegetable-product-batch-publish-v2',
  'one-vegetable-product-batch-publish-v1'
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identifier = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) ? value : null;

/** No free-form provider messages, URLs, credentials or validator diagnostics escape this boundary. */
export function taskReasonCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/u.test(value) ? value : null;
}

/** Extract code-shaped errors only, never the provider's human-readable failure message. */
export function taskErrorCode(error: unknown): string {
  const gatewayCode = error instanceof GatewayException ? taskReasonCode(error.gatewayError.code) : null;
  return (
    gatewayCode ??
    (record(error) ? (taskReasonCode(error.code) ?? taskReasonCode(error.message)) : null) ??
    'TASK_SOURCE_UNAVAILABLE'
  );
}

export function taskContextStamp(context: GalleryTransferContext): string {
  return JSON.stringify([context.identity, context.gateway, context.storage]);
}

export function taskGuidance(
  reasonCode: string | null,
  status: TaskState,
  contextChanged = false
): TaskGuidance {
  if (contextChanged) return 'configuration';
  if (reasonCode) {
    if (/UNLOCK|VAULT_LOCKED/u.test(reasonCode)) return 'unlock';
    if (/AUTHENTICATION|UNAUTHENTICATED|LOGIN|SESSION_EXPIRED|TOKEN_EXPIRED/u.test(reasonCode))
      return 'login';
    if (/PERMISSION|FORBIDDEN|CAPABILITY_RESTRICTED|ACCESS_DENIED/u.test(reasonCode)) return 'permission';
    if (/CONFIGURATION|NOT_CONFIGURED|CONTEXT_CHANGED|DISABLED|UNAVAILABLE/u.test(reasonCode))
      return 'configuration';
    if (/FILE_|ARCHIVE_|RESELECT/u.test(reasonCode)) return 'file';
    if (/UNKNOWN|UNCONFIRMED|READBACK|REQUIRES_REVIEW|AMBIGUOUS|RESULT_UNCLEAR/u.test(reasonCode))
      return 'verify';
  }
  if (status === 'submitted') return 'verify';
  if (status === 'attention' || status === 'failed' || reasonCode) return 'inspect';
  return 'none';
}

function summary(
  source: TaskSource,
  sourceId: string,
  rawStatus: string,
  status: TaskState,
  createdAt: number,
  updatedAt: number
): TaskSummary {
  if (!identifier(sourceId) || !timestamp(createdAt) || !timestamp(updatedAt))
    throw new Error('TASK_RECORD_INVALID');
  return {
    id: `${source}:${sourceId}`,
    source,
    sourceId,
    title: '',
    operation: '',
    status,
    rawStatus,
    createdAt,
    updatedAt,
    lastCheckedAt: null,
    requestId: null,
    traceId: null,
    reasonCode: null,
    resourceId: null,
    contextChanged: false,
    accountMatch: 'matched',
    guidance: 'none',
    steps: []
  };
}

/** A recovered write was rolled back, not successfully applied. Only verified means confirmed. */
export function mapProductTask(job: ProductMutationJob, context?: GalleryTransferContext): TaskSummary {
  const states: Record<ProductMutationJob['status'], TaskState> = {
    submitted: 'submitted',
    auditing: 'submitted',
    verifying: 'submitted',
    verified: 'confirmed',
    'recovery-required': 'attention',
    recovering: 'running',
    recovered: 'cancelled',
    failed: 'failed'
  };
  const item = summary(
    'product',
    job.id,
    job.status,
    states[job.status],
    job.createTimeUtc,
    job.updateTimeUtc
  );
  item.operation = job.operation;
  // Old receipts never infer ownership. New maintenance receipts ignore unrelated S3 changes.
  item.accountMatch = 'unknown';
  if (job.productContext && context) {
    item.contextChanged =
      job.productContext.identity !== context.identity || job.productContext.gateway !== context.gateway;
    item.accountMatch = item.contextChanged ? 'changed' : 'matched';
  }
  if (job.batchId) item.maintenanceBatchId = job.batchId;
  item.lastCheckedAt = timestamp(job.lastCheckedTimeUtc) ? job.lastCheckedTimeUtc : null;
  item.requestId = identifier(job.requestId);
  item.traceId = identifier(job.traceId);
  item.resourceId = identifier(job.productId);
  item.reasonCode = taskReasonCode(job.reasonCode);
  item.guidance = taskGuidance(item.reasonCode, item.status, item.contextChanged);
  return item;
}

/** Identity mismatches are omitted. Gateway/storage changes are visible but never actionable here. */
export function mapGalleryTask(
  task: GalleryTransferTaskV1,
  context: GalleryTransferContext
): TaskSummary | null {
  if (task.context.identity !== context.identity) return null;
  const unknown = task.items.some((item) => item.status === 'unknown');
  const unconfirmed = task.items.some((item) => item.status === 'unconfirmed');
  const failed = task.items.some((item) => item.status === 'failed');
  const unresolvedRunning = task.items.some((item) => item.status === 'running' && item.mutation);
  let status: TaskState;
  if (task.status === 'cancelled')
    status = unknown || unconfirmed || unresolvedRunning ? 'attention' : 'cancelled';
  else if (unknown) status = 'attention';
  else if (unconfirmed) status = 'submitted';
  else if (task.status === 'running') status = 'running';
  else if (failed || unresolvedRunning) status = 'attention';
  else if (task.status === 'completed')
    status =
      task.items.length > 0 && task.items.every((item) => ['confirmed', 'skipped'].includes(item.status))
        ? 'confirmed'
        : 'attention';
  else status = task.status === 'pending' ? 'pending' : 'attention';
  const item = summary('gallery', task.id, task.status, status, task.createTimeUtc, task.updateTimeUtc);
  item.operation = `${task.direction}-${task.storage}`;
  item.contextChanged = taskContextStamp(task.context) !== taskContextStamp(context);
  item.accountMatch = task.context.gateway === context.gateway ? 'matched' : 'changed';
  item.reasonCode =
    taskReasonCode(task.errorCode) ??
    task.items.map((step) => taskReasonCode(step.errorCode)).find((code) => code !== null) ??
    (unknown || (unresolvedRunning && task.status !== 'running')
      ? 'GALLERY_RESULT_UNKNOWN'
      : unconfirmed
        ? 'GALLERY_RESULT_UNCONFIRMED'
        : failed
          ? 'GALLERY_ITEM_FAILED'
          : null);
  item.steps = task.items.map((step, index) => ({
    id: identifier(step.id) ?? `step-${index + 1}`,
    label: step.kind,
    status: step.status,
    requestId: identifier(step.requestId),
    resourceId: identifier(step.fileId) ?? identifier(step.targetGroupId)
  }));
  item.requestId = item.steps.find((step) => step.requestId !== null)?.requestId ?? null;
  item.resourceId = item.steps.find((step) => step.resourceId !== null)?.resourceId ?? null;
  item.guidance = taskGuidance(item.reasonCode, status, item.contextChanged);
  // Cancellation never erases an unresolved write or the need to verify it.
  if (
    !item.contextChanged &&
    (unknown || unconfirmed || (unresolvedRunning && task.status !== 'running')) &&
    ['none', 'inspect'].includes(item.guidance)
  )
    item.guidance = 'verify';
  return item;
}

export function mapVideoUploadTask(
  task: VideoUploadTask,
  context: GalleryTransferContext
): TaskSummary | null {
  if (task.context.identity !== context.identity) return null;
  const states: Record<VideoUploadTask['status'], TaskState> = {
    prepared: 'pending',
    staging: 'running',
    staged: 'pending',
    submitting: 'attention',
    accepted: 'submitted',
    'needs-review': 'attention',
    confirmed: 'confirmed',
    cancelled: 'cancelled',
    failed: 'failed'
  };
  const item = summary(
    'video-upload',
    task.id,
    task.status,
    states[task.status],
    task.createTimeUtc,
    task.updateTimeUtc
  );
  const invalidConfirmation =
    task.status === 'confirmed' &&
    (!identifier(task.videoId) ||
      !/^[1-9][0-9]*$/u.test(task.videoId ?? '') ||
      task.parts.some((part) => part.status !== 'confirmed'));
  if (invalidConfirmation) item.status = 'attention';
  // Titles are display text, never source URLs/data URLs. No file, S3 key or fingerprint is copied.
  item.title =
    task.title.length <= 256 && !/(?:https?:|data:|base64|[\p{Cc}])/iu.test(task.title) ? task.title : '';
  item.operation = task.source;
  item.contextChanged = taskContextStamp(task.context) !== taskContextStamp(context);
  item.accountMatch = task.context.gateway === context.gateway ? 'matched' : 'changed';
  item.requestId = identifier(task.requestId);
  item.traceId = identifier(task.traceId);
  item.resourceId = identifier(task.videoId);
  item.reasonCode =
    taskReasonCode(task.reasonCode) ??
    (invalidConfirmation
      ? 'VIDEO_CONFIRMATION_INVALID'
      : task.status === 'submitting' || task.status === 'needs-review'
        ? 'VIDEO_RESULT_UNKNOWN'
        : null);
  item.steps = task.parts.map((part) => ({
    id: `part-${part.partNumber}`,
    label: `part-${part.partNumber}`,
    status: part.status,
    requestId: identifier(part.requestId),
    resourceId: null
  }));
  item.guidance = taskGuidance(item.reasonCode, item.status, item.contextChanged);
  if (invalidConfirmation && !item.contextChanged && ['none', 'inspect'].includes(item.guidance))
    item.guidance = 'verify';
  if (item.guidance === 'none' && task.source === 'file' && ['prepared', 'staging'].includes(task.status))
    item.guidance = 'file';
  return item;
}

export function parseVideoAssociationReceipt(value: unknown, productId: string): VideoAssociationReceipt {
  if (
    !record(value) ||
    value.version !== 1 ||
    !identifier(value.requestId) ||
    !validateVideoAssociationVerifyRequest(value.request) ||
    !record(value.request) ||
    value.request.productId !== productId ||
    !validateVideoAssociationResult({ outcome: value.outcome, traceId: value.traceId, code: value.code }) ||
    !(value.state === value.outcome || (value.state === 'sending' && value.outcome === 'unknown')) ||
    !timestamp(value.updatedAt)
  )
    throw new Error('TASK_ASSOCIATION_INVALID');
  // These existing AJV validators establish the receipt's request/result types.
  return value as unknown as VideoAssociationReceipt;
}

export function mapVideoAssociationTask(receipt: VideoAssociationReceipt): TaskSummary {
  const states: Record<VideoAssociationReceipt['state'], TaskState> = {
    sending: 'attention',
    unknown: 'attention',
    unconfirmed: 'submitted',
    confirmed: 'confirmed',
    rejected: 'failed'
  };
  // The durable store has one receipt per product in a given mode/identity/gateway.
  const item = summary(
    'video-association',
    receipt.request.productId,
    receipt.state,
    states[receipt.state],
    receipt.updatedAt,
    receipt.updatedAt
  );
  item.operation = receipt.request.type;
  item.requestId = identifier(receipt.requestId);
  item.traceId = identifier(receipt.traceId);
  item.resourceId = identifier(receipt.request.productId);
  item.reasonCode =
    taskReasonCode(receipt.code) ??
    (['sending', 'unknown'].includes(receipt.state) ? 'VIDEO_ASSOCIATION_RESULT_UNKNOWN' : null);
  item.steps = [
    {
      id: receipt.request.type,
      label: receipt.request.type,
      status: receipt.state,
      requestId: item.requestId,
      resourceId: identifier(receipt.request.videoId)
    }
  ];
  item.guidance = taskGuidance(item.reasonCode, item.status);
  if (['sending', 'unknown'].includes(receipt.state) && ['none', 'inspect'].includes(item.guidance))
    item.guidance = 'verify';
  return item;
}

type Warning = TaskCenterSnapshot['errors'][number];
interface SourceRead {
  items: TaskSummary[];
  errors: Warning[];
}
const warning = (source: TaskSource, code: string): Warning => ({ source, code });

function readAssociations(
  storage: Storage,
  mode: AppServices['mode'],
  context: GalleryTransferContext
): SourceRead {
  const items: TaskSummary[] = [],
    errors: Warning[] = [];
  const stamp = JSON.stringify([context.identity, context.gateway]);
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(VIDEO_ASSOCIATION_PREFIX)) continue;
    try {
      const scope: unknown = JSON.parse(key.slice(VIDEO_ASSOCIATION_PREFIX.length));
      if (!Array.isArray(scope) || scope.length !== 3 || !scope.every((v: unknown) => typeof v === 'string'))
        throw new Error('TASK_ASSOCIATION_INVALID');
      if (scope[0] !== mode || scope[1] !== stamp) continue;
      const productId: unknown = scope[2];
      if (typeof productId !== 'string' || !/^[1-9][0-9]*$/u.test(productId))
        throw new Error('TASK_ASSOCIATION_INVALID');
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const value: unknown = JSON.parse(raw);
      items.push(mapVideoAssociationTask(parseVideoAssociationReceipt(value, productId)));
    } catch {
      errors.push(warning('video-association', 'TASK_ASSOCIATION_INVALID'));
    }
  }
  return { items, errors };
}

/** Workbench job linkage is NOT proof of Alibaba account ownership. Never migrates or exposes content. */
export function bindTaskBatchItems(
  storage: Storage,
  products: readonly TaskSummary[]
): {
  items: TaskSummary[];
  unscopedQueueCount: number;
  errors: Warning[];
} {
  const items = products.map((item) => ({ ...item }));
  const errors: Warning[] = [];
  let unscopedQueueCount = 0;
  const jobs = new Map(
    items.filter((item) => item.source === 'product').map((item) => [item.sourceId, item])
  );
  try {
    // Mirror the current queue's v2-first lookup, without performing its destructive migration.
    const raw = storage.getItem(QUEUE_KEYS[0]) ?? storage.getItem(QUEUE_KEYS[1]);
    if (raw === null) return { items, unscopedQueueCount, errors };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('TASK_QUEUE_INVALID');
    const values: unknown[] = parsed;
    for (const value of values) {
      if (
        !record(value) ||
        (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
        !identifier(value.id) ||
        (value.schemaVersion === 2 && value.mutationJobId !== null && !identifier(value.mutationJobId))
      ) {
        unscopedQueueCount++;
        errors.push(warning('product', 'TASK_QUEUE_INVALID'));
        continue;
      }
      const jobId = value.schemaVersion === 2 ? identifier(value.mutationJobId) : null;
      const job = jobId ? jobs.get(jobId) : undefined;
      const batchId = identifier(value.id);
      if (job && batchId) {
        job.batchItemId ??= batchId;
      } else unscopedQueueCount++;
    }
  } catch {
    errors.push(warning('product', 'TASK_QUEUE_INVALID'));
  }
  return { items, unscopedQueueCount, errors };
}

async function contextFor(services: AppServices): Promise<GalleryTransferContext> {
  try {
    // No mock/anonymous/settings fallback. Copy scalars so mutation of a shared object is detected.
    const context = requireGalleryContext(await services.gateway.galleryTransferContext?.());
    return { identity: context.identity, gateway: context.gateway, storage: context.storage };
  } catch {
    throw new TaskCenterError('TASK_CONTEXT_UNAVAILABLE');
  }
}

async function isolated(
  source: TaskSource,
  read: () => Promise<SourceRead> | SourceRead
): Promise<SourceRead> {
  try {
    return await read();
  } catch (error) {
    return { items: [], errors: [warning(source, taskErrorCode(error))] };
  }
}

/**
 * One explicit product page, all other sources once. Video list contains at most 100 recent records,
 * not a complete historical archive. This function never starts, recovers or verifies work.
 * Gallery list retains its existing repository-level retention/quarantine policy; no extra cleanup
 * or migration is performed here. LocalStorage values are never changed, including malformed data.
 */
export async function loadTaskCenterSnapshot(
  services: AppServices,
  repository: Pick<IndexedDbGalleryTaskRepository, 'list'>,
  storage: Storage,
  isCurrent: () => boolean = () => true,
  productPage = 1
): Promise<TaskCenterSnapshot> {
  if (!isCurrent()) throw new TaskCenterError('TASK_CONTEXT_CHANGED');
  const context = await contextFor(services);
  if (!isCurrent()) throw new TaskCenterError('TASK_CONTEXT_CHANGED');
  let productHasMore = false;
  const [product, gallery, uploads, associations] = await Promise.all([
    isolated('product', async () => {
      if (!Number.isSafeInteger(productPage) || productPage < 1) throw new Error('TASK_PAGE_INVALID');
      if (!services.productMutationJobs) throw new Error('TASK_SOURCE_UNAVAILABLE');
      const page: unknown = await services.productMutationJobs.list({
        page: productPage,
        pageSize: TASK_PRODUCT_PAGE_SIZE
      });
      if (
        !isProductMutationJobPage(page) ||
        page.page !== productPage ||
        page.pageSize !== TASK_PRODUCT_PAGE_SIZE
      )
        return { items: [], errors: [warning('product', 'TASK_PRODUCT_INVALID')] };
      const items: TaskSummary[] = [],
        errors: Warning[] = [];
      for (const job of page.items.slice(0, TASK_PRODUCT_PAGE_SIZE)) {
        try {
          items.push(mapProductTask(job, context));
        } catch {
          errors.push(warning('product', 'TASK_PRODUCT_INVALID'));
        }
      }
      productHasMore = productPage * TASK_PRODUCT_PAGE_SIZE < page.total;
      if (page.items.length > TASK_PRODUCT_PAGE_SIZE)
        errors.push(warning('product', 'TASK_PRODUCT_TRUNCATED'));
      return { items, errors };
    }),
    isolated('gallery', async () => {
      const values: unknown = await repository.list();
      if (!Array.isArray(values)) return { items: [], errors: [warning('gallery', 'TASK_GALLERY_INVALID')] };
      const items: TaskSummary[] = [],
        errors: Warning[] = [];
      for (const value of values) {
        try {
          const item = mapGalleryTask(validateGalleryTransferTask(value), context);
          if (item) items.push(item);
        } catch {
          errors.push(warning('gallery', 'TASK_GALLERY_INVALID'));
        }
      }
      return { items, errors };
    }),
    isolated('video-upload', async () => {
      const call =
        services.videoUploads?.videoUpload.bind(services.videoUploads) ??
        services.s3Storage?.videoUpload?.bind(services.s3Storage) ??
        services.control?.videoUpload?.bind(services.control);
      if (!call) throw new Error('TASK_SOURCE_UNAVAILABLE');
      const result: unknown = await call({ action: 'list' }, { ...context });
      if (!validUploads(result))
        return { items: [], errors: [warning('video-upload', 'TASK_VIDEO_UPLOAD_INVALID')] };
      const items: TaskSummary[] = [],
        errors: Warning[] = [];
      for (const task of result.tasks) {
        try {
          const item = mapVideoUploadTask(task, context);
          if (item) items.push(item);
        } catch {
          errors.push(warning('video-upload', 'TASK_VIDEO_UPLOAD_INVALID'));
        }
      }
      return { items, errors };
    }),
    isolated('video-association', () => readAssociations(storage, services.mode, context))
  ]);
  const queue = bindTaskBatchItems(storage, product.items);
  // Even partially successful results belong to the original context, never the next account.
  const latest = await contextFor(services);
  if (!isCurrent() || taskContextStamp(latest) !== taskContextStamp(context))
    throw new TaskCenterError('TASK_CONTEXT_CHANGED');
  const errors = [
    ...product.errors,
    ...gallery.errors,
    ...uploads.errors,
    ...associations.errors,
    ...queue.errors
  ];
  return {
    context,
    items: [...queue.items, ...gallery.items, ...uploads.items, ...associations.items].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
    ),
    errors: errors.filter(
      (error, index) =>
        errors.findIndex((other) => other.source === error.source && other.code === error.code) === index
    ),
    unscopedQueueCount: queue.unscopedQueueCount,
    productHasMore
  };
}

function validUploads(value: unknown): value is VideoUploadResult {
  return validateVideoUploadResult(value);
}
