import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readIopBundle,
  parseOptions,
  summarizeRead,
  runReadPlan,
  installReadOnlyGuard,
  safeErrorCode,
  READ_PATHS,
  type ReadOperation,
  type WorkerGuard
} from '../smoke-iop-workbench-real';
import business from '../../mock/data/alibaba-auth/iop-business-responses.json';
import credentials from '../../mock/data/node-gateway-credentials.json';
import photoFixture from '../../mock/data/alibaba-auth/iop-photo-responses.json';

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__iopReadSmokeGuard');
  vi.unstubAllGlobals();
});

describe('IOP real workbench acceptance safety', () => {
  it('requires a single explicit read opt-in and validates optional product IDs', () => {
    expect(parseOptions(['--confirm-readonly', '--credential=artifacts/input.json'])).toEqual({
      credential: 'artifacts/input.json'
    });
    expect(
      parseOptions(['--confirm-readonly', '--credential=artifacts/input.json', '--product-id=100001'])
    ).toMatchObject({ productId: '100001' });
    expect(
      parseOptions(['--confirm-readonly', '--credential=artifacts/input.json', '--native-host-consent'])
    ).toMatchObject({ nativeHostConsent: true });
    expect(
      parseOptions(['--confirm-readonly', '--credential=artifacts/input.json', '--photo-group-id=1001'])
    ).toMatchObject({ photoGroupId: '1001' });
    for (const args of [
      [],
      ['--credential=foo'],
      ['--confirm-readonly', '--credential=foo', '--write'],
      ['--confirm-readonly', '--credential=foo', '--native-host-consent', '--native-host-consent'],
      ['--confirm-readonly', '--credential=foo', '--product-id=9007199254740993'],
      ['--confirm-readonly', '--credential=foo', '--photo-group-id=9007199254740993'],
      ['--confirm-readonly', '--credential=foo', '--photo-group-id=1001', '--photo-group-id=1002']
    ])
      expect(() => parseOptions(args)).toThrow();
  });
  it('requires an explicit IOP bundle and never guesses TOP compatibility', () => {
    expect(() => readIopBundle({ application: credentials.manual })).toThrow('EXPLICIT_IOP_BUNDLE_REQUIRED');
    expect(() => readIopBundle({ protocol: 'iop' })).toThrow('IOP_BUNDLE_INVALID');
    expect(safeErrorCode('private-secret')).toBe('ERROR_REDACTED');
    expect(safeErrorCode('ALIBABA_IOP_PHOTO_SCOPE_MISMATCH')).toBe('ALIBABA_IOP_PHOTO_SCOPE_MISMATCH');
    const bundle = {
      ...credentials.oauthBundle,
      protocol: 'iop',
      oauth: {
        ...credentials.oauthBundle.oauth,
        expiresAtUtc: new Date(Date.now() + 3600000).toISOString()
      }
    };
    expect(readIopBundle(bundle).protocol).toBe('iop');
    expect(() =>
      readIopBundle({ ...bundle, oauth: { ...bundle.oauth, expiresAtUtc: new Date(0).toISOString() } })
    ).toThrow('IOP_BUNDLE_INVALID');
  });
  it('uses dependent live IDs only and refuses malformed response summaries', async () => {
    const call = vi.fn().mockResolvedValue({ items: [] });
    const skip = vi.fn<(operation: ReadOperation, reason: string) => void>();
    await runReadPlan(call, skip, '100001');
    expect(call.mock.calls[0]).toEqual([
      'listProducts',
      { page: 1, pageSize: 1, language: 'en_US', productId: '100001' }
    ]);
    expect(skip.mock.calls.map(([operation]) => operation)).toEqual([
      'listPhotos',
      'renderProductSchema',
      'getProductInventory',
      'getTradeOrderLogistics'
    ]);
    expect(summarizeRead('listProducts', { items: [] })).toBe(0);
    expect(summarizeRead('renderProductSchema', { xml: business.schema.result.data })).toBe(1);
    expect(() =>
      summarizeRead('getProductInventory', { status: 'no-data', records: [], issues: ['drift'] })
    ).toThrow('READ_RESULT_INVALID');
  });
  it('reads only an explicitly selected existing photo group without scanning unrelated groups', async () => {
    const call = vi.fn().mockResolvedValue({ items: [] });
    const skip = vi.fn();
    await runReadPlan(call, skip, undefined, '1001');
    expect(call).toHaveBeenCalledWith('listPhotoGroups', { parentId: '1001' });
    expect(call.mock.calls.some(([operation]) => operation === 'listPhotos')).toBe(false);
    call.mockClear();
    call.mockImplementation((operation) =>
      Promise.resolve(operation === 'listPhotoGroups' ? photoFixture.deleteProofGroups : { items: [] })
    );
    await runReadPlan(call, skip, undefined, '1001');
    expect(call).toHaveBeenCalledWith('listPhotos', { groupId: '1001', page: 1, pageSize: 1 });
  });
  it('allows exactly one armed signed read and blocks mutation, TOP and token traffic', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 0 }));
    vi.stubGlobal('fetch', send);
    installReadOnlyGuard({
      origin: 'https://openapi-api.alibaba.com',
      paths: {
        listProducts: '/rest/alibaba/icbu/product/list',
        listProductGroups: '/rest/alibaba/icbu/product/group/get',
        listPhotoGroups: '/rest/icbu/product/photobank/group/list',
        listPhotos: '/rest/icbu/product/photobank/list',
        renderProductSchema: '/rest/icbu/product/schema/render',
        listTradeOrders: '/rest/alibaba/order/list',
        getTradeOrderLogistics: '/rest/order/logistics/query',
        getProductInventory: '/rest/icbu/product/inventory/get'
      },
      intervalMs: 0
    });
    const guard = (globalThis as typeof globalThis & { __iopReadSmokeGuard: WorkerGuard })
      .__iopReadSmokeGuard;
    const init = {
      method: 'POST',
      headers: { 'X-Request-ID': 'fixture-request' },
      body: 'access_token=fixture&sign=fixture&sign_method=sha256'
    };
    await expect(
      fetch('https://openapi-api.alibaba.com/rest/alibaba/icbu/product/list', init)
    ).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    guard.arm('listProducts', 'fixture-request');
    for (const url of [
      'https://openapi-api.alibaba.com/rest/icbu/product/schema/add',
      'https://openapi-api.alibaba.com/rest/auth/token/refresh',
      'https://eco.taobao.com/router/rest'
    ])
      await expect(fetch(url, init)).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    await fetch('https://openapi-api.alibaba.com/rest/alibaba/icbu/product/list', init);
    await expect(
      fetch('https://openapi-api.alibaba.com/rest/alibaba/icbu/product/list', init)
    ).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    expect(send).toHaveBeenCalledOnce();
    expect(guard.snapshot()).toMatchObject({ sent: 1, total: 1, blocked: 5 });
    guard.disarm();
  });
  it('serializes bounded unique group lookups and never repeats a group', async () => {
    let active = 0;
    let maximum = 0;
    const send = vi.fn<typeof fetch>().mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((done) => setTimeout(done, 2));
      active--;
      return Response.json({ code: 0 });
    });
    vi.stubGlobal('fetch', send);
    installReadOnlyGuard({
      origin: 'https://openapi-api.alibaba.com',
      paths: READ_PATHS,
      intervalMs: 0,
      maxGroupReads: 4
    });
    const guard = (globalThis as typeof globalThis & { __iopReadSmokeGuard: WorkerGuard })
      .__iopReadSmokeGuard;
    guard.arm('listProductGroups', 'fixture-request');
    const request = (group: number) =>
      fetch('https://openapi-api.alibaba.com/rest/alibaba/icbu/product/group/get', {
        method: 'POST',
        headers: { 'X-Request-ID': 'fixture-request' },
        body: `access_token=fixture&sign=fixture&sign_method=sha256&group_id=${group}`
      });
    await Promise.all([-1, 11, 12].map(request));
    expect(send).toHaveBeenCalledTimes(3);
    expect(maximum).toBe(1);
    await expect(request(11)).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    expect(send).toHaveBeenCalledTimes(3);
    expect(guard.snapshot()).toMatchObject({ total: 3, blocked: 1 });
  });
});
