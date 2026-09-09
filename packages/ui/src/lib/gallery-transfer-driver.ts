import {
  decodeBase64,
  encodeBase64,
  validatePhotoBytes,
  photoFileExtension,
  type GalleryTransferDocumentV1,
  type GatewayClient,
  type Photo,
  type PhotoGroup
} from '@one-vegetable/core';
import type { GalleryRequestOptions } from '@one-vegetable/core/gallery-transfer-context';
import type { GalleryTransferDriver } from '@one-vegetable/core/gallery-transfer-runner';
import {
  GalleryTaskError,
  type GalleryTransferItemV1 as Item,
  type GalleryTransferTaskV1 as Task
} from '@one-vegetable/core/gallery-transfer-task';
import type { AppServices } from './services';
import {
  createGalleryTransferArchive,
  galleryAssetSha256,
  readGalleryTransferArchive,
  type GalleryTransferArchive
} from './gallery-transfer-archive';

export function transferOptions(task: Task, item?: Item): GalleryRequestOptions {
  return { galleryContext: task.context, ...(item?.requestId ? { requestId: item.requestId } : {}) };
}

/** Refuse an incomplete, repeated or shifting pagination snapshot; absence is not success. */
export async function allGalleryPhotos(
  gateway: GatewayClient,
  groupId: string,
  options?: GalleryRequestOptions
): Promise<Photo[]> {
  const found = new Map<string, Photo>();
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 10000; page++) {
    const result = await gateway.request('listPhotos', { groupId, page, pageSize: 100 }, options);
    if (expectedTotal !== null && expectedTotal !== result.total)
      throw new GalleryTaskError('GALLERY_TASK_PAGINATION');
    expectedTotal = result.total;
    for (const photo of result.items) {
      if (found.has(photo.id)) throw new GalleryTaskError('GALLERY_TASK_PAGINATION');
      found.set(photo.id, photo);
    }
    if (found.size === expectedTotal) return [...found.values()];
    if (!result.items.length || found.size > expectedTotal)
      throw new GalleryTaskError('GALLERY_TASK_PAGINATION');
  }
  throw new GalleryTaskError('GALLERY_TASK_PAGINATION');
}
export async function galleryGroupPaths(
  gateway: GatewayClient,
  options?: GalleryRequestOptions
): Promise<Map<string, PhotoGroup>> {
  const paths = new Map<string, PhotoGroup>();
  const visited = new Set<string>();
  async function visit(parentId?: string, parentPath = ''): Promise<void> {
    const groups = await gateway.request('listPhotoGroups', parentId ? { parentId } : undefined, options);
    for (const group of groups) {
      if (group.id === '-1' || (parentId ? group.parentId !== parentId : group.level !== 1)) continue;
      if (visited.has(group.id)) throw new GalleryTaskError('GALLERY_TASK_GROUP_AMBIGUOUS');
      visited.add(group.id);
      const path = parentPath ? `${parentPath}/${group.name}` : group.name;
      const key = path.toLocaleLowerCase('en-US');
      if (paths.has(key)) throw new GalleryTaskError('GALLERY_TASK_GROUP_AMBIGUOUS');
      paths.set(key, group);
      if (group.level < 3) await visit(group.id, path);
    }
  }
  await visit();
  return paths;
}

