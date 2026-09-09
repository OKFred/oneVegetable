import { inject, provide, ref, toRaw, type InjectionKey } from 'vue';
import { type GalleryImportDecision, type Photo, type PhotoGroup } from '@one-vegetable/core';
import { GalleryTransferRunner, safeCode } from '@one-vegetable/core/gallery-transfer-runner';
import {
  GALLERY_TASK_LOCK,
  GalleryTaskError,
  validateGalleryTransferTask,
  type GalleryTransferTaskV1 as Task,
  type GalleryTransferItemV1 as Item
} from '@one-vegetable/core/gallery-transfer-task';
import { LazyGalleryTransferDriver } from './gallery-transfer-lazy-driver';
import { IndexedDbGalleryTaskRepository } from './gallery-task-repository';
import type { AppServices } from './services';

export interface GalleryTaskPlanInput {
  direction: 'import' | 'export';
  storage: 'zip' | 's3';
  photos: readonly Photo[];
  groupId: string;
  groupName: string;
  archiveBytes: Uint8Array | null;
  archiveName: string;
  decisions: readonly (GalleryImportDecision & { etag: string | null })[];
  conflictPolicy: 'skip' | 'rename';
  createMissingGroups: boolean;
  importMapping: 'rules' | 'current';
  exportMapping: 'flat' | 'groups';
  exportPrefix: string;
}
function item(fields: Partial<Item>): Item {
  return {
    id: crypto.randomUUID(),
    kind: 'asset',
    status: 'pending',
    mutation: true,
    sourcePath: '',
    sourcePhotoId: null,
    sourceUrl: null,
    sourceSize: null,
    sourceEtag: null,
    sha256: null,
    contentType: null,
    targetPath: '',
    targetGroupId: null,
    parentItemId: null,
    fileName: '',
    requestId: null,
    fileId: null,
    errorCode: null,
    skipReason: null,
    ...fields
  };
}
function safePath(path: string): string {
  const result = path.trim().replace(/\/$/u, '');
  if (
    result &&
    (result.includes('\\') ||
      /\p{Cc}/u.test(result) ||
      result.split('/').some((p) => !p || p === '.' || p === '..'))
  )
    throw new GalleryTaskError('GALLERY_TASK_INVALID_PATH');
  return result;
}
export function downloadGalleryFile(name: string, bytes: Uint8Array, type = 'application/zip'): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
export class GalleryTransferService {
  readonly tasks = ref<Task[]>([]);
  readonly open = ref(false);
  readonly selectedId = ref<string | null>(null);
  readonly error = ref('');
  readonly repository = new IndexedDbGalleryTaskRepository();
  readonly driver: LazyGalleryTransferDriver;
  readonly runner: GalleryTransferRunner;
  private channel: BroadcastChannel | null = null;
  private executing: Promise<void> | null = null;
  private disposed = false;
  constructor(private readonly services: AppServices) {
    this.driver = new LazyGalleryTransferDriver(services, downloadGalleryFile);
    this.runner = new GalleryTransferRunner(
      this.repository,
      this.driver,
      async (action) => {
        if (!('locks' in navigator)) throw new GalleryTaskError('GALLERY_TASK_LOCK_UNAVAILABLE');
        return navigator.locks.request(
          GALLERY_TASK_LOCK,
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (!lock) return false;
            await action();
            return true;
          }
        );
      },
      () => {
        this.channel?.postMessage('changed');
        void this.reload();
      }
    );
  }
  async initialize(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(GALLERY_TASK_LOCK);
      this.channel.onmessage = () => {
        void this.reload();
      };
    }
    try {
      await this.runner.recover();
      await this.reload();
    } catch (e) {
      this.error.value = safeCode(e);
    }
  }
  async reload(): Promise<void> {
    if (this.disposed) return;
    try {
      const context = await this.driver.context();
      // Identity is an authorization boundary even for local task history.
      this.tasks.value = (await this.repository.list()).filter(
        (task) => task.context.identity === context.identity
      );
    } catch (e) {
      this.tasks.value = [];
      this.error.value = safeCode(e);
    }
  }
  show(id?: string): void {
    this.open.value = true;
    this.selectedId.value = id ?? null;
    void this.reload();
  }
  async refresh(): Promise<void> {
    try {
      // Explicit user action can recover receipts after the former owner exits,
      // but never starts scheduling or takes the lock from a live owner.
      await this.runner.recover();
      this.error.value = '';
      await this.reload();
    } catch (e) {
      this.error.value = safeCode(e);
    }
  }
  async preview(input: GalleryTaskPlanInput): Promise<Task> {
    const { galleryGroupPaths, allGalleryPhotos } = await import('./gallery-transfer-driver');
    if (!('locks' in navigator)) throw new GalleryTaskError('GALLERY_TASK_LOCK_UNAVAILABLE');
    const context = await this.driver.context();
    if (input.storage === 's3' && !context.storage) throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
    const options = { galleryContext: context };
    const id = crypto.randomUUID();
    const now = Date.now();
    const task: Task = {
      schemaVersion: 1,
      id,
      direction: input.direction,
      storage: input.storage,
      status: 'pending',
      command: null,
      context,
      createTimeUtc: now,
      updateTimeUtc: now,
      revision: 1,
      archiveSha256: null,
      archiveName:
        input.direction === 'export' ? `one-vegetable-gallery-${id.slice(0, 8)}.zip` : input.archiveName,
      batchPrefix: [safePath(input.exportPrefix), id].filter(Boolean).join('/'),
      conflictPolicy: input.conflictPolicy,
      createMissingGroups: input.createMissingGroups,
      errorCode: null,
      items: []
    };
    const gateway = this.services.gateway;
    if (input.direction === 'export') {
      const paths =
        input.exportMapping === 'groups'
          ? await galleryGroupPaths(gateway, options)
          : new Map<string, PhotoGroup>();
      for (const photo of input.photos) {
        const groupPath = [...paths].find(([, group]) => group.id === photo.groupId)?.[0] ?? input.groupName;
        const asset = item({
          mutation: input.storage === 's3',
          sourcePhotoId: photo.id,
          targetGroupId: photo.groupId,
          sourcePath: groupPath,
          fileName: photo.name
        });
        const url = new URL(photo.url);
        asset.sourceUrl = !url.search && !url.hash && !url.username && !url.password ? url.href : null;
        asset.targetPath = `assets/${input.exportMapping === 'groups' ? `${groupPath.split('/').map(encodeURIComponent).join('/')}/` : ''}${asset.id}.image`;
        task.items.push(asset);
      }
      task.items.push(
        item({
          kind: input.storage === 'zip' ? 'archive' : 'manifest',
          mutation: input.storage === 's3',
          targetPath: 'gallery.json',
          fileName: 'gallery.json'
        })
      );
    } else {
      const groups =
        input.storage === 's3' && input.importMapping === 'rules'
          ? await galleryGroupPaths(gateway, options)
          : new Map<string, PhotoGroup>();
      const plannedGroups = new Map<string, Item>();
      let sources: {
        path: string;
        name: string;
        size: number | null;
        etag: string | null;
        sha: string | null;
        type: string | null;
        groupPath: string;
      }[];
      if (input.storage === 'zip') {
        if (!input.archiveBytes) throw new GalleryTaskError('GALLERY_TASK_ARCHIVE_REQUIRED');
        const { readGalleryTransferArchive, galleryAssetSha256 } = await import('./gallery-transfer-archive');
        const archive = await readGalleryTransferArchive(input.archiveBytes);
        task.archiveSha256 = await galleryAssetSha256(input.archiveBytes);
        sources = archive.document.assets.map((a) => ({
          path: a.path,
          name: a.fileName,
          size: a.byteLength,
          sha: a.sha256,
          type: a.contentType,
          etag: null,
          groupPath: input.groupName
        }));
      } else
        sources = input.decisions
          .filter((d) => d.action === 'import')
          .map((d) => ({
            path: d.sourcePath,
            name: d.fileName,
            size: d.byteLength,
            etag: d.etag,
            sha: null,
            type: d.contentType,
            groupPath: d.targetGroupPath ?? ''
          }));
      const existingNames = new Map<string, Set<string>>();
      for (const source of sources) {
        let groupId: string | null = input.groupId;
        let parent: string | null = null;
        if (input.storage === 's3' && input.importMapping === 'rules') {
          const path = safePath(source.groupPath);
          const parts = path.split('/');
          if (!path || parts.length > 3) throw new GalleryTaskError('GALLERY_TASK_INVALID_PATH');
          let current = '';
          groupId = null;
          for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const folded = current.toLocaleLowerCase('en-US');
            const existing = groups.get(folded);
            if (existing) {
              groupId = existing.id;
              parent = null;
              continue;
            }
            if (!input.createMissingGroups) throw new GalleryTaskError('GALLERY_TASK_GROUP_MISSING');
            let planned = plannedGroups.get(folded);
            if (!planned) {
              planned = item({
                kind: 'group',
                fileName: part,
                targetPath: current,
                targetGroupId: groupId,
                parentItemId: parent
              });
              task.items.push(planned);
              plannedGroups.set(folded, planned);
            }
            parent = planned.id;
            groupId = null;
          }
        }
        const asset = item({
          sourcePath: source.path,
          fileName: source.name,
          sourceSize: source.size,
          sourceEtag: source.etag,
          sha256: source.sha,
          contentType: source.type,
          targetPath: source.groupPath,
          targetGroupId: groupId,
          parentItemId: parent
        });
        const nameKey = groupId ?? parent ?? '';
        let names = existingNames.get(nameKey);
        if (!names) {
          names = new Set(
            groupId
              ? (await allGalleryPhotos(gateway, groupId, options)).map((p) =>
                  p.name.toLocaleLowerCase('en-US')
                )
              : []
          );
          existingNames.set(nameKey, names);
        }
        if (names.has(asset.fileName.toLocaleLowerCase('en-US'))) {
          if (input.conflictPolicy === 'skip') {
            asset.status = 'skipped';
            asset.skipReason = 'name-conflict';
          } else {
            const dot = asset.fileName.lastIndexOf('.');
            asset.fileName =
              dot > 0
                ? `${asset.fileName.slice(0, dot)}-${asset.id.slice(0, 8)}${asset.fileName.slice(dot)}`
                : `${asset.fileName}-${asset.id.slice(0, 8)}`;
          }
        }
        names.add(asset.fileName.toLocaleLowerCase('en-US'));
        task.items.push(asset);
      }
    }
    if (!task.items.some((i) => i.kind === 'asset')) throw new GalleryTaskError('GALLERY_TASK_EMPTY');
    return validateGalleryTransferTask(task);
  }
  async create(task: Task, archiveBytes: Uint8Array | null): Promise<void> {
    task = structuredClone(toRaw(task));
    if (archiveBytes) await this.driver.attachArchive(task, archiveBytes);
    await this.repository.create(task);
    this.show(task.id);
  }
  async run(id: string, verifyOnly = false): Promise<void> {
    if (this.executing) throw new GalleryTaskError('GALLERY_TASK_BUSY');
    this.error.value = '';
    this.executing = this.runner.run(id, verifyOnly);
    try {
      await this.executing;
    } catch (e) {
      this.error.value = safeCode(e);
    } finally {
      this.executing = null;
      await this.reload();
      const task = this.tasks.value.find((value) => value.id === id);
      if (task && ['completed', 'cancelled'].includes(task.status)) this.driver.forgetArchive(id);
    }
  }
  async stopAndClear(): Promise<void> {
    for (const task of await this.repository.list())
      if (task.status === 'running') await this.runner.command(task.id, 'cancel');
    if (this.executing) await this.executing;
    // A different tab can still own an active mutation. Do not clear its write-ahead receipt.
    await navigator.locks.request(GALLERY_TASK_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new GalleryTaskError('GALLERY_TASK_BUSY');
      for (const task of await this.repository.list()) {
        this.driver.forgetArchive(task.id);
      }
      await this.repository.clearAll();
    });
    this.tasks.value = [];
  }
  dispose(): void {
    this.disposed = true;
    this.channel?.close();
    this.channel = null;
    for (const task of this.tasks.value)
      if (task.status === 'running') void this.runner.command(task.id, 'pause').catch(() => undefined);
  }
}
const key: InjectionKey<GalleryTransferService> = Symbol('gallery-transfers');
export function provideGalleryTransfers(service: GalleryTransferService): void {
  provide(key, service);
}
export function useGalleryTransfers(): GalleryTransferService | undefined {
  return inject(key, undefined);
}
