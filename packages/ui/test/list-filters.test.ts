import { describe, expect, it } from 'vitest';
import { platformDateFilter, validFilterRange } from '../src/lib/list-filters';

describe('platform list filter dates', () => {
  it('preserves wall-clock strings and seconds without timezone conversion', () => {
    expect(platformDateFilter('2026-09-23T08:09')).toBe('2026-09-23 08:09:00');
    expect(platformDateFilter('2026-09-23T08:09', true)).toBe('2026-09-23 08:09:59');
    expect(platformDateFilter('2026-09-23T08:09:10')).toBe('2026-09-23 08:09:10');
  });
  it('rejects invalid dates and backwards ranges, allows either open boundary', () => {
    expect(validFilterRange('2026-02-30T12:00', '')).toBe(false);
    expect(validFilterRange('2026-09-23T25:00', '')).toBe(false);
    expect(validFilterRange('2026-09-23T00:00', '2026-09-22T00:00')).toBe(false);
    expect(validFilterRange('', '2026-09-23T12:34')).toBe(true);
    expect(validFilterRange('', '')).toBe(true);
  });
});
