import type { APIRequestContext } from '@playwright/test';
import {
  credentialExpiryFromSeconds,
  parseAlibabaTokenResponse
} from '../../packages/core/src/alibaba-credential-bundle';

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
  input: { appKey: string; appSecret: string; code: string; redirectUri: string }
): Promise<AlibabaTokenResponse> {
  const response = await request.post(TOKEN_ENDPOINT, {
    form: {
      code: input.code,
      grant_type: 'authorization_code',
      client_id: input.appKey,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
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

export async function refreshAccessToken(
  request: APIRequestContext,
  input: { appKey: string; appSecret: string; refreshToken: string }
): Promise<AlibabaTokenResponse> {
  const response = await request.post(TOKEN_ENDPOINT, {
    form: {
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
      client_id: input.appKey,
      client_secret: input.appSecret,
      sp: 'icbu'
    },
    timeout: 30_000
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok()) {
    throw new OpenApiAuthError(
      'TOKEN_REFRESH_FAILED',
      `Token 刷新失败，Alibaba 返回 HTTP ${response.status()}；请重新运行 pnpm openapi:auth`
    );
  }
  return parseTokenResponse(body);
}

export function parseTokenResponse(value: unknown): AlibabaTokenResponse {
  try {
    return parseAlibabaTokenResponse(value);
  } catch {
    throw new OpenApiAuthError('TOKEN_RESPONSE_INVALID', 'Token 响应无效或缺少 access token，请重新授权');
  }
}

export function expiryFromSeconds(now: Date, seconds: number | null): string | null {
  return credentialExpiryFromSeconds(now.getTime(), seconds);
}
