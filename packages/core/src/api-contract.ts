import type { components } from './generated/api';
import type { GatewayError } from './types';

export const DEFAULT_API_PREFIX = '/api/v1';

export type RequestId = components['schemas']['RequestId'];
export type BackendMeta = components['schemas']['BackendMeta'];
export type ProbeResponse = components['schemas']['ProbeResponse'];

export type ApiResponse<T> =
  { requestId: RequestId; ok: true; data: T } | { requestId: RequestId; ok: false; error: GatewayError };

export function normalizeApiPrefix(value: string | undefined): string {
  const prefix = value ?? DEFAULT_API_PREFIX;
  if (
    !prefix.startsWith('/') ||
    prefix === '/' ||
    prefix.endsWith('/') ||
    prefix.includes('..') ||
    prefix.includes('//') ||
    prefix.includes('?') ||
    prefix.includes('#') ||
    /\s/.test(prefix)
  ) {
    throw new Error(`API prefix 无效：${prefix}`);
  }
  return prefix;
}
