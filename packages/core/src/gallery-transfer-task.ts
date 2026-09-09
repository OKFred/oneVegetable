/** Local metadata only. Never persist file bytes, credentials or provider response bodies here. */
import type { components } from './generated/api';
export type GalleryTransferContext = components['schemas']['GalleryTransferContext'];
export type GalleryTransferTaskStatus =
  'pending' | 'running' | 'paused' | 'attention' | 'completed' | 'cancelled';
export type GalleryTransferItemStatus =
  'pending' | 'running' | 'unconfirmed' | 'confirmed' | 'failed' | 'unknown' | 'skipped';
export interface GalleryTransferItemV1 {
  id: string;
  kind: 'group' | 'asset' | 'manifest' | 'archive';
  status: GalleryTransferItemStatus;
  mutation: boolean;
  sourcePath: string;
  sourcePhotoId: string | null;
  sourceUrl: string | null;
  sourceSize: number | null;
  sourceEtag: string | null;
  sha256: string | null;
  contentType: string | null;
  targetPath: string;
  targetGroupId: string | null;
  parentItemId: string | null;
  fileName: string;
  requestId: string | null;
  fileId: string | null;
  errorCode: string | null;
  skipReason: string | null;
}
export interface GalleryTransferTaskV1 {
  schemaVersion: 1;
  id: string;
  direction: 'import' | 'export';
  storage: 'zip' | 's3';
  status: GalleryTransferTaskStatus;
  command: 'pause' | 'cancel' | null;
  context: GalleryTransferContext;
  createTimeUtc: number;
  updateTimeUtc: number;
  revision: number;
  archiveSha256: string | null;
  archiveName: string | null;
  batchPrefix: string;
  conflictPolicy: 'skip' | 'rename';
  createMissingGroups: boolean;
  errorCode: string | null;
  items: GalleryTransferItemV1[];
}
export const GALLERY_TASK_LIMIT = 100;
export const GALLERY_TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const GALLERY_TASK_LOCK = 'one-vegetable.gallery-transfer.executor.v1';
export class GalleryTaskError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 2048): v is string =>
  typeof v === 'string' && v.length <= max && !/\p{Cc}/u.test(v);
