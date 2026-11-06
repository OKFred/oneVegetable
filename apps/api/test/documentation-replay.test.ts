import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestId, getCapabilityDefinition, NetworkManager } from '@one-vegetable/core';
import { IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';
import {
  FULFILLMENT_READ_METHODS,
  ORDER_ATTACHMENT_METHOD
} from '@one-vegetable/core/order-fulfillment-methods';
import {
  createDocumentationReplayGateway,
  DocumentationReplayTransport,
  documentationReplayStatus
} from '../src/gateway/documentation-replay';

const method = 'alibaba.icbu.product.list';
const parameters = getCapabilityDefinition(method)?.requestExample as Record<string, unknown>;
afterEach(() => vi.restoreAllMocks());

describe('Alibaba documentation replay', () => {
  it.each(Object.values(FULFILLMENT_READ_METHODS))(
    'keeps native fulfillment replay and context on IOP: %s',
    async (method) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('REPLAY_MUST_NOT_FETCH'));
      const top = vi.spyOn(DocumentationReplayTransport.prototype, 'send');
      const wire = vi.spyOn(NetworkManager.prototype, 'request');
      const definition = getCapabilityDefinition(method);
      if (!definition) throw new Error('Missing fulfillment definition');
      const gateway = createDocumentationReplayGateway();
      const payload = { method, parameters: definition.requestExample };
      expect(await gateway.operationProtocol('callCapability', payload)).toBe('iop');
      expect(await gateway.operationProtocol('getCapabilityDefinition', { method })).toBe('iop');
      const nativeContext = await gateway.operationGatewayContextId('callCapability', payload);
      const topContext = await gateway.galleryGatewayContextId();
      expect(nativeContext).not.toBe(topContext);
      await expect(gateway.request('callCapability', payload)).resolves.toMatchObject({
        method,
        contractValid: true,
        data: definition.responseExample
      });
      expect(wire).toHaveBeenCalledOnce();
      const request = wire.mock.calls[0]?.[0];
      if (!request || !(request.body instanceof URLSearchParams)) throw new Error('Missing native request');
      expect(String(request.url)).toBe(IOP_BUSINESS_ENDPOINT + method);
      expect(request.body.has('method')).toBe(false);
      expect(request.body.has('session')).toBe(false);
      await expect(
        gateway.request('callCapability', payload, {
          requestId: createRequestId(),
          galleryContext: { identity: 'owner', gateway: topContext, storage: null }
        })
      ).rejects.toMatchObject({ gatewayError: { code: 'GALLERY_CONTEXT_CHANGED' } });
      expect(wire).toHaveBeenCalledOnce();
      expect(top).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('does not add attachment mutations to the read-only replay allowlist', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('REPLAY_MUST_NOT_FETCH'));
    await expect(
      createDocumentationReplayGateway().request('callCapability', {
        method: ORDER_ATTACHMENT_METHOD,
        parameters: { file_name: 'fixture.png' }
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'REAL_MUTATION_DISABLED' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(Object.values(IOP_REFERENCE_METHODS))(
    'replays the native read example through its success normalizer: %s',
    async (nativeMethod) => {
      const definition = getCapabilityDefinition(nativeMethod);
      if (!definition) throw new Error('Missing native read definition');
      await expect(
        createDocumentationReplayGateway().request('callCapability', {
          method: nativeMethod,
          parameters: definition.requestExample
        })
      ).resolves.toMatchObject({ method: nativeMethod, contractValid: true });
    }
  );
  it('replays sanitized contract examples through signing and response validation', async () => {
    const requestId = createRequestId();
    const gateway = createDocumentationReplayGateway();
    await expect(
      gateway.request('callCapability', { method, parameters }, { requestId })
    ).resolves.toMatchObject({
      method,
      traceId: `replay-${requestId}`,
      contractValid: true,
      data: getCapabilityDefinition(method)?.responseExample
    });
    expect(documentationReplayStatus()).toMatchObject({
      source: 'documentation-replay',
      configured: false,
      hasAppSecret: false
    });
  });

  it('retries a simulated rate limit with the same requestId', async () => {
    const waits: number[] = [];
    const gateway = createDocumentationReplayGateway({
      fault: 'rate-limit-once',
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      }
    });
    await expect(
      gateway.request('callCapability', { method, parameters }, { requestId: createRequestId() })
    ).resolves.toMatchObject({ contractValid: true });
    expect(waits).toEqual([250]);
  });

  it('surfaces upstream outages and response contract drift deterministically', async () => {
    const unavailable = createDocumentationReplayGateway({
      fault: 'upstream-unavailable',
      wait: () => Promise.resolve()
    });
    await expect(
      unavailable.request('callCapability', { method, parameters }, { requestId: createRequestId() })
    ).rejects.toMatchObject({ gatewayError: { code: 'UPSTREAM_UNAVAILABLE', retryable: true } });

    const drift = createDocumentationReplayGateway({ fault: 'contract-drift' });
    await expect(
      drift.request('callCapability', { method, parameters }, { requestId: createRequestId() })
    ).resolves.toMatchObject({ contractValid: false, data: { replayUnexpected: true } });
  });

  it('rejects request bodies outside the fixed replay protocol', () => {
    const transport = new DocumentationReplayTransport();
    expect(() =>
      transport.send('https://evil.example/openapi', {
        method: 'POST',
        body: new URLSearchParams()
      })
    ).toThrow('固定 Alibaba 模拟端点');
  });
});
