import { AlibabaIopTokenClient, IOP_API_ORIGIN } from '@one-vegetable/core/alibaba-iop';
import { GatewayException } from '@one-vegetable/core/errors';
import { NetworkManager } from '@one-vegetable/core/network';
import { parseAlibabaTokenResponse, type AlibabaTokenResponse } from '@one-vegetable/core/credential-bundle';
import type { AlibabaAuthorizationsSummary, GatewayCredentialSettings } from '@one-vegetable/core';

export const AUTHORIZATION_REFRESH_INTENTS_KEY = 'one-vegetable-authorization-refresh-intents-v1';
export const TOP_TOKEN_ORIGIN = 'https://oauth.alibaba.com';

/** Expose only a per-profile unknown-result flag, never persisted intent keys or values. */
export function applyAuthorizationRefreshState(
  summary: AlibabaAuthorizationsSummary,
  intents: unknown
): AlibabaAuthorizationsSummary {
  const invalid = intents !== undefined && !isRecord(intents);
  const records = isRecord(intents) ? intents : {};
  const apply = (profile: AlibabaAuthorizationsSummary['top']) =>
    profile?.configurationId && (invalid || Object.hasOwn(records, profile.configurationId))
      ? { ...profile, canRefresh: false, lastRefreshErrorCode: 'AUTH_REFRESH_RESULT_UNKNOWN' }
      : profile;
  return { ...summary, top: apply(summary.top), iop: apply(summary.iop) };
}

interface RefreshStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** A persisted send intent prevents worker restart or persistence failure from reusing a rotated token. */
export async function refreshAuthorizationProfile(
  profile: GatewayCredentialSettings,
  storage: RefreshStorage,
  permission: (origins: string[]) => Promise<boolean>,
  commit: (next: GatewayCredentialSettings) => Promise<void>,
  client = new AlibabaIopTokenClient(),
  clock = Date.now,
  topNetwork?: NetworkManager
): Promise<void> {
  const fail = (code: string, message = code): never => {
    throw new GatewayException({ code, message, retryable: false });
  };
  const protocol = profile.protocol ?? 'top';
  const id = profile.configurationId;
  const refreshToken = profile.refreshToken;
  if (!id) return fail('ALIBABA_CONFIGURATION_ID_INVALID');
  if (!refreshToken)
    return fail(
      'ALIBABA_REFRESH_TOKEN_MISSING',
      `This ${protocol.toUpperCase()} authorization has no Refresh Token. Re-import a bundle containing a Refresh Token, or re-authorize this protocol.`
    );
  if (profile.refreshTokenExpiresTimeUtc != null && profile.refreshTokenExpiresTimeUtc <= clock())
    fail('AUTH_REFRESH_EXPIRED');
  if (!(await permission([`${protocol === 'iop' ? IOP_API_ORIGIN : TOP_TOKEN_ORIGIN}/*`])))
    fail('AUTH_PERMISSION_REQUIRED');
  const stored = (await storage.get(AUTHORIZATION_REFRESH_INTENTS_KEY))[AUTHORIZATION_REFRESH_INTENTS_KEY];
  if (stored !== undefined && (stored === null || typeof stored !== 'object' || Array.isArray(stored)))
    fail('AUTH_REFRESH_RESULT_UNKNOWN');
  const intents: Record<string, unknown> = stored ? Object.fromEntries(Object.entries(stored)) : {};
  if (Object.hasOwn(intents, id)) fail('AUTH_REFRESH_RESULT_UNKNOWN');
  const requestId = crypto.randomUUID();
  await storage.set({
    [AUTHORIZATION_REFRESH_INTENTS_KEY]: { ...intents, [id]: { requestId, status: 'sending' } }
  });
  try {
    const token =
      protocol === 'iop'
        ? await client.request('/auth/token/refresh', {
            appKey: profile.appKey,
            appSecret: profile.appSecret,
            value: refreshToken,
            requestId
          })
        : await refreshTopToken(profile, refreshToken, requestId, topNetwork);
    const captured = clock();
    const expiry = (seconds: number | null) => (seconds === null ? null : captured + seconds * 1000);
    await commit({
      ...profile,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? profile.refreshToken ?? null,
      accessTokenCapturedTimeUtc: captured,
      accessTokenExpiresTimeUtc: expiry(token.expiresInSeconds),
      refreshTokenExpiresTimeUtc:
        token.refreshExpiresInSeconds === null
          ? (profile.refreshTokenExpiresTimeUtc ?? null)
          : expiry(token.refreshExpiresInSeconds)
    });
    await storage.set({ [AUTHORIZATION_REFRESH_INTENTS_KEY]: intents });
  } catch (error) {
    if (
      error instanceof GatewayException &&
      ['IOP_TOKEN_REJECTED', 'TOP_TOKEN_REJECTED'].includes(error.gatewayError.code)
    ) {
      await storage.set({ [AUTHORIZATION_REFRESH_INTENTS_KEY]: intents });
      fail(error.gatewayError.code);
    }
    // Never surface provider responses or secret-bearing storage/client errors.
    fail('AUTH_REFRESH_RESULT_UNKNOWN');
  }
}

async function refreshTopToken(
  profile: GatewayCredentialSettings,
  refreshToken: string,
  requestId: string,
  network = new NetworkManager({
    policies: {
      alibaba: {
        allowedOrigins: [TOP_TOKEN_ORIGIN],
        timeoutMilliseconds: 30_000,
        maxRequestBytes: 16_384,
        maxResponseBytes: 65_536,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store'
      }
    }
  })
): Promise<AlibabaTokenResponse> {
  const response = await network.request({
    service: 'alibaba',
    url: `${TOP_TOKEN_ORIGIN}/token`,
    requestId,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: profile.appKey,
      client_secret: profile.appSecret,
      sp: 'icbu'
    }),
    responseType: 'text',
    maxAttempts: 1
  });
  const value: unknown = JSON.parse(String(response.data));
  if (response.status >= 500 || !isRecord(value)) throw new Error('TOP_TOKEN_RESULT_UNKNOWN');
  const errorCode = value.error_code ?? value.errorCode;
  if (
    !response.ok ||
    (typeof value.error === 'string' && value.error.trim()) ||
    isRecord(value.error_response) ||
    (errorCode !== undefined &&
      errorCode !== null &&
      errorCode !== '' &&
      errorCode !== 0 &&
      errorCode !== '0')
  )
    throw new GatewayException({
      code: 'TOP_TOKEN_REJECTED',
      message: 'TOP_TOKEN_REJECTED',
      retryable: false
    });
  return parseAlibabaTokenResponse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
