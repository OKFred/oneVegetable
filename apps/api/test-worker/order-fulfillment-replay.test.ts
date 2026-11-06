import { afterEach, expect, it, vi } from 'vitest';
import { getCapabilityDefinition } from '@one-vegetable/core';
import { FULFILLMENT_READ_METHODS } from '@one-vegetable/core/order-fulfillment-methods';
import { createDocumentationReplayGateway } from '../src/gateway/documentation-replay';

afterEach(() => vi.restoreAllMocks());

it.each(Object.values(FULFILLMENT_READ_METHODS))(
  'replays native fulfillment without a real network request: %s',
  async (method) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('REPLAY_MUST_NOT_FETCH'));
    const definition = getCapabilityDefinition(method);
    if (!definition) throw new Error('Missing fulfillment definition');
    const gateway = createDocumentationReplayGateway();
    const payload = { method, parameters: definition.requestExample };
    expect(await gateway.operationProtocol('callCapability', payload)).toBe('iop');
    const top = await gateway.galleryGatewayContextId();
    const native = await gateway.operationGatewayContextId('callCapability', payload);
    expect(native).not.toBe(top);
    await expect(gateway.request('callCapability', payload)).resolves.toMatchObject({
      method,
      contractValid: true,
      data: definition.responseExample
    });
    await expect(
      gateway.request('callCapability', payload, {
        requestId: crypto.randomUUID(),
        galleryContext: { identity: 'owner', gateway: top, storage: null }
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'GALLERY_CONTEXT_CHANGED' } });
    expect(fetch).not.toHaveBeenCalled();
  }
);
