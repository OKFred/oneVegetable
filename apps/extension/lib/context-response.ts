import { GatewayException } from '@one-vegetable/core/errors';

export function readContextResponse(
  value: unknown,
  requestId: string,
  unavailable: 'PRODUCT_CONTEXT_UNAVAILABLE' | 'GALLERY_CONTEXT_UNAVAILABLE'
): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'requestId' in value &&
    value.requestId === requestId &&
    'ok' in value
  ) {
    if (value.ok === true && 'data' in value) return value.data;
    if (value.ok === false && 'error' in value) {
      const error = value.error;
      if (
        typeof error === 'object' &&
        error !== null &&
        !Array.isArray(error) &&
        'code' in error &&
        typeof error.code === 'string' &&
        'message' in error &&
        typeof error.message === 'string' &&
        'retryable' in error &&
        typeof error.retryable === 'boolean'
      ) {
        throw new GatewayException(
          {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...('traceId' in error && typeof error.traceId === 'string' ? { traceId: error.traceId } : {})
          },
          requestId
        );
      }
    }
  }
  throw new Error(unavailable);
}
