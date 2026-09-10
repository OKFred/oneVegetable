import type { GatewayError } from './types';

export class GatewayException extends Error {
  readonly gatewayError: GatewayError;
  readonly requestId: string | null;

  constructor(gatewayError: GatewayError, requestId: string | null = null) {
    super(gatewayError.message);
    this.name = 'GatewayException';
    this.gatewayError = gatewayError;
    this.requestId = requestId;
  }
}

export interface UserVisibleErrorDetails {
  code: string | null;
  message: string;
  requestId: string | null;
  retryable: boolean | null;
  traceId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayException) return error.gatewayError;

  if (hasConnectionFailure(error)) {
    return {
      code: 'NETWORK_ERROR',
      message: '网络连接失败，请检查网络后重新加载；写操作请先核对结果。',
      retryable: true
    };
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return { code: 'GATEWAY_ERROR', message: error.message, retryable: false };
  }

  return { code: 'UNKNOWN_ERROR', message: '未知网关错误', retryable: false };
}

export function gatewayErrorRequestId(error: unknown): string | null {
  return error instanceof GatewayException ? error.requestId : null;
}

// Inspect only known transport codes; never expose nested causes, URLs or credentials.
function hasConnectionFailure(error: unknown, depth = 0): boolean {
  if (depth > 4 || !isRecord(error)) return false;
  if (
    typeof error.code === 'string' &&
    [
      'ETIMEDOUT',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ECONNREFUSED',
      'ECONNRESET',
      'EAI_AGAIN',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET'
    ].includes(error.code)
  )
    return true;
  return hasConnectionFailure(error.cause, depth + 1);
}

export function withGatewayRequestId(error: unknown, requestId: string): GatewayException {
  if (error instanceof GatewayException) {
    return error.requestId === requestId ? error : new GatewayException(error.gatewayError, requestId);
  }
  return new GatewayException(normalizeGatewayError(error), requestId);
}

export function describeUserVisibleError(
  error: unknown,
  fallbackMessage = '操作失败'
): UserVisibleErrorDetails {
  if (error instanceof GatewayException) {
    return {
      code: error.gatewayError.code,
      message: error.gatewayError.message,
      requestId: error.requestId,
      retryable: error.gatewayError.retryable,
      traceId: error.gatewayError.traceId ?? null
    };
  }
  if (error instanceof Error) {
    return {
      code: null,
      message: error.message || fallbackMessage,
      requestId: null,
      retryable: null,
      traceId: null
    };
  }
  if (typeof error === 'string' && error.trim()) {
    return {
      code: null,
      message: error,
      requestId: null,
      retryable: null,
      traceId: null
    };
  }
  return {
    code: null,
    message: fallbackMessage,
    requestId: null,
    retryable: null,
    traceId: null
  };
}

export function splitUserVisibleErrorMessages(message: string): string[] {
  const parts = message
    .split(/(?:\r?\n|[;；])+/u)
    .map((part) => part.trim())
    .filter((part, index, values) => part !== '' && values.indexOf(part) === index);
  return parts.length > 0 ? parts : [message];
}
