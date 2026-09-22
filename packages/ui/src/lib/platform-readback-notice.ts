import type { ProductMutationJob } from '@one-vegetable/core';

export type PlatformReadbackNoticeKind = 'inventory' | 'accepted' | 'unconfirmed';

/** A sending intent is not a platform acknowledgement; errors are never relabelled as success. */
export function productReadbackNotice(
  status: ProductMutationJob['status']
): PlatformReadbackNoticeKind | null {
  if (status === 'auditing' || status === 'verifying' || status === 'recovering') return 'accepted';
  if (status === 'submitted' || status === 'recovery-required') return 'unconfirmed';
  return null;
}
