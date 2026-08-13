import type { GatewayError } from './types';

export class GatewayException extends Error {
  readonly gatewayError: GatewayError;

  constructor(gatewayError: GatewayError) {
    super(gatewayError.message);
    this.name = 'GatewayException';
    this.gatewayError = gatewayError;
  }
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
