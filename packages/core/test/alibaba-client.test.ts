import { describe, expect, it, vi } from 'vitest';

import { AlibabaClient } from '../src/alibaba-client';
import { GatewayException, normalizeGatewayError } from '../src/errors';
import { NetworkManager, type NetworkTransport } from '../src/network';

const credentials = {
  appKey: 'key',
  appSecret: 'secret',
  accessToken: 'token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};

describe('AlibabaClient retry policy', () => {
  it('retries retryable reads with bounded exponential delays', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ result: true }));
    const wait = vi.fn(() => Promise.resolve());
    const client = new AlibabaClient(credentials, network(send), {
      maxAttempts: 3,
      shouldRetry: () => true,
      wait
    });

    await expect(client.call('alibaba.icbu.product.list', {})).resolves.toMatchObject({
      data: { result: true }
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[250], [500]]);
  });

  it('never retries when the caller marks a mutation unsafe', async () => {
    const send = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
    const client = new AlibabaClient(credentials, network(send), {
      maxAttempts: 3,
      shouldRetry: () => false,
      wait: () => Promise.resolve()
    });

    await expect(client.call('alibaba.icbu.product.schema.add', {})).rejects.toMatchObject({
      gatewayError: { code: 'UPSTREAM_UNAVAILABLE', retryable: true }
    });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('gateway transport error categories', () => {
  it('maps client timeouts separately from generic network failures', () => {
    const error = new GatewayException({
      code: 'REQUEST_TIMEOUT',
      message: 'timeout',
      retryable: true
    });
    expect(normalizeGatewayError(error)).toMatchObject({ code: 'REQUEST_TIMEOUT', retryable: true });
  });

  it('keeps GatewayException payloads intact', () => {
    const error = new GatewayException({ code: 'CUSTOM', message: 'custom', retryable: false });
    expect(normalizeGatewayError(error)).toEqual(error.gatewayError);
  });
});

function network(send: ReturnType<typeof vi.fn>): NetworkManager {
  return new NetworkManager({
    transport: { send } as NetworkTransport,
    policies: {
      alibaba: { allowedOrigins: ['https://eco.taobao.com'] },
      bff: { allowedOrigins: [] },
      'external-photo': { allowedOrigins: [] }
    }
  });
}
