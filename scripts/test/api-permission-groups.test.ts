import { describe, expect, it } from 'vitest';

import fixture from '../../mock/data/api-permission-groups.json';
import { extractApiPermissionGroups } from '../lib/api-permission-groups';

describe('official API permission package names', () => {
  it('preserves the documented supplier package without its URL or description', () => {
    expect(extractApiPermissionGroups(fixture.supplier.applyScopes)).toEqual(['国际站企业集成基础权限包']);
  });

  it.each(fixture.cases)('$description', ({ applyScopes, expected }) => {
    const original = structuredClone(applyScopes);
    expect(extractApiPermissionGroups(applyScopes)).toEqual(expected);
    expect(applyScopes).toEqual(original);
  });

  it.each([
    undefined,
    null,
    false,
    0,
    '国际站企业集成基础权限包',
    '//open.taobao.com/docs/api_list.htm?scopeId=15249',
    {},
    { name: '国际站企业集成基础权限包' },
    { url: '//open.taobao.com/docs/api_list.htm?scopeId=15249' }
  ])('does not infer permission or qualification from non-array metadata: %j', (applyScopes) => {
    expect(extractApiPermissionGroups(applyScopes)).toEqual([]);
  });
});
