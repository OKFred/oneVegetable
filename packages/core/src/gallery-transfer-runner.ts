import { GatewayException } from './errors';
import {
  GalleryTaskError,
  recoverGalleryTask,
  sameGalleryTransferContext,
  type GalleryTransferContext,
  type GalleryTransferItemV1,
  type GalleryTransferTaskRepository,
  type GalleryTransferTaskV1
} from './gallery-transfer-task';

/** All drivers return metadata only. Network and file bytes remain outside persistent records. */
export interface GalleryTransferDriver {
  context(task: GalleryTransferTaskV1): Promise<GalleryTransferContext>;
  prepare(task: GalleryTransferTaskV1, item: GalleryTransferItemV1): Promise<GalleryTransferItemV1>;
  execute(task: GalleryTransferTaskV1, item: GalleryTransferItemV1): Promise<GalleryTransferItemV1>;
  verify(task: GalleryTransferTaskV1, item: GalleryTransferItemV1): Promise<GalleryTransferItemV1>;
  release(taskId: string): void;
}
export type GalleryExclusiveLock = (action: () => Promise<void>) => Promise<boolean>;

export class GalleryTransferRunner {
  constructor(
    readonly repository: GalleryTransferTaskRepository,
    private readonly driver: GalleryTransferDriver,
    private readonly exclusive: GalleryExclusiveLock,
    private readonly changed: () => void = () => undefined
  ) {}

