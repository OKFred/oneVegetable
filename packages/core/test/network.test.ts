import { describe, expect, it, vi } from 'vitest';

import { describeUserVisibleError, GatewayException } from '../src/errors';
import {
  createRequestId,
  isRequestId,
  NativeFetchTransport,
  NetworkManager,
  type NetworkTransport
} from '../src/network';

const policies = {
  alibaba: { allowedOrigins: ['https://eco.taobao.com'], maxResponseBytes: 32 },
  bff: { allowedOrigins: ['https://api.example.com'], maxRequestBytes: 32 },
  'external-photo': { allowUrl: (url: URL) => url.hostname === 'images.example.com' }
} as const;

describe('NetworkManager', () => {
  it('invokes a browser-style native fetch with the global receiver', async () => {
    const receiverBoundFetch = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;

    const response = await new NativeFetchTransport(receiverBoundFetch).send(
      'https://api.example.com/healthz',
      { method: 'GET' }
    );

    expect(response.ok).toBe(true);
    expect(receiverBoundFetch).toHaveBeenCalledOnce();
  });

  it('generates and reuses one UUID v4 while retrying', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ retry: true }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const manager = createManager(send);
    const response = await manager.request({
      service: 'alibaba',
      url: 'https://eco.taobao.com/router/rest',
      responseType: 'json',
      maxAttempts: 2,
      retry: (result) => result.status === 503
    });

    expect(isRequestId(response.requestId)).toBe(true);
    expect(response.attempt).toBe(2);
    const first = send.mock.calls[0] as [RequestInfo | URL, RequestInit] | undefined;
    const second = send.mock.calls[1] as [RequestInfo | URL, RequestInit] | undefined;
    expect(new Headers(first?.[1].headers).get('X-Request-ID')).toBe(response.requestId);
    expect(new Headers(second?.[1].headers).get('X-Request-ID')).toBe(response.requestId);
  });

  it('rejects malformed request IDs and destinations outside the policy', async () => {
    const manager = createManager(vi.fn());
    await expect(
      manager.request({ service: 'bff', url: 'https://api.example.com/x', requestId: 'unsafe' })
    ).rejects.toMatchObject({ gatewayError: { code: 'INVALID_REQUEST_ID' } });
    const requestId = createRequestId();
    await expect(
      manager.request({ service: 'bff', url: 'https://evil.example/x', requestId })
    ).rejects.toMatchObject({ requestId, gatewayError: { code: 'NETWORK_URL_DENIED' } });
  });

  it('bounds request and response bodies', async () => {
    const manager = createManager(vi.fn().mockResolvedValue(new Response('x'.repeat(64))));
    await expect(
      manager.request({
        service: 'bff',
        url: 'https://api.example.com/x',
        method: 'POST',
        body: 'x'.repeat(64)
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'NETWORK_REQUEST_TOO_LARGE' } });
    await expect(
      manager.request({ service: 'alibaba', url: 'https://eco.taobao.com/router/rest' })
    ).rejects.toMatchObject({ gatewayError: { code: 'NETWORK_RESPONSE_TOO_LARGE' } });
  });

  it('preserves redirect error semantics with a Worker-compatible manual request', async () => {
    const send = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.example/redirected' }
      })
    );
    const manager = createManager(send);

    await expect(
      manager.request({ service: 'alibaba', url: 'https://eco.taobao.com/router/rest' })
    ).rejects.toMatchObject({ gatewayError: { code: 'NETWORK_REDIRECT_DENIED' } });

    const call = send.mock.calls[0] as [RequestInfo | URL, RequestInit] | undefined;
    expect(call?.[1].redirect).toBe('manual');
  });

  it('keeps GatewayException intact', () => {
    const requestId = createRequestId();
    const error = new GatewayException({ code: 'CUSTOM', message: 'custom', retryable: false }, requestId);
    expect(error.gatewayError.code).toBe('CUSTOM');
    expect(describeUserVisibleError(error)).toEqual({
      code: 'CUSTOM',
      message: 'custom',
      requestId,
      retryable: false,
      traceId: null
    });
  });

  it('attaches the reused requestId to transport failures', async () => {
    const requestId = createRequestId();
    const manager = createManager(vi.fn().mockRejectedValue(new TypeError('connection refused')));

    await expect(
      manager.request({ service: 'bff', url: 'https://api.example.com/x', requestId })
    ).rejects.toMatchObject({
      requestId,
      gatewayError: { code: 'GATEWAY_ERROR', message: 'connection refused' }
    });
  });
});

function createManager(send: ReturnType<typeof vi.fn>): NetworkManager {
  return new NetworkManager({
    transport: { send } as NetworkTransport,
    policies,
    wait: () => Promise.resolve()
  });
}
