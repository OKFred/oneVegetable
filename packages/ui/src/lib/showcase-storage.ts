export const SHOWCASE_STORAGE_PREFIX = 'one-vegetable:showcase:v1:';
export const SHOWCASE_LOCK = 'one-vegetable:showcase';

export async function clearShowcaseLocalData(clearOtherData: () => Promise<void>): Promise<void> {
  if (!('locks' in navigator)) throw new Error('SHOWCASE_LOCKED');
  await navigator.locks.request(SHOWCASE_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('SHOWCASE_LOCKED');
    await clearOtherData();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(SHOWCASE_STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  });
}
