import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatTime } from '../src/lib/date-time';

describe('date-time formatting', () => {
  it('formats local dates and times with fixed-width fields', () => {
    const value = new Date(2026, 8, 1, 7, 8, 9);

    expect(formatDate(value)).toBe('2026-09-01');
    expect(formatTime(value)).toBe('07:08:09');
    expect(formatDateTime(value)).toBe('2026-09-01 07:08:09');
  });

  it('keeps date-only values independent from timezone conversion', () => {
    expect(formatDate('2026-01-02')).toBe('2026-01-02');
    expect(formatDateTime('2026-01-02')).toBe('2026-01-02 00:00:00');
  });

  it('uses the requested fallback for missing or invalid values', () => {
    expect(formatDate(null, '未提供')).toBe('未提供');
    expect(formatTime('invalid', '未知')).toBe('未知');
    expect(formatDateTime('2026-02-30', '—')).toBe('—');
  });
});
