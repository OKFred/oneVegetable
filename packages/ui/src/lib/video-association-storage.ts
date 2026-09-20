export const VIDEO_ASSOCIATION_PREFIX = 'one-vegetable:video-association:v1:';
export const VIDEO_ASSOCIATION_LOCK = 'one-vegetable:video-association';

export async function clearVideoAssociationLocalData(clearOtherData: () => Promise<void>): Promise<void> {
  const clear = async () => {
    await clearOtherData();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(VIDEO_ASSOCIATION_PREFIX)) localStorage.removeItem(key);
    }
  };
  if (!('locks' in navigator)) return clear();
  await navigator.locks.request(VIDEO_ASSOCIATION_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('VIDEO_ASSOCIATION_LOCKED');
    await clear();
  });
}
