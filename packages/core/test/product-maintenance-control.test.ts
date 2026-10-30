import { describe, expect, it } from 'vitest';
import { validateProductMaintenanceServiceResult } from '../src/product-maintenance-control';
import {
  createProductMaintenanceBaselineFingerprint,
  parseProductMaintenanceRecord
} from '../src/product-maintenance-service';
import type { ProductMaintenanceTask } from '../src/product-maintenance-service';
import { classifyProductMaintenanceResponse } from '../src/product-maintenance-api';
import bridge from '../../../mock/data/product-maintenance-bridge.json';
import domain from '../../../mock/data/product-maintenance-api.json';
import records from '../../../mock/data/product-maintenance-repository.json';

function prepared(name: 'inventory' | 'price' | 'deleteOne' = 'inventory'): ProductMaintenanceTask {
  const item = parseProductMaintenanceRecord(records.records[name]).task;
  item.requestId = bridge.requestId;
  return item;
}
function sent(): ProductMaintenanceTask {
  const item = prepared();
  item.status = 'accepted';
  item.submitAttempted = true;
  item.submittedTimeUtc = item.createTimeUtc;
  item.receipt = classifyProductMaintenanceResponse(item.intent.draft, domain.responses.accepted);
  return item;
}
const validate = (task: ProductMaintenanceTask) => validateProductMaintenanceServiceResult({ tasks: [task] });

describe('maintenance control result integrity', () => {
  it.each(['inventory', 'price', 'deleteOne'] as const)(
    'accepts a valid prepared %s record',
    async (name) => {
      const input = prepared(name);
      const result = await validate(input);
      expect(result.tasks[0]?.status).toBe('prepared');
      expect(result.tasks[0]).not.toBe(input);
      expect(input.status).toBe('prepared');
    }
  );
  it.each(bridge.baselineChanges)('rejects a corrupt baseline: $kind', async (change) => {
    const input = prepared();
    const baseline = input.baseline;
    if (!baseline) throw new Error('Missing synthetic baseline');
    if (change.kind === 'fingerprint') baseline.fingerprint = change.fingerprint ?? bridge.hashes.invalid;
    else if (change.kind === 'field') {
      baseline.fields = { ...baseline.fields, [change.path ?? '']: change.value ?? '' };
    } else {
      baseline.productId = change.productId ?? '';
      // Even a self-consistent hash for another product is not the current task's baseline.
      baseline.fingerprint = await createProductMaintenanceBaselineFingerprint(
        baseline.productId,
        baseline.fields
      );
    }
    await expect(validate(input)).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  });
  it('hashes read-only fields canonically without mutating their order or values', async () => {
    const input = prepared('price');
    const baseline = input.baseline;
    if (!baseline) throw new Error('Missing synthetic baseline');
    const fields = Object.freeze(Object.fromEntries(Object.entries(baseline.fields).reverse()));
    const before = JSON.stringify(fields);
    expect(await createProductMaintenanceBaselineFingerprint(baseline.productId, fields)).toBe(
      baseline.fingerprint
    );
    expect(JSON.stringify(fields)).toBe(before);
  });
  it('returns frozen baseline fields and hash-bearing metadata', async () => {
    const input = prepared();
    const result = await validate(input);
    const baseline = result.tasks[0]?.baseline;
    if (!baseline) throw new Error('Missing checked baseline');
    expect(Object.isFrozen(baseline.fields)).toBe(true);
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Reflect.set(baseline.fields, 'inventory', domain.snapshots.inventoryMismatch.inventory)).toBe(
      false
    );
    expect(await createProductMaintenanceBaselineFingerprint(baseline.productId, baseline.fields)).toBe(
      baseline.fingerprint
    );
  });
  it('snapshots input before awaiting imports and hashes', async () => {
    const input = prepared();
    const pending = validate(input);
    input.status = 'cancelled';
    if (!input.baseline) throw new Error('Missing synthetic baseline');
    Reflect.set(input.baseline.fields, 'inventory', domain.snapshots.inventoryMismatch.inventory);
    const result = await pending;
    expect(result.tasks[0]?.status).toBe('prepared');
    expect(result.tasks[0]?.baseline?.fields).toEqual(records.records.inventory.task.baseline.fields);
  });
  it.each(bridge.readbacks)('checks readback meaning for $name', async (entry) => {
    const input = sent();
    input.readback = entry.value as ProductMaintenanceTask['readback'];
    if (entry.valid) expect((await validate(input)).tasks[0]?.status).toBe('accepted');
    else await expect(validate(input)).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  });
  it.each(bridge.readbacks)('permits verified only with a wholly matched readback: $name', async (entry) => {
    const input = sent();
    input.status = 'verified';
    input.readback = entry.value as ProductMaintenanceTask['readback'];
    if (entry.name === 'matched') expect((await validate(input)).tasks[0]?.status).toBe('verified');
    else await expect(validate(input)).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  });
  it('rejects verified without readback or with an error reason', async () => {
    const missing = sent();
    missing.status = 'verified';
    await expect(validate(missing)).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
    const contradictory = sent();
    contradictory.status = 'verified';
    const matching = bridge.readbacks.find((entry) => entry.name === 'matched');
    if (!matching) throw new Error('Missing synthetic readback');
    contradictory.readback = matching.value as ProductMaintenanceTask['readback'];
    contradictory.reasonCode = 'PRODUCT_MAINTENANCE_READBACK_UNAVAILABLE';
    await expect(validate(contradictory)).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  });
  it('continues to reject changed intents and unexpected response roots', async () => {
    const input = prepared();
    input.intent.fingerprint = bridge.hashes.invalid;
    await expect(validate(input)).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
    await expect(
      validateProductMaintenanceServiceResult({ tasks: [prepared()], raw: bridge.marker })
    ).rejects.toThrow('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  });
});
