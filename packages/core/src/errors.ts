import type { AxiosError } from 'axios';

import type { GatewayError } from './types';

interface AlibabaErrorResponse {
  error_response?: {
    code?: number;
    msg?: string;
    sub_code?: string;
    sub_msg?: string;
    request_id?: string;
  };
}

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

function isAxiosError(error: unknown): error is AxiosError<AlibabaErrorResponse> {
  return isRecord(error) && error.isAxiosError === true;
}

export function normalizeGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayException) return error.gatewayError;

  if (isAxiosError(error)) {
    const apiError = error.response?.data.error_response;
    return {
      code: apiError?.code ? String(apiError.code) : 'NETWORK_ERROR',
      message: apiError?.sub_msg ?? apiError?.msg ?? error.message,
      ...(apiError?.sub_code ? { subCode: apiError.sub_code } : {}),
      ...(apiError?.request_id ? { traceId: apiError.request_id } : {}),
      retryable: error.response === undefined || error.response.status >= 500
    };
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return { code: 'GATEWAY_ERROR', message: error.message, retryable: false };
  }

  return { code: 'UNKNOWN_ERROR', message: '未知网关错误', retryable: false };
}
