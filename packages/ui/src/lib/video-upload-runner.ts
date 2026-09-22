import { encodeBase64 } from '@one-vegetable/core';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import {
  VIDEO_UPLOAD_PART_BYTES,
  VIDEO_UPLOAD_VERIFY_WINDOW_MS,
  VideoUploadError,
  verifyReselectedVideo,
  type VideoUploadCommand,
  type VideoUploadControl,
  type VideoUploadResult,
  type VideoUploadTask
} from '@one-vegetable/core/video-upload';

export function sameVideoContext(a: GalleryTransferContext, b: GalleryTransferContext): boolean {
  return a.identity === b.identity && a.gateway === b.gateway && a.storage === b.storage;
}

/** One foreground run. Stopping never aborts a mutation already sent and never retries it. */
export class VideoUploadRunner {
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly control: VideoUploadControl,
    private readonly context: GalleryTransferContext,
    private readonly getContext: () => Promise<GalleryTransferContext>,
    private readonly receipt: (result: VideoUploadResult) => void,
    private readonly now: () => number = Date.now
  ) {}

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  private check(): void {
    if (this.stopped) throw new VideoUploadError('VIDEO_UPLOAD_PAUSED');
  }

  async call(command: VideoUploadCommand): Promise<VideoUploadResult> {
    this.check();
    if (!sameVideoContext(this.context, await this.getContext())) {
      this.stop();
      throw new VideoUploadError('GALLERY_TASK_CONTEXT_CHANGED');
    }
    this.check();
    const result = await this.control.videoUpload(command, this.context, crypto.randomUUID());
    // Save/show the reply even if the user closed the dialog while the request was running.
    this.receipt(result);
    return result;
  }

  async command(
    task: VideoUploadTask,
    action: 'initiate' | 'reconcile' | 'complete' | 'verify' | 'cancel'
  ): Promise<VideoUploadTask> {
    const result = await this.call({ action, taskId: task.id, revision: task.revision });
    return this.task(result, task.id);
  }

  private task(result: VideoUploadResult, id: string): VideoUploadTask {
    const task = result.tasks.find((item) => item.id === id);
    if (!task) throw new VideoUploadError('VIDEO_UPLOAD_RESPONSE_INVALID');
    return task;
  }

  /** Only initiated by a user. Rechecking the whole file never starts an upload itself. */
  async stage(initial: VideoUploadTask, file: Blob & { name: string }): Promise<VideoUploadTask> {
    await verifyReselectedVideo(file, initial);
    this.check();
    let task = initial;
    if (task.status === 'prepared') task = await this.command(task, 'initiate');
    else if (task.status === 'staging') task = await this.command(task, 'reconcile');
    else throw new VideoUploadError('VIDEO_RECONCILIATION_REQUIRED');
    for (const part of task.parts) {
      this.check();
      if (part.status === 'confirmed') continue;
      if (part.status !== 'pending') throw new VideoUploadError('VIDEO_RECONCILIATION_REQUIRED');
      const start = (part.partNumber - 1) * VIDEO_UPLOAD_PART_BYTES;
      const bytes = new Uint8Array(await file.slice(start, start + part.byteLength).arrayBuffer());
      this.check();
      const result = await this.call({
        action: 'part',
        taskId: task.id,
        revision: task.revision,
        partNumber: part.partNumber,
        contentBase64: encodeBase64(bytes),
        fileSha256: initial.file?.sha256 ?? ''
      });
      task = this.task(result, task.id);
    }
    return this.command(task, 'complete');
  }

  async submit(task: VideoUploadTask, sourceUrl?: string): Promise<VideoUploadTask> {
    if (!(
      (task.source === 'url' && task.status === 'prepared') ||
      (task.source === 'file' && task.status === 'staged')
    ))
      throw new VideoUploadError('VIDEO_RECONCILIATION_REQUIRED');
    const result = await this.call({
      action: 'submit',
      taskId: task.id,
      revision: task.revision,
      confirmed: true,
      ...(task.source === 'url' ? { sourceUrl: sourceUrl ?? '' } : {})
    });
    return this.task(result, task.id);
  }

  /** Readback is bounded and cancellable. An accepted response is never presented as completed. */
  async verifyUntilSettled(initial: VideoUploadTask): Promise<VideoUploadTask> {
    let task = initial;
    const deadline = (task.acceptedTimeUtc ?? this.now()) + VIDEO_UPLOAD_VERIFY_WINDOW_MS;
    while (task.status === 'accepted' && this.now() < deadline) {
      this.check();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            this.wake = null;
            resolve();
          },
          Math.min(15_000, deadline - this.now())
        );
        this.wake = () => {
          clearTimeout(timer);
          this.wake = null;
          resolve();
        };
      });
      this.check();
      task = await this.command(task, 'verify');
    }
    return task;
  }
}
