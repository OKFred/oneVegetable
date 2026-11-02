import { describe, expect, it } from 'vitest';
import { GatewayException } from '@one-vegetable/core/errors';
import { readContextResponse } from '../lib/context-response';

const requestId = 'context-request';
const error = {
  code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
  message: 'IOP required',
  retryable: false,
  traceId: 'trace'
};

describe('extension context responses', () => {
  it('returns successful data for context-specific validation', () => {
    const data = { gateway: 'opaque' };
    expect(readContextResponse({ requestId, ok: true, data }, requestId, 'GALLERY_CONTEXT_UNAVAILABLE')).toBe(
      data
    );
  });

  it.each(['PRODUCT_CONTEXT_UNAVAILABLE', 'GALLERY_CONTEXT_UNAVAILABLE'] as const)(
    'preserves correlated gateway denials instead of %s',
    (fallback) => {
      try {
        readContextResponse({ requestId, ok: false, error }, requestId, fallback);
        expect.unreachable('must reject');
      } catch (caught) {
        expect(caught).toBeInstanceOf(GatewayException);
        expect(caught).toMatchObject({ requestId, gatewayError: error });
      }
    }
  );

  it.each([
    null,
    [],
    {},
    { requestId: 'different', ok: false, error },
    { requestId, ok: false, error: { ...error, retryable: 'false' } },
    { requestId, ok: false, error: { ...error, code: null } },
    { requestId, ok: true },
    { requestId, ok: 'true', data: {} }
  ])('rejects malformed or mismatched responses: %j', (value) => {
    expect(() => readContextResponse(value, requestId, 'GALLERY_CONTEXT_UNAVAILABLE')).toThrow(
      'GALLERY_CONTEXT_UNAVAILABLE'
    );
  });
});
