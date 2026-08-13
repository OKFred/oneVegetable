import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { AlibabaClient } from '../src/alibaba-client';
import { GatewayException, normalizeGatewayError } from '../src/errors';

const credentials = {
  appKey: 'key',
  appSecret: 'secret',
  accessToken: 'token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};

describe('AlibabaClient retry policy', () => {
  it('retries retryable reads with bounded exponential delays', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValueOnce({ data: { result: true } });
    const wait = vi.fn(() => Promise.resolve());
    const client = new AlibabaClient(credentials, { post } as unknown as AxiosInstance, {
      maxAttempts: 3,
      shouldRetry: () => true,
      wait
    });

    await expect(client.call('alibaba.icbu.product.list', {})).resolves.toMatchObject({
      data: { result: true }
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[250], [500]]);
  });

  it('never retries when the caller marks a mutation unsafe', async () => {
    const post = vi.fn().mockRejectedValue(axiosError(503));
    const client = new AlibabaClient(credentials, { post } as unknown as AxiosInstance, {
      maxAttempts: 3,
      shouldRetry: () => false,
      wait: () => Promise.resolve()
    });

    await expect(client.call('alibaba.icbu.product.schema.add', {})).rejects.toMatchObject({
      gatewayError: { code: 'UPSTREAM_UNAVAILABLE', retryable: true }
    });
    expect(post).toHaveBeenCalledOnce();
  });
});

describe('gateway transport error categories', () => {
  it.each([
    [401, 'AUTHENTICATION_FAILED', false],
    [403, 'PERMISSION_DENIED', false],
    [429, 'RATE_LIMITED', true],
    [503, 'UPSTREAM_UNAVAILABLE', true]
  ] as const)('maps HTTP %s to %s', (status, code, retryable) => {
    expect(normalizeGatewayError(axiosError(status))).toMatchObject({ code, retryable });
  });

  it('maps client timeouts separately from generic network failures', () => {
    expect(normalizeGatewayError(axiosError(undefined, 'ETIMEDOUT'))).toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: true
    });
  });

  it('keeps GatewayException payloads intact', () => {
    const error = new GatewayException({ code: 'CUSTOM', message: 'custom', retryable: false });
    expect(normalizeGatewayError(error)).toEqual(error.gatewayError);
  });
});

function axiosError(status?: number, code?: string): object {
  return {
    isAxiosError: true,
    code,
    message: status ? `HTTP ${status}` : 'timeout',
    ...(status ? { response: { status, data: {} } } : {})
  };
}
