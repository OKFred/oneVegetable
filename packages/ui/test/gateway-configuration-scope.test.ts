import { describe, expect, it, vi } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type { OperationMap } from '@one-vegetable/core';
import { createGatewayConfigurationScope } from '../src/lib/gateway-configuration-scope';

describe('credential configuration response isolation', () => {
  it('discards already-started old-account responses but allows subsequent requests', async () => {
    const original = new MockGatewayClient(0);
    const page = await original.request('listProducts', { page: 1, pageSize: 1 });
    const deferred = Promise.withResolvers<OperationMap['listProducts']['response']>();
    vi.spyOn(original, 'request').mockReturnValueOnce(deferred.promise);
    const scope = createGatewayConfigurationScope(original);
    const pending = scope.gateway.request('listProducts', { page: 1, pageSize: 1 });
    const rejected = expect(pending).rejects.toMatchObject({
      gatewayError: { code: 'GALLERY_CONTEXT_CHANGED', retryable: false }
    });
    scope.invalidate();
    deferred.resolve(page);
    await rejected;
    await expect(scope.gateway.request('listProducts', { page: 1, pageSize: 1 })).resolves.toEqual(page);
  });
});
