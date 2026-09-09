// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { GatewayException } from '@one-vegetable/core';
import { requestPageDetail, usePageDetails } from '../src/lib/page-details';

describe('page details', () => {
  afterEach(() => vi.useRealTimers());
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
});
