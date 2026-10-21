import { describe, expect, it } from 'vitest';
import fixture from '../../mock/data/alibaba-auth/iop-photo-responses.json';
import { photoProbeScope, photoProbeTransport } from '../lib/iop-photo-probe';

describe('operator-only IOP public SDK photo comparison', () => {
  const request = {
    url: 'https://openapi-api.alibaba.com/rest/icbu/product/photobank/list',
    parameters: {
      groupId: '1001',
      currentPage: '1',
      pageSize: '24',
      app_key: 'fixture-key',
      access_token: 'fixture-private-token',
      timestamp: '1',
      sign_method: 'sha256',
      simplify: 'true',
      sign: 'fixture-signature'
    }
  };
  it('separates public and business parameters without changing any signed value', () => {
    const result = photoProbeTransport(request, 'sdk-query-form');
    const url = new URL(result.url);
    expect([...result.body.keys()]).toEqual(['groupId', 'currentPage', 'pageSize']);
    expect(url.searchParams.has('groupId')).toBe(false);
    expect(result.body.has('access_token')).toBe(false);
    const combined = Object.fromEntries([...url.searchParams, ...result.body]);
    expect(combined).toEqual(request.parameters);
    expect(new Set([...url.searchParams.keys(), ...result.body.keys()]).size).toBe(
      Object.keys(request.parameters).length
    );
    expect(request.url).not.toContain('?');
  });
  it('keeps the documented form comparison unchanged', () => {
    const result = photoProbeTransport(request, 'documented');
    expect(result.url).toBe(request.url);
    expect(Object.fromEntries(result.body)).toEqual(request.parameters);
  });
  it('cannot send to a mutation, TOP, foreign origin or pre-populated sensitive URL', () => {
    for (const url of [
      request.url.replace('/list', '/group/operate'),
      request.url.replace('openapi-api.alibaba.com', 'eco.taobao.com'),
      request.url.replace('openapi-api.alibaba.com', 'example.com'),
      `${request.url}?access_token=fixture-private-token`,
      `${request.url}#fragment`,
      request.url.replace('https://', 'https://user:pass@')
    ])
      expect(() => photoProbeTransport({ ...request, url }, 'sdk-query-form')).toThrow(
        'PHOTO_PROBE_READ_PATH_REQUIRED'
      );
    expect(() => photoProbeTransport({ ...request, parameters: {} }, 'sdk-query-form')).toThrow(
      'PHOTO_PROBE_PARAMETERS_REQUIRED'
    );
  });
  it('records missing and invalid scope separately without storing returned business data', () => {
    const items = [
      ...fixture.scopedPhotos.result.pagination_query_list.list,
      ...fixture.photoScopeCases.map((item) => ({ group_id: item.groupId })),
      { group_id: null },
      { group_id: true },
      { group_id: '' },
      { group_id: 0 },
      { file_name: 'private-name', url: 'https://example.com/private' }
    ];
    const summary = photoProbeScope(items, '1001');
    expect(summary).toEqual({
      returned: 10,
      targetGroup: 1,
      otherGroup: 1,
      missingGroup: 3,
      invalidGroup: 5
    });
    const serialized = JSON.stringify(summary);
    for (const secret of ['1001', '1002', 'private-name', 'https://', 'file_name', 'fixture.png'])
      expect(serialized).not.toContain(secret);
    expect(photoProbeScope([], '1001')).toEqual({
      returned: 0,
      targetGroup: 0,
      otherGroup: 0,
      missingGroup: 0,
      invalidGroup: 0
    });
  });
});
