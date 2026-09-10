import { newShowcaseEntry, type ShowcaseEntry } from './showcase-smoke';

export interface ShowcaseSwapOptions {
  before: ShowcaseEntry[];
  original: ShowcaseEntry;
  targetId: string;
  list: () => Promise<ShowcaseEntry[]>;
  mutate: (
    method: 'alibaba.scbp.showcase.addproduct' | 'alibaba.scbp.showcase.deleteproduct',
    parameters: Record<string, unknown>
  ) => Promise<boolean>;
  checkpoint: (stage: string, entry?: ShowcaseEntry) => Promise<void>;
}

function sameEntries(before: ShowcaseEntry[], after: ShowcaseEntry[]): boolean {
  return (
    before.length === after.length &&
    before.every((entry) =>
      after.some((row) => row.windowId === entry.windowId && row.productId === entry.productId)
    )
  );
}

/** Explicitly authorized, one-slot replacement. No automatic mutation retries. */
export async function runShowcaseSwap(options: ShowcaseSwapOptions): Promise<void> {
  const { before, original, targetId, list, mutate, checkpoint } = options;
  if (
    !before.some((row) => row.windowId === original.windowId && row.productId === original.productId) ||
    before.some((row) => row.productId === targetId)
  )
    throw new Error('INVALID_SWAP_BASELINE');
  if (!sameEntries(before, await list())) throw new Error('SHOWCASE_BASELINE_CHANGED');
  const retained = before.filter((row) => row.windowId !== original.windowId);
  let ownTarget: ShowcaseEntry | null = null;
  let originalRemovalSent = false;
  let targetRemovalSent = false;
  let failure: Error | undefined;
  try {
    await checkpoint('vacating-original', original);
    originalRemovalSent = true;
    const removed = await mutate('alibaba.scbp.showcase.deleteproduct', {
      window_id_list: [original.windowId]
    });
    if (!removed || !sameEntries(retained, await list())) throw new Error('ORIGINAL_REMOVAL_NOT_CONFIRMED');
    await checkpoint('original-vacated', original);
    const acknowledged = await mutate('alibaba.scbp.showcase.addproduct', { product_id_list: [targetId] });
    const after = await list();
    if (!acknowledged) throw new Error('TARGET_ADD_RECEIPT_UNKNOWN');
    ownTarget = newShowcaseEntry(before, after, targetId);
    if (!sameEntries([...retained, ownTarget], after)) throw new Error('SHOWCASE_CHANGED_DURING_TEST');
    await checkpoint('target-added-confirmed', ownTarget);
  } catch (error: unknown) {
    failure = error instanceof Error ? error : new Error('UNKNOWN_SWAP_FAILURE', { cause: error });
  }

  // Recovery is restricted to the original item and a positively acknowledged new item.
  // If an uncertain add occupies the slot, never guess ownership or resend a mutation.
  if (originalRemovalSent) {
    let current = await list();
    if (ownTarget) {
      if (!sameEntries([...retained, ownTarget], current)) throw new Error('TARGET_CHANGED_BEFORE_RECOVERY');
      await checkpoint('removing-test-target', ownTarget);
      targetRemovalSent = true;
      const removed = await mutate('alibaba.scbp.showcase.deleteproduct', {
        window_id_list: [ownTarget.windowId]
      });
      current = await list();
      if (!removed) failure ??= new Error('TARGET_REMOVE_RECEIPT_UNKNOWN');
    }
    if (current.some((row) => row.productId === targetId))
      throw new Error('TARGET_STILL_PRESENT_MANUAL_RECOVERY');
    if (sameEntries(before, current)) {
      await checkpoint('original-unchanged');
    } else {
      if (!sameEntries(retained, current)) throw new Error('NO_SAFE_SLOT_FOR_ORIGINAL_RECOVERY');
      await checkpoint('restoring-original', original);
      const restored = await mutate('alibaba.scbp.showcase.addproduct', {
        product_id_list: [original.productId]
      });
      current = await list();
      const replacement = newShowcaseEntry(retained, current, original.productId);
      if (!sameEntries([...retained, replacement], current))
        throw new Error('ORIGINAL_RESTORE_NOT_CONFIRMED');
      await checkpoint('original-restored', replacement);
      if (!restored) failure ??= new Error('ORIGINAL_RESTORE_RECEIPT_UNKNOWN');
    }
  }
  if (failure) throw failure;
  if (!ownTarget || !targetRemovalSent) throw new Error('SWAP_NOT_EXERCISED');
  await checkpoint('swap-restored');
}
