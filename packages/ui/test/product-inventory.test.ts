// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core/errors';
import { requestPageDetail } from '../src/lib/page-details';
import { useProductInventory } from '../src/lib/product-inventory';

describe('inventory workspace scheduling', () => {
  it('shares in-flight and fresh results, isolates source/language and supports explicit refresh', async () => {
    const gateway = new MockGatewayClient(0);
    const spy = vi.spyOn(gateway, 'request');
    const req = { kind: 'inventory', id: '10000001', source: 'product' } as const;
    await Promise.all([
      requestPageDetail(gateway, 'mock', 'en_US', req),
      requestPageDetail(gateway, 'mock', 'en_US', req)
    ]);
    await requestPageDetail(gateway, 'mock', 'en_US', req);
    expect(spy).toHaveBeenCalledTimes(1);
    await requestPageDetail(gateway, 'mock', 'en_US', req, undefined, true);
    await requestPageDetail(gateway, 'mock', 'zh_CN', req);
    await requestPageDetail(gateway, 'mock', 'en_US', { ...req, source: 'sku' });
    expect(spy).toHaveBeenCalledTimes(4);
  });
  it('keeps reads opt-in and shows the selected product from the same cache', async () => {
    const gateway = new MockGatewayClient(0);
    const rows = ref((await gateway.request('listProducts', { page: 1, pageSize: 2 })).items);
    const scope = effectScope();
    const boundary = ref('page-1');
    const service = scope.run(() => useProductInventory(gateway, 'mock', ref('en_US'), rows, boundary));
    if (!service) throw new Error('Missing service');
    const spy = vi.spyOn(gateway, 'request');
    expect(spy).not.toHaveBeenCalled();
    await service.load();
    const count = spy.mock.calls.length;
    service.selected.value = rows.value[0] ?? null;
    await nextTick();
    await vi.waitFor(() => {
      expect(service.busy.value).toBe(false);
    });
    expect(spy).toHaveBeenCalledTimes(count);
    boundary.value = 'page-2';
    await nextTick();
    expect(service.selected.value).toBeNull();
    expect(service.snapshots.value).toEqual({});
    scope.stop();
  });
  it('stops the remaining batch on revoked permission', async () => {
    const gateway = new MockGatewayClient(0);
    const rows = ref((await gateway.request('listProducts', { page: 1, pageSize: 2 })).items);
    const scope = effectScope();
    const service = scope.run(() => useProductInventory(gateway, 'mock', ref('en_US'), rows, ref('one')));
    const spy = vi
      .spyOn(gateway, 'request')
      .mockRejectedValue(
        new GatewayException({ code: 'PERMISSION_DENIED', message: 'denied', retryable: false })
      );
    await service?.load();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(service?.securityFailure.value).toBe(true);
    scope.stop();
  });
});
