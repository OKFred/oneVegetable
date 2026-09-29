import { describe, expect, it } from 'vitest';
import { GatewayException } from '../src/errors';
import { productUpdateFailureStatus } from '../src/product-update-outcome';

describe('product update outcome evidence', () => {
  it.each([
    'NETWORK_ERROR',
    'INVALID_JSON_RESPONSE',
    'GATEWAY_ERROR',
    'UPSTREAM_UNAVAILABLE',
    'ALIBABA_PRODUCT_MUTATION_UNCONFIRMED'
  ])('does not treat %s as proof of rejection', (code) => {
    expect(productUpdateFailureStatus(new GatewayException({ code, message: code, retryable: false }))).toBe(
      'recovery-required'
    );
  });
  it.each([
    'REQUEST_CONTRACT_INVALID',
    'PRODUCT_CONTEXT_CHANGED',
    'isv.invalid-parameter',
    'isp.system-service-error:PUB_BIZCHECK_PRODUCT_IN_AUDITING'
  ])('recognizes confirmed rejection %s', (code) => {
    expect(productUpdateFailureStatus(new GatewayException({ code, message: code, retryable: false }))).toBe(
      'failed'
    );
  });
  it('treats arbitrary exceptions as uncertain even without a retryable hint', () => {
    expect(productUpdateFailureStatus(new Error('lost reply'))).toBe('recovery-required');
  });
});
