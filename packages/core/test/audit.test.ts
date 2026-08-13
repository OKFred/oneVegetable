import { describe, expect, it } from 'vitest';

import { createEntityAuditFields, normalizeRemark, updateEntityAuditFields } from '../src/audit';

describe('entity audit fields', () => {
  it('uses millisecond timestamps and increments revision on every update', () => {
    const created = createEntityAuditFields('system:bootstrap', 1_723_456_789_012, ' created ');
    expect(created).toEqual({
      createTimeUtc: 1_723_456_789_012,
      updateTimeUtc: 1_723_456_789_012,
      creatorId: 'system:bootstrap',
      updaterId: 'system:bootstrap',
      revision: 1,
      remark: 'created'
    });

    const updated = updateEntityAuditFields(created, 'admin-1', 1_723_456_789_999, '   ');
    expect(updated).toMatchObject({
      createTimeUtc: created.createTimeUtc,
      creatorId: 'system:bootstrap',
      updateTimeUtc: 1_723_456_789_999,
      updaterId: 'admin-1',
      revision: 2,
      remark: null
    });
  });

  it('counts Unicode code points and rejects oversized remarks', () => {
    expect(normalizeRemark(` ${'蔬'.repeat(500)} `)).toHaveLength(500);
    expect(() => normalizeRemark('蔬'.repeat(501))).toThrow('500');
  });
});
