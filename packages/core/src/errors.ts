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

  if (isRecord(error) && typeof error.message === 'string') {
    return { code: 'GATEWAY_ERROR', message: error.message, retryable: false };
  }

  return { code: 'UNKNOWN_ERROR', message: '未知网关错误', retryable: false };
}

export function gatewayErrorRequestId(error: unknown): string | null {
  return error instanceof GatewayException ? error.requestId : null;
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
