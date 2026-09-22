import { fingerprint, type Assessment, type InventoryCell } from './free-api-real-smoke';

export const INVENTORY_UPDATE_METHOD = 'alibaba.icbu.product.inventory.update';

export function assertInventoryReceiptTarget(
  priorKey: string,
  accountKey: string,
  productId: number,
  baseline: InventoryCell[]
): void {
  if (
    !baseline.length ||
    fingerprint([
      INVENTORY_UPDATE_METHOD,
      [accountKey, productId, baseline.map((cell) => [cell.skuId, cell.code])]
    ]) !== priorKey
  )
    throw new Error('PRIOR_INVENTORY_TARGET_MISMATCH');
}

/** A new, explicitly authorized experiment does not resolve the historical receipt. */
export function assertInventoryRebaseline(
  priorKey: string,
  unresolved: { key: string; method: string }[],
  accountKey: string,
  productId: number,
  baseline: InventoryCell[]
): void {
  assertInventoryReceiptTarget(priorKey, accountKey, productId, baseline);
  if (
    unresolved.length !== 1 ||
    unresolved[0]?.key !== priorKey ||
    unresolved[0].method !== INVENTORY_UPDATE_METHOD
  ) {
    throw new Error('REBASELINE_REQUIRES_EXACT_PRIOR_TARGET_AND_ONLY_ONE_UNRESOLVED_RECEIPT');
  }
}

/** Poll reads only for propagation; never resend a write or accept unrelated stock changes. */
export async function observeInventoryTransition(input: {
  before: InventoryCell[];
  expected: InventoryCell[];
  read: () => Promise<InventoryCell[] | null>;
  wait: () => Promise<void>;
  attempts?: number;
}): Promise<InventoryCell[] | null> {
  let observed: InventoryCell[] | null = null;
  const attempts = Math.max(1, Math.min(16, input.attempts ?? 4));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await input.wait();
    observed = await input.read();
    if (JSON.stringify(observed) === JSON.stringify(input.expected)) return observed;
    if (JSON.stringify(observed) !== JSON.stringify(input.before)) return observed;
  }
  return observed;
}

/** Only resume subtraction of an acknowledged plus whose exact full snapshot is now visible. */
export async function restoreDelayedInventory(input: {
  baseline: InventoryCell[];
  read: () => Promise<InventoryCell[] | null>;
  write: (cell: InventoryCell) => Promise<Assessment>;
  record: (phase: string, assessment: Assessment, inventory?: InventoryCell[] | null) => Promise<void>;
  wait: () => Promise<void>;
}): Promise<Assessment> {
  const cell = input.baseline[0];
  if (!cell) return { status: 'skipped-prerequisite', reason: 'NO_DURABLE_RECOVERY_BASELINE' };
  const increased = input.baseline.map((value, index) =>
    index === 0 ? { ...value, quantity: value.quantity + 1 } : value
  );
  const current = await input.read();
  if (JSON.stringify(current) !== JSON.stringify(increased)) {
    return { status: 'skipped-prerequisite', reason: 'EXACT_PLUS_ONE_NOT_VISIBLE_NO_SUBTRACTION' };
  }
  await input.record(
    'delayed-plus-verified',
    { status: 'passed', reason: 'FULL_SNAPSHOT_MATCHES_PLUS_ONE' },
    current
  );
  await input.record('sub-intent', { status: 'result-unknown', reason: 'SUB_ONE_TO_DURABLE_NEW_BASELINE' });
  const outcome = await input.write(cell);
  await input.record('sub-result', outcome);
  if (outcome.status !== 'passed')
    return { status: 'result-unknown', reason: 'SUB_OUTCOME_UNKNOWN_NO_RETRY' };
  const restored = await observeInventoryTransition({
    before: increased,
    expected: input.baseline,
    read: input.read,
    wait: input.wait,
    attempts: 16
  });
  await input.record(
    'delayed-sub-readback',
    { status: 'result-unknown', reason: 'RESTORATION_OBSERVATION' },
    restored
  );
  return JSON.stringify(restored) === JSON.stringify(input.baseline)
    ? { status: 'passed', reason: 'DELAYED_PLUS_ONE_SUB_ONE_NEW_BASELINE_RESTORED' }
    : { status: 'result-unknown', reason: 'RESTORATION_NOT_VISIBLE_NO_RETRY' };
}
