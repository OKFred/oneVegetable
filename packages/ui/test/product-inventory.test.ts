// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core/errors';
import type { GatewayClient } from '@one-vegetable/core';
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
  it('isolates absolute quantities from both warehouse sources and changed operation identities', async () => {
    const gateway: GatewayClient = new MockGatewayClient(0);
    const warehouse = await gateway.request('getProductInventory', {
      productId: '10000001',
      source: 'product',
      language: 'en_US'
    });
    const absolute = {
      ...warehouse,
      source: 'absolute' as const,
      protocol: 'iop' as const,
      records: [],
      quantityEvidence: [
        { scope: 'spu' as const, skuId: null, status: 'available' as const, quantity: '0', reasonCode: null }
      ]
    };
    let gatewayId = 'iop-one';
    const contexts = vi.spyOn(gateway, 'galleryTransferContext').mockImplementation((operation) => {
      if (operation !== 'getProductInventory') throw new Error('PHOTO_CONTEXT_MUST_NOT_BE_USED');
      return Promise.resolve({ identity: 'account', gateway: gatewayId, storage: null });
    });
    const request = vi.spyOn(gateway, 'request').mockResolvedValue(absolute);
    const input = { kind: 'inventory', id: '10000001', source: 'absolute' } as const;
    expect(await requestPageDetail(gateway, 'extension', 'en_US', input)).toBe(absolute);
    await requestPageDetail(gateway, 'extension', 'en_US', input);
    expect(request).toHaveBeenCalledOnce();
    request.mockResolvedValue(warehouse);
    await requestPageDetail(gateway, 'extension', 'en_US', { ...input, source: 'product' });
    await requestPageDetail(gateway, 'extension', 'en_US', { ...input, source: 'sku' });
    expect(await requestPageDetail(gateway, 'extension', 'en_US', input)).toBe(absolute);
    expect(request).toHaveBeenCalledTimes(3);
    gatewayId = 'iop-two';
    request.mockResolvedValue(absolute);
    await requestPageDetail(gateway, 'extension', 'en_US', input);
    expect(request).toHaveBeenCalledTimes(4);
    expect(
      contexts.mock.calls.every(
        ([operation, payload]) => operation === 'getProductInventory' && payload?.productId === input.id
      )
    ).toBe(true);
    expect(request.mock.calls[0]?.[2]).toMatchObject({ galleryContext: { gateway: 'iop-one' } });
  });
  it('passes cancellation through async inventory context work without dispatch or an error', async () => {
    const gateway = new MockGatewayClient(0);
    const rows = ref((await gateway.request('listProducts', { page: 1, pageSize: 1 })).items);
    const context = await gateway.galleryTransferContext();
    const waiting = Promise.withResolvers<typeof context>();
    vi.spyOn(gateway, 'galleryTransferContext').mockReturnValue(waiting.promise);
    const request = vi.spyOn(gateway, 'request');
    const scope = effectScope();
    try {
      const service = scope.run(() =>
        useProductInventory(gateway, 'extension', ref('en_US'), rows, ref('one'))
      );
      if (!service) throw new Error('Missing service');
      service.source.value = 'absolute';
      await nextTick();
      const job = service.load();
      service.stop();
      waiting.resolve(context);
      await job;
      expect(request).not.toHaveBeenCalled();
      expect(service.states.value).toEqual({});
      expect(service.errors.value).toEqual({});
    } finally {
      scope.stop();
    }
  });
  it.each(['failed', 'drift'] as const)(
    'retains the last absolute snapshot after a %s response',
    async (status) => {
      const gateway = new MockGatewayClient(0);
      const rows = ref((await gateway.request('listProducts', { page: 1, pageSize: 1 })).items);
      const warehouse = await gateway.request('getProductInventory', {
        productId: '10000001',
        source: 'product',
        language: 'en_US'
      });
      const snapshot = {
        ...warehouse,
        source: 'absolute' as const,
        protocol: 'iop' as const,
        records: [],
        quantityEvidence: [
          {
            scope: 'spu' as const,
            skuId: null,
            status: 'available' as const,
            quantity: '0',
            reasonCode: null
          }
        ]
      };
      const request = vi.spyOn(gateway, 'request').mockResolvedValue(snapshot);
      const scope = effectScope();
      try {
        const service = scope.run(() => useProductInventory(gateway, 'mock', ref('en_US'), rows, ref('one')));
        if (!service) throw new Error('Missing service');
        service.source.value = 'absolute';
        await nextTick();
        service.selected.value = rows.value[0] ?? null;
        await nextTick();
        await vi.waitFor(() => {
          expect(service.busy.value).toBe(false);
        });
        expect(service.snapshots.value['10000001']).toBe(snapshot);
        request.mockResolvedValueOnce({
          ...snapshot,
          status,
          reasonCode: 'INVENTORY_RESPONSE_INVALID',
          quantityEvidence: []
        });
        await service.refreshSelected();
        expect(service.states.value['10000001']).toBe('failed');
        expect(service.errors.value['10000001']).toBeDefined();
        expect(service.snapshots.value['10000001']).toBe(snapshot);
        await service.load(true);
        expect(service.states.value['10000001']).toBe('ready');
        expect(service.errors.value['10000001']).toBeUndefined();
      } finally {
        scope.stop();
      }
    }
  );
});
