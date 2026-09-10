export const SHOWCASE_STORAGE_PREFIX = 'one-vegetable:showcase:v1:';
export const SHOWCASE_LOCK = 'one-vegetable:showcase';

export async function clearShowcaseLocalData(clearOtherData: () => Promise<void>): Promise<void> {
  const clear = async () => {
    await clearOtherData();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(SHOWCASE_STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  };
  // This browser cannot start showcase writes without Web Locks, so there is
  // no in-flight writer to wait for. Still allow ordinary local-data cleanup.
  if (!('locks' in navigator)) return clear();
  await navigator.locks.request(SHOWCASE_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('SHOWCASE_LOCKED');
    await clear();
  });
}