  async command(id: string, command: 'pause' | 'cancel'): Promise<void> {
    await this.repository.update(id, (task) => {
      if (task.status === 'completed') return;
      if (task.status === 'running') task.command = command;
      else {
        task.status = command === 'cancel' ? 'cancelled' : 'paused';
        task.command = null;
      }
    });
    this.changed();
  }
  async skip(id: string, itemId: string, reason: string): Promise<void> {
    if (!reason.trim() || reason.length > 500) throw new GalleryTaskError('GALLERY_TASK_REASON_REQUIRED');
    await this.repository.update(id, (task) => {
      if (task.status === 'running') throw new GalleryTaskError('GALLERY_TASK_BUSY');
      const item = task.items.find((i) => i.id === itemId);
      if (!item || item.status === 'confirmed') throw new GalleryTaskError('GALLERY_TASK_INVALID');
      item.status = 'skipped';
      item.skipReason = reason.trim();
    });
    this.changed();
  }
  async recover(): Promise<void> {
    // Never normalize an in-flight task while another live tab owns the lock.
    await this.exclusive(async () => {
      for (const task of await this.repository.list())
        if (task.status === 'running') {
          await this.repository.update(task.id, (current) =>
            Object.assign(current, recoverGalleryTask(current))
          );
        }
    });
    this.changed();
  }
  async run(id: string, verifyOnly = false): Promise<void> {
    const acquired = await this.exclusive(async () => {
      let task = await this.repository.get(id);
      const wasCancelled = task.status === 'cancelled';
      if (task.status === 'completed' || (task.status === 'cancelled' && !verifyOnly)) return;
      if (!sameGalleryTransferContext(task.context, await this.driver.context(task)))
        throw new GalleryTaskError('GALLERY_CONTEXT_CHANGED');
      task = await this.repository.update(id, (current) => {
        Object.assign(current, recoverGalleryTask(current));
        current.status = 'running';
        current.errorCode = null;
      });
      this.changed();
      try {
        for (const planned of task.items) {
          task = await this.repository.get(id);
          if (task.command) break;
          const item = task.items.find((i) => i.id === planned.id);
          if (!item || ['confirmed', 'skipped'].includes(item.status)) continue;
          if (!sameGalleryTransferContext(task.context, await this.driver.context(task)))
            throw new GalleryTaskError('GALLERY_CONTEXT_CHANGED');
          if (['unknown', 'unconfirmed'].includes(item.status)) {
            const checked = await this.driver.verify(task, structuredClone(item));
            // A verifier must never turn an uncertain write back into pending/failed.
            if (!['confirmed', 'unknown', 'unconfirmed'].includes(checked.status))
              throw new GalleryTaskError('GALLERY_TASK_INVALID');
            await this.item(id, checked);
            if (checked.status !== 'confirmed') break;
            continue;
          }
          if (verifyOnly) continue;
          let prepared: GalleryTransferItemV1;
          try {
            prepared = await this.driver.prepare(task, structuredClone(item));
          } catch (reason) {
            await this.item(id, { ...item, status: 'failed', errorCode: safeCode(reason) });
            throw reason;
          }
          // Pausing during a read/preflight must not allow a following write to slip through.
          task = await this.repository.get(id);
          if (task.command) break;
          if (prepared.status === 'skipped') {
            await this.item(id, prepared);
            continue;
          }
          prepared.requestId = crypto.randomUUID();
          prepared.status = 'running';
          prepared.errorCode = null;
          await this.item(id, prepared); // Commit BEFORE the first side effect.
          let result: GalleryTransferItemV1;
          try {
            result = await this.driver.execute(task, prepared);
          } catch (reason) {
            result = {
              ...prepared,
              status: prepared.mutation && !knownUnsent(reason) ? 'unknown' : 'failed',
              errorCode: safeCode(reason)
            };
            await this.item(id, result);
            throw reason;
          }
          // If this persistence fails the durable running marker remains: recovery treats it as unknown.
          await this.item(id, result);
          if (result.status === 'unconfirmed') {
            const checked = await this.driver.verify(await this.repository.get(id), result);
            if (!['confirmed', 'unknown', 'unconfirmed'].includes(checked.status))
              throw new GalleryTaskError('GALLERY_TASK_INVALID');
            await this.item(id, checked);
            if (checked.status !== 'confirmed') break;
          } else if (result.status !== 'confirmed' && result.status !== 'skipped') break;
        }
      } catch (reason) {
        await this.repository.update(id, (current) => {
          current.errorCode = safeCode(reason);
        });
      } finally {
        try {
          await this.repository.update(id, (current) => {
            current.status =
              current.command === 'cancel' || wasCancelled
                ? 'cancelled'
                : current.command === 'pause'
                  ? 'paused'
                  : current.items.every((i) => ['confirmed', 'skipped'].includes(i.status))
                    ? 'completed'
                    : current.items.some((i) => ['unknown', 'unconfirmed', 'failed'].includes(i.status))
                      ? 'attention'
                      : 'paused';
            current.command = null;
          });
        } finally {
          this.driver.release(id);
          this.changed();
        }
      }
    });
    if (!acquired) throw new GalleryTaskError('GALLERY_TASK_BUSY');
  }
  private async item(id: string, item: GalleryTransferItemV1): Promise<void> {
    await this.repository.update(id, (task) => {
      const index = task.items.findIndex((i) => i.id === item.id);
      if (index < 0) throw new GalleryTaskError('GALLERY_TASK_INVALID');
      task.items[index] = item;
    });
    this.changed();
  }
}
export function safeCode(reason: unknown): string {
  if (reason instanceof GalleryTaskError) return reason.code;
  if (reason instanceof GatewayException) return safeCode({ code: reason.gatewayError.code });
  if (
    typeof reason === 'object' &&
    reason !== null &&
    'code' in reason &&
    typeof reason.code === 'string' &&
    /^[A-Z][A-Z0-9_]{1,79}$/u.test(reason.code)
  )
    return reason.code;
  return 'GALLERY_TRANSFER_FAILED';
}
function knownUnsent(reason: unknown): boolean {
  // Only local/preflight denials, not generic provider failures or timeouts.
  const code = safeCode(reason);
  return (
    (reason instanceof GatewayException || reason instanceof GalleryTaskError) &&
    new Set([
      'AUTH_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'SESSION_EXPIRED',
      'CSRF_INVALID',
      'ABAC_DENIED',
      'REAL_MUTATION_DISABLED',
      'GALLERY_CONTEXT_CHANGED',
      'GALLERY_CONTEXT_INVALID',
      'GALLERY_CONTEXT_UNTRUSTED',
      'S3_PERMISSION_REQUIRED',
      'S3_NOT_CONFIGURED',
      'GALLERY_TASK_SOURCE_CHANGED',
      'GALLERY_CONTEXT_UNAVAILABLE'
    ]).has(code)
  );
}
