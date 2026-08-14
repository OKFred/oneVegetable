import { describe, expect, it } from 'vitest';

import { createRequestId, getCapabilityDefinition } from '@one-vegetable/core';
import {
  createDocumentationReplayGateway,
  DocumentationReplayTransport,
  documentationReplayStatus
} from '../src/gateway/documentation-replay';

const method = 'alibaba.icbu.product.list';
const parameters = getCapabilityDefinition(method)?.requestExample as Record<string, unknown>;

describe('Alibaba documentation replay', () => {
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
