import { validatePackingInput, type PackingInput } from './packing-layout';

export const PACKING_PLANS_STORAGE_KEY = 'one-vegetable:packing-plans:v1';
export const PACKING_PLAN_MAX_BYTES = 64 * 1024;
export const PACKING_PLANS_LIMIT = 20;
const MAX_STORAGE_BYTES = 512 * 1024;

export interface PackingPlan {
  kind: 'one-vegetable-packing-plan';
  schemaVersion: 1;
  unit: 'mm';
  name: string;
  input: PackingInput;
}
export interface SavedPackingPlan {
  savedAtUtc: number;
  plan: PackingPlan;
}
export class PackingPlanError extends Error {
  constructor(
    readonly code: 'invalidFile' | 'invalidName' | 'storageCorrupt' | 'storageUnavailable' | 'limit'
  ) {
    super(code);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}
export function createPackingPlan(name: string, input: PackingInput): PackingPlan {
  if (!name.trim() || name.trim().length > 80) throw new PackingPlanError('invalidName');
  validatePackingInput(input);
  return {
    kind: 'one-vegetable-packing-plan',
    schemaVersion: 1,
    unit: 'mm',
    name: name.trim(),
    input: {
      container: {
        length: input.container.length,
        width: input.container.width,
        height: input.container.height
      },
      cargo: input.cargo.map((item) => ({
        id: item.id,
        name: item.name,
        size: { length: item.size.length, width: item.size.width, height: item.size.height },
        quantity: item.quantity,
        allowRotation: item.allowRotation
      }))
    }
  };
}
function parsePlan(value: unknown): PackingPlan {
  if (
    !record(value) ||
    value.kind !== 'one-vegetable-packing-plan' ||
    value.schemaVersion !== 1 ||
    value.unit !== 'mm' ||
    typeof value.name !== 'string'
  ) {
    throw new PackingPlanError('invalidFile');
  }
  try {
    // Validate unknown input at the file/storage boundary, then copy only input fields.
    return createPackingPlan(value.name, value.input as PackingInput);
  } catch {
    throw new PackingPlanError('invalidFile');
  }
}
export function parsePackingPlanJson(text: string): PackingPlan {
  if (bytes(text) > PACKING_PLAN_MAX_BYTES) throw new PackingPlanError('invalidFile');
  try {
    return parsePlan(JSON.parse(text) as unknown);
  } catch {
    throw new PackingPlanError('invalidFile');
  }
}
export function serializePackingPlan(plan: PackingPlan): string {
  return JSON.stringify(parsePlan(plan), null, 2);
}

export function readSavedPackingPlans(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage
): SavedPackingPlan[] {
  let text: string | null;
  try {
    text = storage.getItem(PACKING_PLANS_STORAGE_KEY);
  } catch {
    throw new PackingPlanError('storageUnavailable');
  }
  if (text === null) return [];
  try {
    if (bytes(text) > MAX_STORAGE_BYTES) throw new Error('size');
    const value: unknown = JSON.parse(text);
    if (
      !record(value) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.plans) ||
      value.plans.length > PACKING_PLANS_LIMIT
    )
      throw new Error('format');
    const names = new Set<string>();
    return value.plans
      .map((item: unknown) => {
        if (
          !record(item) ||
          typeof item.savedAtUtc !== 'number' ||
          !Number.isSafeInteger(item.savedAtUtc) ||
          item.savedAtUtc < 0
        )
          throw new Error('date');
        const plan = parsePlan(item.plan);
        const key = normalizedName(plan.name);
        if (names.has(key)) throw new Error('duplicate');
        names.add(key);
        return { savedAtUtc: item.savedAtUtc, plan };
      })
      .sort((a, b) => b.savedAtUtc - a.savedAtUtc);
  } catch {
    throw new PackingPlanError('storageCorrupt');
  }
}
function writePlans(plans: SavedPackingPlan[], storage: Pick<Storage, 'setItem' | 'removeItem'>): void {
  const text = JSON.stringify({ schemaVersion: 1, plans });
  if (bytes(text) > MAX_STORAGE_BYTES) throw new PackingPlanError('limit');
  try {
    if (plans.length) storage.setItem(PACKING_PLANS_STORAGE_KEY, text);
    else storage.removeItem(PACKING_PLANS_STORAGE_KEY);
  } catch {
    throw new PackingPlanError('storageUnavailable');
  }
}
export function savePackingPlan(
  plan: PackingPlan,
  storage: Storage = globalThis.localStorage,
  now = Date.now()
): void {
  const clean = parsePlan(plan);
  const plans = readSavedPackingPlans(storage).filter(
    (item) => normalizedName(item.plan.name) !== normalizedName(clean.name)
  );
  if (plans.length >= PACKING_PLANS_LIMIT) throw new PackingPlanError('limit');
  if (!Number.isSafeInteger(now) || now < 0) throw new PackingPlanError('storageUnavailable');
  writePlans([{ plan: clean, savedAtUtc: now }, ...plans], storage);
}
export function deletePackingPlan(name: string, storage: Storage = globalThis.localStorage): void {
  const plans = readSavedPackingPlans(storage).filter(
    (item) => normalizedName(item.plan.name) !== normalizedName(name)
  );
  writePlans(plans, storage);
}
