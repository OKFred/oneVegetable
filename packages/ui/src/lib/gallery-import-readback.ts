import { decodeBase64, type GatewayClient, type Photo } from '@one-vegetable/core';
import {
  GalleryTaskError,
  type GalleryTransferContext,
  type GalleryTransferTaskV1,
  type GalleryTransferItemV1
} from '@one-vegetable/core/gallery-transfer-task';
import { galleryAssetSha256 } from './gallery-transfer-archive';
import { safeCode } from '@one-vegetable/core/gallery-transfer-runner';
import type { AppServices } from './services';

/** Import writes require reliable scoped readback on the task's actual route. */
export async function assertGalleryImportReadback(
  services: Pick<AppServices, 'mode' | 'operationAvailability'>,
  context: GalleryTransferContext
): Promise<void> {
  if (!services.operationAvailability) {
    if (services.mode === 'mock') return;
    throw new GalleryTaskError('OPERATION_AVAILABILITY_UNAVAILABLE');
  }
  const { items } = await services.operationAvailability
    .get(['listPhotos'], { galleryContext: context })
    .catch((reason: unknown) => {
      const code = safeCode(reason);
      throw new GalleryTaskError(
        code === 'GALLERY_TRANSFER_FAILED' ? 'OPERATION_AVAILABILITY_UNAVAILABLE' : code
      );
    });
  const decision = items.find((item) => item.operation === 'listPhotos');
  if (!decision?.allowed)
    throw new GalleryTaskError(decision?.reasonCode ?? 'OPERATION_AVAILABILITY_UNAVAILABLE');
  if (decision.protocolSupport?.constraints.includes('photo-group-scope-unverified'))
    throw new GalleryTaskError('GALLERY_READBACK_UNVERIFIED');
}

/** Availability is a preflight, not permission to change the task's bound context. */
export async function galleryCanQueryAllPhotos(
  services: Pick<AppServices, 'mode' | 'operationAvailability'>,
  context: GalleryTransferContext
): Promise<boolean> {
  if (!services.operationAvailability) {
    if (services.mode === 'mock') return true;
    throw new GalleryTaskError('OPERATION_AVAILABILITY_UNAVAILABLE');
  }
  const { items } = await services.operationAvailability.get(['listPhotos'], { galleryContext: context });
  const decision = items.find((item) => item.operation === 'listPhotos');
  if (!decision?.allowed)
    throw new GalleryTaskError(decision?.reasonCode ?? 'OPERATION_AVAILABILITY_UNAVAILABLE');
  return !decision.protocolSupport?.constraints.includes('photo-group-required');
}

export function galleryReadbackFailure(code: string): boolean {
  return [
    'GALLERY_TASK_EXISTING_OTHER_GROUP',
    'GALLERY_TASK_SOURCE_CHANGED',
    'GALLERY_TASK_PAGINATION',
    'GALLERY_CONTEXT_CHANGED',
    'ALIBABA_IOP_PHOTO_SCOPE_MISMATCH',
    'ALIBABA_IOP_PHOTO_GROUP_REQUIRED',
    'ALIBABA_IOP_RESPONSE_INVALID',
    'GALLERY_READBACK_UNVERIFIED',
    'OPERATION_AVAILABILITY_UNAVAILABLE'
  ].includes(code);
}

/** A bounded exact-ID lookup, never a name match or a scan of the whole merchant library. */
export async function galleryImportReadback(
  gateway: GatewayClient,
  task: GalleryTransferTaskV1,
  item: GalleryTransferItemV1,
  targetPhotos: readonly Photo[],
  canQueryAllPhotos: () => Promise<boolean> = () => Promise.resolve(true)
): Promise<Photo | null> {
  if (!item.fileId || !item.targetGroupId) return null;
  const target = targetPhotos.find(
    (photo) => photo.id === item.fileId && photo.groupId === item.targetGroupId
  );
  if (target) return target;
  // IOP has no documented all-groups lookup. Never scan other groups or use
  // an unscoped response to claim an upload in a different directory.
  if (!(await canQueryAllPhotos())) return null;
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