export class BrowserGalleryTransferDriver implements GalleryTransferDriver {
  private archives = new Map<string, GalleryTransferArchive>();
  private bytes = new Map<string, Uint8Array>();
  private verifiedPages = new Map<string, Photo[]>();
  constructor(
    private readonly services: AppServices,
    private readonly download: (name: string, bytes: Uint8Array) => void
  ) {}
  async context() {
    if (!this.services.gateway.galleryTransferContext)
      throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
    return this.services.gateway.galleryTransferContext();
  }
  async attachArchive(task: Task, bytes: Uint8Array): Promise<void> {
    if ((await galleryAssetSha256(bytes)) !== task.archiveSha256)
      throw new GalleryTaskError('GALLERY_TASK_ARCHIVE_CHANGED');
    this.archives.set(task.id, await readGalleryTransferArchive(bytes));
  }
  private control() {
    const control = this.services.s3Storage ?? this.services.control;
    if (!control?.getS3Object || !control.putS3Object || !control.listS3Objects)
      throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
    return control;
  }
  private resolvedGroup(task: Task, item: Item): string | null {
    if (!item.parentItemId) return item.targetGroupId;
    const parent = task.items.find((i) => i.id === item.parentItemId);
    if (parent?.status !== 'confirmed' || !parent.fileId)
      throw new GalleryTaskError('GALLERY_TASK_GROUP_UNCONFIRMED');
    return parent.fileId;
  }
  async prepare(task: Task, item: Item): Promise<Item> {
    const options = transferOptions(task);
    if (item.kind === 'group') {
      item.targetGroupId = this.resolvedGroup(task, item);
      // Another actor may have created this group since preview. Never create a duplicate.
      const siblings = await this.services.gateway.request(
        'listPhotoGroups',
        item.targetGroupId ? { parentId: item.targetGroupId } : undefined,
        options
      );
      if (
        siblings.some((g) => g.name.toLocaleLowerCase('en-US') === item.fileName.toLocaleLowerCase('en-US'))
      )
        throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
      return item;
    }
    if (item.kind === 'manifest' || item.kind === 'archive') {
      if (task.items.some((i) => i.kind === 'asset' && !['confirmed', 'skipped'].includes(i.status)))
        throw new GalleryTaskError('GALLERY_TASK_UNCONFIRMED');
      const document = this.manifest(task);
      let bytes: Uint8Array;
      if (item.kind === 'manifest') bytes = new TextEncoder().encode(JSON.stringify(document, null, 2));
      else {
        const assets = [];
        for (const asset of task.items.filter((i) => i.kind === 'asset' && i.status === 'confirmed')) {
          const data = this.bytes.get(asset.id) ?? (await this.exportBytes(task, asset));
          if ((await galleryAssetSha256(data)) !== asset.sha256)
            throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
          assets.push({ path: asset.targetPath, bytes: data });
        }
        bytes = await createGalleryTransferArchive({
          document,
          assets,
          totalUncompressedBytes: assets.reduce((total, a) => total + a.bytes.length, 0)
        });
      }
      this.bytes.set(item.id, bytes);
      return {
        ...item,
        sourceSize: bytes.length,
        sha256: await galleryAssetSha256(bytes),
        contentType: item.kind === 'archive' ? 'application/zip' : 'application/json'
      };
    }
    let data: Uint8Array;
    if (task.direction === 'export') data = await this.exportBytes(task, item);
    else {
      item.targetGroupId = this.resolvedGroup(task, item);
      if (!item.targetGroupId) throw new GalleryTaskError('GALLERY_TASK_GROUP_UNCONFIRMED');
      if (task.storage === 'zip') {
        const asset = this.archives.get(task.id)?.assets.find((a) => a.path === item.sourcePath);
        if (!asset) throw new GalleryTaskError('GALLERY_TASK_ARCHIVE_REQUIRED');
        data = asset.bytes;
      } else {
        const control = this.control();
        if (!control.getS3Object) throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
        const object = await control.getS3Object(item.sourcePath, options);
        if (!item.sourceEtag || object.etag !== item.sourceEtag || object.bytes.length !== item.sourceSize)
          throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
        data = object.bytes;
      }
    }
    if (task.storage === 's3' && data.length > 5 * 1024 * 1024)
      throw new GalleryTaskError('S3_OBJECT_TOO_LARGE');
    const sha256 = await galleryAssetSha256(data);
    if (item.sha256 && item.sha256 !== sha256) throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
    const contentType = validatePhotoBytes(data);
    if (item.contentType && item.contentType !== contentType)
      throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
    if (task.direction === 'export' && !item.sha256)
      item.targetPath = item.targetPath.replace(/\.image$/u, `.${photoFileExtension(contentType)}`);
    this.bytes.set(item.id, data);
    return { ...item, sourceSize: data.length, sha256, contentType };
  }
  private async exportBytes(task: Task, item: Item): Promise<Uint8Array> {
    let url = item.sourceUrl;
    if (!url) {
      const photos = await allGalleryPhotos(
        this.services.gateway,
        item.targetGroupId ?? '-1',
        transferOptions(task)
      );
      url = photos.find((p) => p.id === item.sourcePhotoId)?.url ?? null;
    }
    if (!url) throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
    const response = await this.services.gateway.request(
      'downloadProductAsset',
      { url },
      transferOptions(task)
    );
    return decodeBase64(response.contentBase64);
  }
  async execute(task: Task, item: Item): Promise<Item> {
    const options = transferOptions(task, item);
    if (item.kind === 'group') {
      const result = await this.services.gateway.request(
        'operatePhotoGroup',
        { operation: 'add', groupName: item.fileName, groupId: item.targetGroupId },
        options
      );
      return { ...item, status: result.groupId ? 'unconfirmed' : 'unknown', fileId: result.groupId };
    }
    const bytes = this.bytes.get(item.id);
    if (!bytes) throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
    if (task.direction === 'import') {
      const result = await this.services.gateway.request(
        'uploadPhoto',
        {
          fileName: item.fileName,
          contentBase64: encodeBase64(bytes),
          byteLength: bytes.length,
          contentType: item.contentType ?? '',
          groupId: item.targetGroupId ?? '-1'
        },
        options
      );
      this.verifiedPages.delete(item.targetGroupId ?? '-1');
      return { ...item, status: result.id ? 'unconfirmed' : 'unknown', fileId: result.id || null };
    }
    if (task.storage === 's3') {
      const control = this.control();
      if (!control.putS3Object) throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
      await control.putS3Object(
        { key: `${task.batchPrefix}/${item.targetPath}`, bytes, contentType: item.contentType ?? '' },
        options
      );
      return { ...item, status: 'unconfirmed' };
    }
    if (item.kind === 'archive') this.download(task.archiveName ?? 'one-vegetable-gallery.zip', bytes);
    return { ...item, status: 'confirmed' };
  }
  async verify(task: Task, item: Item): Promise<Item> {
    try {
      const options = transferOptions(task);
      if (item.kind === 'group') {
        const groups = await this.services.gateway.request(
          'listPhotoGroups',
          item.targetGroupId ? { parentId: item.targetGroupId } : undefined,
          options
        );
        const matches = groups.filter(
          (g) =>
            g.name === item.fileName &&
            (item.targetGroupId ? g.parentId === item.targetGroupId : !g.parentId || g.parentId === '0')
        );
        const group = matches.length === 1 ? matches[0] : undefined;
        if (group && (!item.fileId || item.fileId === group.id))
          return { ...item, fileId: group.id, status: 'confirmed', errorCode: null };
      } else if (task.direction === 'import' && item.fileId && item.targetGroupId) {
        let photos = this.verifiedPages.get(item.targetGroupId);
        if (!photos) {
          photos = await allGalleryPhotos(this.services.gateway, item.targetGroupId, options);
          this.verifiedPages.set(item.targetGroupId, photos);
        }
        if (photos.some((p) => p.id === item.fileId && p.groupId === item.targetGroupId))
          return { ...item, status: 'confirmed', errorCode: null };
      } else if (task.direction === 'export' && task.storage === 's3' && item.sha256) {
        const control = this.control();
        if (!control.getS3Object) throw new GalleryTaskError('GALLERY_CONTEXT_UNAVAILABLE');
        const object = await control.getS3Object(`${task.batchPrefix}/${item.targetPath}`, options);
        if ((await galleryAssetSha256(object.bytes)) === item.sha256)
          return { ...item, status: 'confirmed', errorCode: null };
      }
    } catch {
      /* A failed read must never authorize repeating a mutation. */
    }
    return { ...item, errorCode: 'GALLERY_TASK_UNCONFIRMED' };
  }
  private manifest(task: Task): GalleryTransferDocumentV1 {
    return {
      schemaVersion: 1,
      kind: 'one-vegetable-gallery-transfer',
      createdTimeUtc: task.createTimeUtc,
      assets: task.items
        .filter((i) => i.kind === 'asset' && i.status === 'confirmed')
        .map((item) => ({
          path: item.targetPath,
          fileName: item.fileName,
          sourcePhotoId: item.sourcePhotoId ?? '',
          groupPath: item.sourcePath,
          contentType: item.contentType ?? '',
          byteLength: item.sourceSize ?? 0,
          sha256: item.sha256 ?? '',
          width: null,
          height: null,
          modifiedTimeUtc: null
        }))
    };
  }
  release(_taskId: string): void {
    this.bytes.clear();
    this.verifiedPages.clear();
  }
  forgetArchive(id: string): void {
    this.archives.delete(id);
  }
}
