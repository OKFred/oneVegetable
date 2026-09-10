import { describe, expect, it } from 'vitest';

import { normalizeGatewayError, splitUserVisibleErrorMessages } from '../src/errors';

describe('user-visible errors', () => {
  it('classifies Node connection failures without leaking nested diagnostics', () => {
    const error = new TypeError('fetch failed', {
      cause: { code: 'ETIMEDOUT', message: 'secret-token', url: 'https://private.example/?token=secret' }
    });
    const normalized = normalizeGatewayError(error);
    expect(normalized).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(JSON.stringify(normalized)).not.toContain('secret');
  });
  it('does not turn arbitrary application errors into retryable network errors', () => {
    expect(normalizeGatewayError(new Error('invalid settings'))).toMatchObject({
      code: 'GATEWAY_ERROR',
      retryable: false
    });
  });
  it('splits and deduplicates Alibaba semicolon-separated reasons', () => {
    expect(
      splitUserVisibleErrorMessages(
        'Product title is required; Main image is required；Product title is required\nInvalid price'
      )
    ).toEqual(['Product title is required', 'Main image is required', 'Invalid price']);
  });

  it('keeps a normal single message intact', () => {
    expect(splitUserVisibleErrorMessages('Alibaba API 返回错误')).toEqual(['Alibaba API 返回错误']);
  });
});
