import { describe, expect, it } from 'vitest';
import fixture from '../../mock/data/alibaba-auth/iop-photo-responses.json';
import { confirmedEmptyPhotoChild, confirmedPhotoChildRemoved } from '../lib/iop-photo-delete-proof';
import type { PhotoPage } from '../../packages/core/src/types';

describe('operator-only IOP photo-group deletion proof', () => {
  const groups = fixture.deleteProofGroups;
  const leaf = groups.filter((group) => group.id === '1003');
  const empty: PhotoPage = { page: 1, pageSize: 1, total: 0, hasNextPage: false, items: [] };
  it('requires both exact group identities and a consistent zero total', () => {
    expect(confirmedEmptyPhotoChild('1001', '1003', groups, empty, leaf)).toBe(true);
    for (const page of [
      { ...empty, total: null },
      { ...empty, total: 1 },
      { ...empty, hasNextPage: true },
      { ...empty, page: 2 }
    ]) {
      expect(confirmedEmptyPhotoChild('1001', '1003', groups, page, leaf)).toBe(false);
    }
  });
  it('does not use fabricated group counts, missing parents, siblings or duplicate identities as proof', () => {
    expect(
      confirmedEmptyPhotoChild(
        '1001',
        '1003',
        groups.filter((group) => group.id !== '1001'),
        empty,
        leaf
      )
    ).toBe(false);
    expect(confirmedEmptyPhotoChild('1001', '1003', [...groups, ...groups], empty, leaf)).toBe(false);
    expect(
      confirmedEmptyPhotoChild(
        '1001',
        '1003',
        groups.map((group) => ({ ...group, parentId: null })),
        empty,
        leaf
      )
    ).toBe(false);
    expect(confirmedEmptyPhotoChild('1001', '1001', groups, empty, leaf)).toBe(false);
    expect(confirmedEmptyPhotoChild('1001', '1003', groups, empty, [])).toBe(false);
    expect(confirmedEmptyPhotoChild('1001', '1003', groups, empty, groups)).toBe(false);
    expect(
      confirmedEmptyPhotoChild('1001', '1003', [...groups, ...fixture.deleteProofDescendants], empty, leaf)
    ).toBe(false);
    expect(
      confirmedEmptyPhotoChild('1001', '1003', groups, empty, [...leaf, ...fixture.deleteProofDescendants])
    ).toBe(false);
  });
  it('requires the parent to remain present after deletion', () => {
    expect(confirmedPhotoChildRemoved('1001', '1003', groups)).toBe(false);
    expect(confirmedPhotoChildRemoved('1001', '1003', [])).toBe(false);
    expect(
      confirmedPhotoChildRemoved(
        '1001',
        '1003',
        groups.filter((group) => group.id === '1001')
      )
    ).toBe(true);
  });
});
