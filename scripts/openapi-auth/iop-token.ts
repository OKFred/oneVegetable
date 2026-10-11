import { createHmac } from 'node:crypto';
import { NetworkManager, type NetworkTransport } from '../../packages/core/src/network';
import { parseAlibabaTokenResponse } from '../../packages/core/src/alibaba-credential-bundle';
import type { AlibabaTokenResponse } from '../../packages/core/src/alibaba-credential-bundle';
import {
  hasTokenError,
  parseTokenBody,
  tokenRefreshFailure
} from '../../apps/api/src/gateway/token-refresh-error';

export const IOP_AUTHORIZE_ENDPOINT = 'https://openapi-auth.alibaba.com/oauth/authorize';
const IOP_ENDPOINT = 'https://openapi-api.alibaba.com/rest';
export function signIopParameters(
  path: '/auth/token/create' | '/auth/token/refresh' | '/alibaba/icbu/product/list',
  parameters: Record<string, string>,
  secret: string
): string {
  const text =
    path +
    Object.keys(parameters)
      .filter((key) => key !== 'sign')
      .sort()
      .map((key) => key + (parameters[key] ?? ''))
      .join('');
  return createHmac('sha256', secret).update(text).digest('hex').toUpperCase();
}
export async function createIopToken(
  input: { appKey: string; appSecret: string; code: string },
  options: { transport?: NetworkTransport; clock?: () => number; requestId?: string } = {}
): Promise<AlibabaTokenResponse> {
  const path = '/auth/token/create';
  const parameters = {
    app_key: input.appKey,
    timestamp: String((options.clock ?? Date.now)()),
    sign_method: 'sha256',
    simplify: 'true',
    code: input.code
  };
  const network = new NetworkManager({
    ...(options.transport ? { transport: options.transport } : {}),
    policies: {
      alibaba: {
        allowedOrigins: [new URL(IOP_ENDPOINT).origin],
        maxRequestBytes: 16_384,
        maxResponseBytes: 65_536,
        timeoutMilliseconds: 30_000,
        redirect: 'error'
      }
    }
  });
  const response = await network.request({
    service: 'alibaba',
    url: IOP_ENDPOINT + path,
    requestId: options.requestId ?? crypto.randomUUID(),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ ...parameters, sign: signIopParameters(path, parameters, input.appSecret) }),
    responseType: 'text',
    maxAttempts: 1
  });
  const value = parseTokenBody(response.data);
  if (
    !response.ok ||
    hasTokenError(value) ||
    typeof value !== 'object' ||
    value === null ||
    !('code' in value) ||
    (value.code !== '0' && value.code !== 0)
  )
    throw tokenRefreshFailure(response.status, value, [input.appKey, input.appSecret, input.code]);
  return parseAlibabaTokenResponse(value);
}
