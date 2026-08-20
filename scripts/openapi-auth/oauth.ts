import type { APIRequestContext } from '@playwright/test';

import { OpenApiAuthError } from './storage';
import type { AlibabaTokenResponse } from './types';

const TOKEN_ENDPOINT = 'https://oauth.alibaba.com/token';

export function validateCallback(callbackUrl: URL, expectedState: string): string {
  const oauthError = callbackUrl.searchParams.get('error');
  if (oauthError) {
    throw new OpenApiAuthError('OAUTH_PROVIDER_ERROR', `OAuth 返回错误：${oauthError}`);
  }
  const state = callbackUrl.searchParams.get('state');
  if (state !== expectedState) {
    throw new OpenApiAuthError('OAUTH_STATE_MISMATCH', 'OAuth Callback state 不匹配');
  }
  const code = callbackUrl.searchParams.get('code');
  if (!code) throw new OpenApiAuthError('OAUTH_CODE_MISSING', 'OAuth Callback 缺少 code');
  return code;
}

export async function exchangeAuthorizationCode(
  request: APIRequestContext,
  input: { appKey: string; appSecret: string; code: string }
): Promise<AlibabaTokenResponse> {
  const response = await request.post(TOKEN_ENDPOINT, {
    form: {
      code: input.code,
      grant_type: 'authorization_code',
      client_id: input.appKey,
      client_secret: input.appSecret,
      sp: 'icbu'
    },
    timeout: 30_000
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok()) {
    throw new OpenApiAuthError(
      'TOKEN_EXCHANGE_FAILED',
      `Token 交换失败，Alibaba 返回 HTTP ${response.status()}`
    );
  }
  return parseTokenResponse(body);
}

export function parseTokenResponse(value: unknown): AlibabaTokenResponse {
  const record = asRecord(value);
  const accessToken = requiredString(record, ['access_token', 'accessToken']);
  return {
    accessToken,
    refreshToken: optionalString(record, ['refresh_token', 'refreshToken']),
    expiresInSeconds: optionalNumber(record, ['expires_in', 'expiresIn']),
    refreshExpiresInSeconds: optionalNumber(record, [
      'refresh_token_timeout',
      'refresh_token_expires_in',
      'refreshExpiresIn'
    ])
  };
}

export function expiryFromSeconds(now: Date, seconds: number | null): string | null {
  if (seconds === null) return null;
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenApiAuthError('TOKEN_RESPONSE_INVALID', 'Token 响应不是对象');
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, keys: readonly string[]): string {
  const value = optionalString(record, keys);
  if (!value) throw new OpenApiAuthError('TOKEN_RESPONSE_INVALID', 'Token 响应缺少 access token');
  return value;
}

function optionalString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function optionalNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}
