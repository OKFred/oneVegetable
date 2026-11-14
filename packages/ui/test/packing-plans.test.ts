// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import input from '../../../mock/data/logistics/packing-example.json';
import {
  createPackingPlan,
  deletePackingPlan,
  PACKING_PLAN_MAX_BYTES,
  PACKING_PLANS_STORAGE_KEY,
  parsePackingPlanJson,
  readSavedPackingPlans,
  savePackingPlan,
  serializePackingPlan
} from '../src/lib/packing-plans';

beforeEach(() => {
  localStorage.clear();
});
const plan = () => createPackingPlan('Example', structuredClone(input));

describe('packing plan files and local storage', () => {
  it('roundtrips exact millimetres, counts, ordering and rotation without copying extra data', () => {
    const value = { ...plan(), placements: ['untrusted'], accessToken: 'not-a-real-token' };
    value.input.container.length = 601;
    const result = parsePackingPlanJson(JSON.stringify(value));
    expect(result.input.container.length).toBe(601);
    expect(result.input.cargo).toEqual(input.cargo);
    expect(serializePackingPlan(result)).not.toContain('accessToken');
    expect(result).not.toHaveProperty('placements');
    expect(parsePackingPlanJson(serializePackingPlan(result))).toEqual(result);
    value.input.container.length = 602;
    expect(result.input.container.length).toBe(601);
  });
  it.each([
    null,
    [],
    {},
    { ...plan(), schemaVersion: 2 },
    { ...plan(), unit: 'cm' },
    { ...plan(), kind: 'another-app' },
    { ...plan(), name: '' },
    { ...plan(), input: { ...input, cargo: [...input.cargo, input.cargo[0]] } },
    { ...plan(), input: { ...input, container: { length: 0, width: 1, height: 1 } } },
    { ...plan(), input: { ...input, cargo: [{ ...input.cargo[0], quantity: 501 }] } },
    { ...plan(), input: { ...input, cargo: [{ ...input.cargo[0], allowRotation: 'true' }] } }
  ])('rejects malformed or incompatible input %#', (value) => {
    expect(() => parsePackingPlanJson(JSON.stringify(value))).toThrow('invalidFile');
  });
  it('checks UTF-8 size before parsing and validates names', () => {
    expect(() => parsePackingPlanJson(' '.repeat(PACKING_PLAN_MAX_BYTES + 1))).toThrow('invalidFile');
    expect(() => parsePackingPlanJson('{"name":"' + '界'.repeat(30000) + '"}')).toThrow('invalidFile');
    expect(() => parsePackingPlanJson('{bad')).toThrow('invalidFile');
    expect(() => createPackingPlan(' ', input)).toThrow('invalidName');
    expect(() => createPackingPlan('a'.repeat(81), input)).toThrow('invalidName');
  });
  it('saves only explicitly, refreshes the list on every write and replaces names case-insensitively', () => {
    expect(readSavedPackingPlans()).toEqual([]);
    const first = plan();
    savePackingPlan(first, localStorage, 100);
    first.input.container.length = 700;
    expect(readSavedPackingPlans()[0]?.plan.input.container.length).toBe(600);
    savePackingPlan(createPackingPlan('other', input), localStorage, 150);
    savePackingPlan(createPackingPlan(' EXAMPLE ', first.input), localStorage, 200);
    const saved = readSavedPackingPlans();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      savedAtUtc: 200,
      plan: { name: 'EXAMPLE', input: { container: { length: 700 } } }
    });
    deletePackingPlan('example');
    expect(readSavedPackingPlans()).toHaveLength(1);
    deletePackingPlan('other');
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBeNull();
  });
  it('limits the library but allows replacing a plan at the limit', () => {
    for (let i = 0; i < 20; i++) savePackingPlan(createPackingPlan('plan-' + String(i), input));
    const baseline = localStorage.getItem(PACKING_PLANS_STORAGE_KEY);
    expect(() => {
      savePackingPlan(createPackingPlan('extra', input));
    }).toThrow('limit');
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBe(baseline);
    savePackingPlan(createPackingPlan('plan-0', input));
    expect(readSavedPackingPlans()).toHaveLength(20);
  });
  it('does not overwrite malformed storage or silently ignore storage denial and quota failures', () => {
    localStorage.setItem(PACKING_PLANS_STORAGE_KEY, '{broken');
    expect(() => {
      savePackingPlan(plan());
    }).toThrow('storageCorrupt');
    expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBe('{broken');
    localStorage.clear();
    const setItem = vi.fn(() => {
      throw new DOMException('quota');
    });
    const storage = { getItem: () => null, setItem, removeItem: vi.fn() } as unknown as Storage;
    expect(() => {
      savePackingPlan(plan(), storage);
    }).toThrow('storageUnavailable');
    expect(setItem).toHaveBeenCalledOnce();
    expect(() =>
      readSavedPackingPlans({
        getItem: () => {
          throw new Error('denied');
        }
      })
    ).toThrow('storageUnavailable');
  });
  it('rejects invalid saved timestamps and duplicate entries without mutation', () => {
    for (const plans of [
      [{ plan: plan(), savedAtUtc: -1 }],
      [
        { plan: plan(), savedAtUtc: 1 },
        { plan: plan(), savedAtUtc: 2 }
      ]
    ]) {
      const raw = JSON.stringify({ schemaVersion: 1, plans });
      localStorage.setItem(PACKING_PLANS_STORAGE_KEY, raw);
      expect(() => readSavedPackingPlans()).toThrow('storageCorrupt');
      expect(localStorage.getItem(PACKING_PLANS_STORAGE_KEY)).toBe(raw);
    }
  });
});
