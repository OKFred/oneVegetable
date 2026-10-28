// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException, type GatewayClient, type TradeOrderAggregate } from '@one-vegetable/core';
import { pageDetailIdentity, requestPageDetail, usePageDetails } from '../src/lib/page-details';
import iopDetailFixture from '../../../mock/data/iop-order-public-detail.json';

describe('page details', () => {
  afterEach(() => vi.useRealTimers());
  it('clears loading immediately when stopped before identity resolves, without sending a read', async () => {
    const identity = Promise.withResolvers<string>();
    const query = vi.fn();
    const scope = effectScope();
    const service = scope.run(() =>
      usePageDetails(
        ref([{ id: 'one' }]),
        ref('page'),
        (row) => row.id,
        query,
        vi.fn(),
        () => identity.promise
      )
    );
    if (!service) throw new Error('Effect scope was inactive');
    const job = service.load();
    expect(service.states.value).toEqual({ one: 'loading' });
    service.stop();
    expect(service.states.value).toEqual({});
    identity.resolve('account');
    await job;
    expect(query).not.toHaveBeenCalled();
    expect(service.busy.value).toBe(false);
    expect(service.states.value).toEqual({});
    scope.stop();
  });
  it('retains an already dispatched result after stop without scheduling the next row', async () => {
    const gateway = new MockGatewayClient(0);
    const waiting = Promise.withResolvers<undefined>();
    const query = vi.fn(async (row: { id: string }) => {
      await waiting.promise;
      return gateway.request('getProductScore', { productId: row.id });
    });
    const accept = vi.fn();
    const scope = effectScope();
    const service = scope.run(() =>
      usePageDetails(ref([{ id: 'one' }, { id: 'two' }]), ref('page'), (row) => row.id, query, accept)
    );
    if (!service) throw new Error('Effect scope was inactive');
    const job = service.load();
    await Promise.resolve();
    service.stop();
    expect(service.states.value).toEqual({});
    waiting.resolve(undefined);
    await job;
    expect(query).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledOnce();
    expect(service.states.value).toEqual({ one: 'ready' });
    scope.stop();
  });
  it('resets security stop on a new boundary and rechecks queued row visibility', async () => {
    const gateway = new MockGatewayClient(0);
    const boundary = ref('first-account');
    const query = vi
      .fn()
      .mockRejectedValue(
        new GatewayException({ code: 'PERMISSION_DENIED', message: 'Denied', retryable: false })
      );
    const scope = effectScope();
    const service = scope.run(() =>
      usePageDetails(ref([{ id: 'one' }, { id: 'two' }]), boundary, (row) => row.id, query, vi.fn())
    );
    if (!service) throw new Error('Effect scope was inactive');
    await service.load();
    expect(service.securityFailure.value).toBe(true);
    boundary.value = 'second-account';
    await nextTick();
    expect(service.securityFailure.value).toBe(false);
    query.mockImplementation((row: { id: string }) =>
      gateway.request('getProductScore', { productId: row.id })
    );
    await service.load(false, undefined, (row) => row.id === 'two');
    expect(service.states.value).toEqual({ two: 'ready' });
    expect(query).toHaveBeenCalledTimes(2);
    scope.stop();
  });
  it('captures the first checked identity for the whole batch without a duplicate lookup', async () => {
    const gateway = new MockGatewayClient(0);
    const identities: (string | undefined)[] = [];
    const scope = effectScope();
    const service = scope.run(() =>
      usePageDetails(
        ref([{ id: 'one' }, { id: 'two' }]),
        ref('page'),
        (row) => row.id,
        async (row, identity, control) => {
          identities.push(identity);
          control?.captureIdentity('account');
          return gateway.request('getProductScore', { productId: row.id });
        },
        vi.fn()
      )
    );
    if (!service) throw new Error('Effect scope was inactive');
    await service.load();
    expect(identities).toEqual([undefined, 'account']);
    scope.stop();
  });
  it('rechecks row eligibility after async context work and leaves no cancelled error', async () => {
    const gateway = new MockGatewayClient(0);
    const waiting = Promise.withResolvers<undefined>();
    const context = await gateway.galleryTransferContext();
    vi.spyOn(gateway, 'galleryTransferContext').mockImplementation(async () => {
      await waiting.promise;
      return context;
    });
    const request = vi.spyOn(gateway, 'request');
    const scope = effectScope();
    let visible = true;
    const service = scope.run(() =>
      usePageDetails(
        ref([{ id: 'one' }]),
        ref('page'),
        (row) => row.id,
        (row, identity, control) =>
          requestPageDetail(
            gateway,
            'mock',
            'en_US',
            { kind: 'score', id: row.id },
            identity,
            false,
            control
          ),
        vi.fn()
      )
    );
    if (!service) throw new Error('Effect scope was inactive');
    const job = service.load(false, undefined, () => visible);
    visible = false;
    waiting.resolve(undefined);
    await job;
    expect(request).not.toHaveBeenCalled();
    expect(service.states.value).toEqual({});
    expect(service.errors.value).toEqual({});
    expect(service.securityFailure.value).toBe(false);
    scope.stop();
  });
  it('checks independent contexts concurrently before dispatch and after the response', async () => {
    const gateway = new MockGatewayClient(0);
    const context = await gateway.galleryTransferContext();
    const gate = Promise.withResolvers<undefined>();
    const contexts = vi.spyOn(gateway, 'galleryTransferContext').mockImplementation(async () => {
      await gate.promise;
      return context;
    });
    const job = requestPageDetail(gateway, 'mock', 'en_US', { kind: 'score', id: 'one' });
    expect(contexts).toHaveBeenCalledTimes(2);
    gate.resolve(undefined);
    await job;
    expect(contexts).toHaveBeenCalledTimes(4);
  });
  it.each(['top-only', 'iop-only', 'dual'])(
    'resolves SKU inventory and order aggregate routes from their actual payloads with %s',
    async (configuration) => {
      const gateway: GatewayClient = new MockGatewayClient(0);
      const upload = {
        identity: 'account',
        gateway: configuration === 'top-only' ? 'top' : 'iop',
        storage: null
      };
      const read = { ...upload, gateway: configuration === 'iop-only' ? 'iop' : 'top' };
      const context = vi
        .spyOn(gateway, 'galleryTransferContext')
        .mockImplementation((operation) => Promise.resolve(operation ? read : upload));
      const request = vi.spyOn(gateway, 'request');
      const identity = await pageDetailIdentity(gateway, 'extension');
      const inventory = { kind: 'inventory', id: '10000001', source: 'sku' } as const;
      await requestPageDetail(gateway, 'extension', 'en_US', inventory, identity);
      expect(context).toHaveBeenCalledWith('getProductInventory', {
        productId: inventory.id,
        source: 'sku',
        language: 'en_US'
      });
      expect(request).toHaveBeenLastCalledWith('getProductInventory', expect.anything(), {
        galleryContext: read
      });
      await requestPageDetail(
        gateway,
        'extension',
        'en_US',
        { kind: 'order', order: iopDetailFixture.ready.order },
        identity
      );
      expect(context).toHaveBeenCalledWith('getTradeOrderAggregate', {
        order: iopDetailFixture.ready.order,
        language: 'en_US'
      });
      expect(request).toHaveBeenLastCalledWith('getTradeOrderAggregate', expect.anything(), {
        galleryContext: read
      });
    }
  );
  it('isolates cached details by read context and rejects removed contexts without fallback', async () => {
    const gateway: GatewayClient = new MockGatewayClient(0);
    const upload = { identity: 'account', gateway: 'iop', storage: null };
    let route = 'top-one';
    vi.spyOn(gateway, 'galleryTransferContext').mockImplementation((operation) => {
      if (operation && route === 'removed') throw new Error('GALLERY_CONTEXT_UNAVAILABLE');
      return Promise.resolve(operation ? { ...upload, gateway: route } : upload);
    });
    const request = vi.spyOn(gateway, 'request');
    const input = { kind: 'score', id: '10000001' } as const;
    await requestPageDetail(gateway, 'extension', 'en_US', input);
    await requestPageDetail(gateway, 'extension', 'en_US', input);
    expect(request).toHaveBeenCalledTimes(1);
    route = 'top-two';
    await requestPageDetail(gateway, 'extension', 'en_US', input);
    expect(request).toHaveBeenCalledTimes(2);
    route = 'removed';
    await expect(requestPageDetail(gateway, 'extension', 'en_US', input)).rejects.toThrow(
      'GALLERY_CONTEXT_UNAVAILABLE'
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(['page', 'read'])('discards late details when the %s context changes', async (changed) => {
    const gateway: GatewayClient = new MockGatewayClient(0);
    const root = { identity: 'account', gateway: 'iop', storage: null };
    let stale = false;
    vi.spyOn(gateway, 'galleryTransferContext').mockImplementation((operation) =>
      Promise.resolve({
        ...root,
        gateway: operation
          ? stale && changed === 'read'
            ? 'top-new'
            : 'top'
          : stale && changed === 'page'
            ? 'iop-new'
            : 'iop'
      })
    );
    const request = vi.spyOn(gateway, 'request').mockImplementation(() => {
      stale = true;
      return Promise.resolve({ productId: '10000001', score: 4, issues: [] });
    });
    await expect(
      requestPageDetail(gateway, 'extension', 'en_US', { kind: 'score', id: '10000001' })
    ).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(request).toHaveBeenCalledOnce();
  });
  it('rejects changed credentials before networking and isolates languages', async () => {
    const gateway = new MockGatewayClient(0);
    const context = await gateway.galleryTransferContext();
    const identity = JSON.stringify([context.identity, context.gateway]);
    const spy = vi.spyOn(gateway, 'request');
    vi.spyOn(gateway, 'galleryTransferContext').mockResolvedValue({ ...context, gateway: 'new-account' });
    await expect(
      requestPageDetail(gateway, 'extension', 'en_US', { kind: 'score', id: 'one' }, identity)
    ).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
    expect(spy).not.toHaveBeenCalled();
    await requestPageDetail(gateway, 'extension', 'en_US', { kind: 'score', id: 'one' });
    await requestPageDetail(gateway, 'extension', 'zh_CN', { kind: 'score', id: 'one' });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('rejects a response when the account changed in flight', async () => {
    const gateway = new MockGatewayClient(0);
    const context = await gateway.galleryTransferContext();
    vi.spyOn(gateway, 'galleryTransferContext')
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce(context)
      .mockResolvedValue({ ...context, identity: 'different-user' });
    await expect(
      requestPageDetail(gateway, 'extension', 'en_US', { kind: 'score', id: 'one' })
    ).rejects.toThrow('GALLERY_CONTEXT_CHANGED');
  });
  it('deduplicates requests and expires the scoped cache after five minutes', async () => {
    vi.useFakeTimers();
    const gateway = new MockGatewayClient(0);
    const spy = vi.spyOn(gateway, 'request');
    const request = { kind: 'score', id: 'product-1' } as const;
    const first = requestPageDetail(gateway, 'mock', 'en_US', request);
    const second = requestPageDetail(gateway, 'mock', 'en_US', request);
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(spy).toHaveBeenCalledTimes(1);
    await requestPageDetail(gateway, 'mock', 'en_US', request);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_001);
    const third = requestPageDetail(gateway, 'mock', 'en_US', request);
    await vi.runAllTimersAsync();
    await third;
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('shares valid IOP detail without requiring unavailable TOP fund data, but does not cache detail errors', async () => {
    const gateway = new MockGatewayClient(0);
    const order = {
      id: 'fixture-order',
      buyerLoginId: null,
      status: 'unknown',
      amount: null,
      currency: null,
      createdAt: null,
      modifiedAt: null
    };
    const aggregate = {
      order,
      fund: null,
      logistics: { orderId: order.id, status: 'WAIT_SHIP', carrier: null, trackingNumber: null },
      publicDetail: {
        source: 'iop-public' as const,
        orderId: order.id,
        status: null,
        buyerName: null,
        totalAmount: null,
        products: null
      },
      availability: {
        order: 'available' as const,
        fund: 'unavailable' as const,
        logistics: 'available' as const,
        fullDetail: 'jushita-only' as const
      }
    };
    const spy = vi.spyOn(gateway, 'request').mockResolvedValue(aggregate);
    const request = { kind: 'order' as const, order };
    await requestPageDetail(gateway, 'extension', 'zh_CN', request);
    await requestPageDetail(gateway, 'extension', 'zh_CN', request);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      'getTradeOrderAggregate',
      { order, language: 'zh_CN' },
      expect.anything()
    );
    spy.mockResolvedValue({
      ...aggregate,
      publicDetail: null,
      publicDetailError: { code: 'ALIBABA_IOP_API_REJECTED', message: 'Permission denied', retryable: false }
    });
    await requestPageDetail(gateway, 'extension', 'en_US', request);
    await requestPageDetail(gateway, 'extension', 'en_US', request);
    expect(spy).toHaveBeenCalledTimes(3);
  });
  it('does not send a request until manually started; discards late results after a page change', async () => {
    let resolve: ((value: { productId: string; score: number; issues: string[] }) => void) | undefined;
    const query = vi.fn(
      () =>
        new Promise<{ productId: string; score: number; issues: string[] }>((done) => {
          resolve = done;
        })
    );
    const accept = vi.fn();
    const boundary = ref('page-1');
    const scope = effectScope();
    const service = scope.run(() =>
      usePageDetails(ref([{ id: 'one' }, { id: 'two' }]), boundary, (row) => row.id, query, accept)
    );
    expect(query).not.toHaveBeenCalled();
    const promise = service?.load();
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    boundary.value = 'page-2';
    await nextTick();
    resolve?.({ productId: 'one', score: 4, issues: [] });
    await promise;
    expect(accept).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    scope.stop();
  });
  it('stops scheduling on permission failure and retries only failed rows', async () => {
    const query = vi
      .fn()
      .mockRejectedValue(
        new GatewayException({ code: 'PERMISSION_DENIED', message: 'Access unavailable', retryable: false })
      );
    const scope = effectScope();
    const service = scope.run(() =>
      usePageDetails(ref([{ id: 'one' }, { id: 'two' }]), ref('page'), (row) => row.id, query, vi.fn())
    );
    await service?.load();
    expect(query).toHaveBeenCalledTimes(1);
    expect(service?.states.value).toEqual({ one: 'failed' });
    query.mockResolvedValue({ productId: 'one', score: 4, issues: [] });
    await service?.load(true);
    expect(query).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('isolates both in-flight order details and cached results by role, defaulting omitted role to seller', async () => {
    const gateway = new MockGatewayClient(0);
    const waiting = Promise.withResolvers<TradeOrderAggregate>();
    const base = structuredClone(iopDetailFixture.ready) as TradeOrderAggregate;
    const sales = { ...base, order: { ...base.order, role: 'seller' as const } };
    const purchase = { ...base, order: { ...base.order, role: 'buyer' as const } };
    const request = vi
      .spyOn(gateway, 'request')
      .mockImplementationOnce(() => waiting.promise)
      .mockResolvedValueOnce(purchase);
    const sellerJob = requestPageDetail(gateway, 'mock', 'en_US', { kind: 'order', order: sales.order });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    const buyerJob = requestPageDetail(gateway, 'mock', 'en_US', { kind: 'order', order: purchase.order });
    expect(await buyerJob).toEqual(purchase);
    expect(request).toHaveBeenCalledTimes(2);
    waiting.resolve(sales);
    expect(await sellerJob).toEqual(sales);
    expect(
      await requestPageDetail(gateway, 'mock', 'en_US', { kind: 'order', order: purchase.order })
    ).toEqual(purchase);
    expect(
      await requestPageDetail(gateway, 'mock', 'en_US', {
        kind: 'order',
        order: iopDetailFixture.ready.order
      })
    ).toEqual(sales);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toEqual({ order: purchase.order, language: 'en_US' });
  });

  it('clears expanded states on role changes and drops late same-ID results', async () => {
    const waiting = Promise.withResolvers<TradeOrderAggregate>();
    const scope = effectScope();
    const role = ref('seller');
    const accept = vi.fn();
    const query = vi.fn(() => waiting.promise);
    const service = scope.run(() =>
      usePageDetails(ref([iopDetailFixture.ready.order]), role, (row) => row.id, query, accept)
    );
    const job = service?.load();
    await Promise.resolve();
    expect(service?.states.value).toEqual({ [iopDetailFixture.ready.order.id]: 'loading' });
    role.value = 'buyer';
    await nextTick();
    expect(service?.states.value).toEqual({});
    waiting.resolve(structuredClone(iopDetailFixture.ready) as TradeOrderAggregate);
    expect(await job).toBeNull();
    expect(accept).not.toHaveBeenCalled();
    expect(service?.errors.value).toEqual({});
    scope.stop();
  });
});
