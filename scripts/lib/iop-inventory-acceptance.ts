import { inventoryRoundTrip, type Assessment, type InventoryCell } from './free-api-real-smoke';
import { observeInventoryTransition } from './inventory-rebaseline';

/** Fresh experiment only; never claims to resolve a historical inventory receipt. */
export async function verifyIopInventoryCycle(input: {
  skuId: number;
  inventoryCode: string;
  read: () => Promise<InventoryCell[] | null>;
  write: (operate: 'plus' | 'sub', cell: InventoryCell) => Promise<Assessment>;
  record: (phase: string, result: Assessment, inventory?: InventoryCell[] | null) => Promise<void>;
  wait: () => Promise<void>;
}): Promise<Assessment> {
  const orderedRead = async () => {
    const cells = await input.read();
    const selected = cells?.find((cell) => cell.skuId === input.skuId && cell.code === input.inventoryCode);
    return selected && cells ? [selected, ...cells.filter((cell) => cell !== selected)] : null;
  };
  const baseline = await orderedRead();
  if (!baseline?.length) return { status: 'skipped-prerequisite', reason: 'NO_KNOWN_INVENTORY_BASELINE' };
  await input.record('baseline', { status: 'passed', reason: 'DURABLE_FRESH_BASELINE' }, baseline);
  const increased = baseline.map((cell, index) => (index ? cell : { ...cell, quantity: cell.quantity + 1 }));
  return inventoryRoundTrip({
    baseline,
    write: input.write,
    record: input.record,
    read: (phase) =>
      phase === 'baseline'
        ? orderedRead()
        : observeInventoryTransition({
            before: phase === 'after-plus' ? baseline : increased,
            expected: phase === 'after-plus' ? increased : baseline,
            read: orderedRead,
            wait: input.wait,
            attempts: 16
          })
  });
}
