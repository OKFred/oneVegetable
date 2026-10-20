import { describe, expect, it, vi } from 'vitest';
import { verifyIopInventoryCycle } from '../lib/iop-inventory-acceptance';
import type { Assessment, InventoryCell } from '../lib/free-api-real-smoke';
import fixture from '../../mock/data/alibaba-auth/iop-inventory-cycle.json';

const before = fixture.baseline;
const plus = fixture.increased;
const passed = { status: 'passed' as const, reason: 'BUSINESS_ACKNOWLEDGED' };
function setup(snapshots: (typeof before | null)[]) {
  const read = vi.fn();
  for (const value of snapshots) read.mockResolvedValueOnce(value);
  read.mockResolvedValue(snapshots.at(-1));
  const write = vi
    .fn<(operate: 'plus' | 'sub', cell: InventoryCell) => Promise<Assessment>>()
    .mockResolvedValue(passed);
  const record = vi.fn().mockResolvedValue(undefined);
  const wait = vi.fn().mockResolvedValue(undefined);
  return { skuId: 102, inventoryCode: 'FIXTURE_WH', read, write, record, wait };
}
describe('isolated IOP inventory acceptance safety', () => {
  it('waits only by reads and restores exactly the selected SKU after a durable baseline', async () => {
    const input = setup([before, before, before, plus, plus, before]);
    const result = await verifyIopInventoryCycle(input);
    expect(result.status).toBe('passed');
    expect(input.write.mock.calls.map(([action, cell]) => [action, cell.skuId])).toEqual([
      ['plus', 102],
      ['sub', 102]
    ]);
    expect(input.wait).toHaveBeenCalledTimes(2);
    expect(input.record.mock.invocationCallOrder[0]).toBeLessThan(
      input.write.mock.invocationCallOrder[0] ?? 0
    );
  });
  it('stops before dispatch if persistence fails', async () => {
    const input = setup([before]);
    input.record.mockRejectedValueOnce(new Error('DISK_FULL'));
    await expect(verifyIopInventoryCycle(input)).rejects.toThrow('DISK_FULL');
    expect(input.write).not.toHaveBeenCalled();
  });
  it('never compensates for a timeout or an unexpected change to another warehouse/SKU', async () => {
    const unknown = setup([before, before]);
    unknown.write.mockResolvedValueOnce({ status: 'result-unknown', reason: 'TIMEOUT' });
    expect((await verifyIopInventoryCycle(unknown)).status).toBe('result-unknown');
    expect(unknown.write).toHaveBeenCalledTimes(1);
    const changed = setup([before, before, fixture.concurrentChange]);
    expect((await verifyIopInventoryCycle(changed)).status).toBe('result-unknown');
    expect(changed.write).toHaveBeenCalledTimes(1);
  });
  it('does not interpret missing stock or an unobserved accepted write as zero/success', async () => {
    const missing = setup([null]);
    expect((await verifyIopInventoryCycle(missing)).status).toBe('skipped-prerequisite');
    expect(missing.write).not.toHaveBeenCalled();
    const delayed = setup([before, before]);
    expect((await verifyIopInventoryCycle(delayed)).status).toBe('result-unknown');
    expect(delayed.write).toHaveBeenCalledTimes(1);
  });
});
