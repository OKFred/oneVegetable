import { GatewayException } from './errors';
/** Only constructed after an explicit provider business rejection, never for transport errors. */
export class ProductMutationRejectedError extends GatewayException {}

/** Failure to receive a response is not evidence that a product was not changed. */
export function productUpdateFailureStatus(error: unknown): 'failed' | 'recovery-required' {
  if (error instanceof ProductMutationRejectedError) return 'failed';
  if (!(error instanceof GatewayException)) return 'recovery-required';
  const { code, subCode } = error.gatewayError;
  const rejected = new Set([
    'REQUEST_CONTRACT_INVALID',
    'INVALID_OPERATION_PAYLOAD',
    'REAL_MUTATION_DISABLED',
    'AUTH_REQUIRED',
    'AUTHENTICATION_FAILED',
    'PERMISSION_DENIED',
    'CSRF_INVALID',
    'PRODUCT_CONTEXT_INVALID',
    'PRODUCT_CONTEXT_CHANGED',
    'HOST_PERMISSION_DENIED',
    'PRODUCT_UPDATE_REJECTED',
    'NETWORK_ORIGIN_DENIED',
    'REQUEST_TOO_LARGE'
  ]);
  if (rejected.has(code)) return 'failed';
  const platformCode = `${code};${subCode ?? ''}`;
  return /(?:isv\.(?:invalid-parameter|missing-parameter|permission|invalid-session|invalid-signature)|PUB_BIZCHECK_)/iu.test(
    platformCode
  )
    ? 'failed'
    : 'recovery-required';
}
