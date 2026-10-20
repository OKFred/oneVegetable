import type { PhotoGroup, PhotoPage } from '../../packages/core/src/types';

/** Operator-only proof. Unknown counts, an unrelated tree or an empty partial page are not permission to delete. */
export function confirmedEmptyPhotoChild(
  parentId: string,
  childId: string,
  groups: readonly PhotoGroup[],
  photos: PhotoPage,
  childGroups: readonly PhotoGroup[]
): boolean {
  return (
    parentId !== childId &&
    groups.filter((group) => group.id === parentId).length === 1 &&
    groups.filter((group) => group.id === childId).length === 1 &&
    groups.some((group) => group.id === childId && group.parentId === parentId) &&
    !groups.some((group) => group.parentId === childId) &&
    childGroups.length === 1 &&
    childGroups[0]?.id === childId &&
    photos.page === 1 &&
    photos.total === 0 &&
    photos.items.length === 0 &&
    photos.hasNextPage === false
  );
}

/** A missing parent cannot establish successful removal of its child. */
export function confirmedPhotoChildRemoved(
  parentId: string,
  childId: string,
  groups: readonly PhotoGroup[]
): boolean {
  return (
    parentId !== childId &&
    groups.filter((group) => group.id === parentId).length === 1 &&
    !groups.some((group) => group.id === childId)
  );
}
