import { decodeBase64, type GatewayClient, type Photo } from '@one-vegetable/core';
import {
  GalleryTaskError,
  type GalleryTransferTaskV1,
  type GalleryTransferItemV1
} from '@one-vegetable/core/gallery-transfer-task';
import { galleryAssetSha256 } from './gallery-transfer-archive';

/** A bounded exact-ID lookup, never a name match or a scan of the whole merchant library. */
export async function galleryImportReadback(
  gateway: GatewayClient,
  task: GalleryTransferTaskV1,
  item: GalleryTransferItemV1,
  targetPhotos: readonly Photo[]
): Promise<Photo | null> {
  if (!item.fileId || !item.targetGroupId) return null;
  const target = targetPhotos.find(
    (photo) => photo.id === item.fileId && photo.groupId === item.targetGroupId
  );
  if (target) return target;
  const options = { galleryContext: task.context };
  const page = await gateway.request('listPhotos', { page: 1, pageSize: 100 }, options);
  const existing = page.items.find((photo) => photo.id === item.fileId);
  if (!existing?.groupId || existing.groupId === item.targetGroupId) return null;
  if (!task.reuseExistingPhotos) throw new GalleryTaskError('GALLERY_TASK_EXISTING_OTHER_GROUP');
  if (!item.sha256 || item.sourceSize === null) return null;
  const file = await gateway.request('downloadProductAsset', { url: existing.url }, options);
  const bytes = decodeBase64(file.contentBase64);
  if (
    bytes.length !== item.sourceSize ||
    file.byteLength !== bytes.length ||
    (await galleryAssetSha256(bytes)) !== item.sha256
  ) {
    throw new GalleryTaskError('GALLERY_TASK_SOURCE_CHANGED');
  }
  return existing;
}
