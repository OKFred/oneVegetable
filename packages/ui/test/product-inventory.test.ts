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
  it('keeps a failed refresh distinct from its last snapshot and retries without the old cache', async () => {
    const gateway = new MockGatewayClient(0);
    const rows = ref((await gateway.request('listProducts', { page: 1, pageSize: 1 })).items);
    const scope = effectScope();
    try {
      const service = scope.run(() => useProductInventory(gateway, 'mock', ref('en_US'), rows, ref('one')));
      const product = rows.value[0];
      if (!service || !product) throw new Error('Missing inventory fixture');
      service.selected.value = product;
      await nextTick();
      await vi.waitFor(() => {
        expect(service.busy.value).toBe(false);
      });
      const snapshot = service.snapshots.value[product.id];
      expect(snapshot?.status).toBe('ready');
      const failure = new Error('Inventory refresh timed out');
      const request = vi.spyOn(gateway, 'request').mockRejectedValueOnce(failure);
      await service.refreshSelected();
      expect(service.states.value[product.id]).toBe('failed');
      expect(service.errors.value[product.id]).toBe(failure);
      expect(service.snapshots.value[product.id]).toBe(snapshot);
      await service.load(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect(service.states.value[product.id]).toBe('ready');
      expect(service.errors.value[product.id]).toBeUndefined();
      expect(service.snapshots.value[product.id]).not.toBe(snapshot);
    } finally {
      scope.stop();
      vi.restoreAllMocks();
    }
  });
});