const nullableText = (v: unknown): boolean => v === null || text(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const oneOf = (v: unknown, values: string[]): boolean => typeof v === 'string' && values.includes(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));
export function validGalleryTransferContext(v: unknown): v is GalleryTransferContext {
  return (
    record(v) &&
    onlyKeys(v, ['identity', 'gateway', 'storage']) &&
    text(v.identity, 128) &&
    v.identity.length > 0 &&
    text(v.gateway, 128) &&
    v.gateway.length > 0 &&
    (v.storage === null || (text(v.storage, 128) && v.storage.length > 0))
  );
}
export function sameGalleryTransferContext(a: GalleryTransferContext, b: GalleryTransferContext): boolean {
  return a.identity === b.identity && a.gateway === b.gateway && a.storage === b.storage;
}
function isGalleryTransferTask(value: unknown): value is GalleryTransferTaskV1 {
  if (
    !record(value) ||
    !onlyKeys(value, [
      'schemaVersion',
      'id',
      'direction',
      'storage',
      'status',
      'command',
      'context',
      'createTimeUtc',
      'updateTimeUtc',
      'revision',
      'archiveSha256',
      'archiveName',
      'batchPrefix',
      'conflictPolicy',
      'createMissingGroups',
      'errorCode',
      'items'
    ]) ||
    value.schemaVersion !== 1 ||
    !text(value.id, 80) ||
    !value.id ||
    !oneOf(value.direction, ['import', 'export']) ||
    !oneOf(value.storage, ['zip', 's3']) ||
    !oneOf(value.status, ['pending', 'running', 'paused', 'attention', 'completed', 'cancelled']) ||
    !(value.command === null || oneOf(value.command, ['pause', 'cancel'])) ||
    !validGalleryTransferContext(value.context) ||
    !integer(value.createTimeUtc) ||
    !integer(value.updateTimeUtc) ||
    !integer(value.revision) ||
    value.revision < 1 ||
    !nullableText(value.archiveSha256) ||
    !nullableText(value.archiveName) ||
    !text(value.batchPrefix) ||
    !oneOf(value.conflictPolicy, ['skip', 'rename']) ||
    typeof value.createMissingGroups !== 'boolean' ||
    !nullableText(value.errorCode) ||
    !Array.isArray(value.items) ||
    value.items.length > 2001
  )
    throw new GalleryTaskError('GALLERY_TASK_INVALID');
  const ids = new Set<string>();
  let assets = 0;
  for (const item of value.items) {
    if (
      !record(item) ||
      !onlyKeys(item, [
        'id',
        'kind',
        'status',
        'mutation',
        'sourcePath',
        'sourcePhotoId',
        'sourceUrl',
        'sourceSize',
        'sourceEtag',
        'sha256',
        'contentType',
        'targetPath',
        'targetGroupId',
        'parentItemId',
        'fileName',
        'requestId',
        'fileId',
        'errorCode',
        'skipReason'
      ]) ||
      !text(item.id, 80) ||
      !item.id ||
      ids.has(item.id) ||
      !oneOf(item.kind, ['group', 'asset', 'manifest', 'archive']) ||
      !oneOf(item.status, [
        'pending',
        'running',
        'unconfirmed',
        'confirmed',
        'failed',
        'unknown',
        'skipped'
      ]) ||
      typeof item.mutation !== 'boolean' ||
      !['sourcePath', 'targetPath', 'fileName'].every((k) => text(item[k])) ||
      ![
        'sourcePhotoId',
        'sourceUrl',
        'sourceEtag',
        'sha256',
        'contentType',
        'targetGroupId',
        'parentItemId',
        'requestId',
        'fileId',
        'errorCode',
        'skipReason'
      ].every((k) => nullableText(item[k])) ||
      !(item.sourceSize === null || integer(item.sourceSize))
    )
      throw new GalleryTaskError('GALLERY_TASK_INVALID');
    ids.add(item.id);
    if (item.kind === 'asset') assets += 1;
    if (item.sha256 !== null && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)))
      throw new GalleryTaskError('GALLERY_TASK_INVALID');
    if (item.sourceUrl !== null) {
      try {
        if (typeof item.sourceUrl !== 'string') throw new Error();
        const url = new URL(item.sourceUrl);
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
      } catch {
        throw new GalleryTaskError('GALLERY_TASK_INVALID');
      }
    }
  }
  if (assets > 500) throw new GalleryTaskError('GALLERY_TASK_LIMIT');
  return true;
}
export function validateGalleryTransferTask(value: unknown): GalleryTransferTaskV1 {
  if (isGalleryTransferTask(value)) return value;
  throw new GalleryTaskError('GALLERY_TASK_INVALID');
}
export function recoverGalleryTask(task: GalleryTransferTaskV1): GalleryTransferTaskV1 {
  const result = structuredClone(task);
  for (const item of result.items)
    if (item.status === 'running') item.status = item.mutation ? 'unknown' : 'pending';
  if (result.status === 'running') result.status = result.command === 'cancel' ? 'cancelled' : 'paused';
  result.command = null;
  return result;
}
export function galleryTaskTerminal(task: GalleryTransferTaskV1): boolean {
  return (
    task.status === 'completed' ||
    (task.status === 'cancelled' &&
      !task.items.some((i) => ['running', 'unknown', 'unconfirmed'].includes(i.status)))
  );
}
export interface GalleryTransferTaskRepository {
  list(): Promise<GalleryTransferTaskV1[]>;
  get(id: string): Promise<GalleryTransferTaskV1>;
  create(task: GalleryTransferTaskV1): Promise<void>;
  update(id: string, change: (task: GalleryTransferTaskV1) => void): Promise<GalleryTransferTaskV1>;
  remove(id: string): Promise<void>;
}
export function galleryTaskReport(task: GalleryTransferTaskV1): object {
  return {
    schemaVersion: 1,
    taskId: task.id,
    direction: task.direction,
    storage: task.storage,
    status: task.status,
    createTimeUtc: task.createTimeUtc,
    updateTimeUtc: task.updateTimeUtc,
    items: task.items.map((item, index) => ({
      index,
      kind: item.kind,
      status: item.status,
      requestId: item.requestId,
      errorCode: item.errorCode
    }))
  };
}
