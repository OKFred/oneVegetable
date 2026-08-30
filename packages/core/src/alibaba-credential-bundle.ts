export interface AlibabaOpenApiPermission {
  name: string;
  status: string;
}

export interface AlibabaOpenApiCredentialBundle {
  schemaVersion: 1;
  capturedAtUtc: string;
  application: {
    appName: string;
    appKey: string;
    appSecret: string;
    callbackUrl: string;
    status: string;
    permissions: AlibabaOpenApiPermission[];
  };
  oauth: {
    accessToken: string;
    refreshToken: string | null;
    expiresAtUtc: string | null;
    refreshExpiresAtUtc: string | null;
  };
  callback: {
    receivedAtUtc: string;
    stateMatched: true;
    callbackOrigin: string;
    callbackPath: string;
  };
}

export interface AlibabaTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  refreshExpiresInSeconds: number | null;
}

export interface AlibabaOpenApiCredentialBundleInput {
  capturedAtTimeUtc: number;
  application: {
    appName: string;
    appKey: string;
    appSecret: string;
    callbackUrl: string;
    status: string;
    permissions: AlibabaOpenApiPermission[];
  };
  token: AlibabaTokenResponse;
  receivedCallbackUrl: string;
}

export function createAlibabaOpenApiCredentialBundle(
  input: AlibabaOpenApiCredentialBundleInput
): AlibabaOpenApiCredentialBundle {
  const capturedAtUtc = new Date(input.capturedAtTimeUtc).toISOString();
  const callback = new URL(input.receivedCallbackUrl);
  return parseAlibabaOpenApiCredentialBundle({
    schemaVersion: 1,
    capturedAtUtc,
    application: {
      ...input.application,
      permissions: input.application.permissions.map((permission) => ({ ...permission }))
    },
    oauth: {
      accessToken: input.token.accessToken,
      refreshToken: input.token.refreshToken,
      expiresAtUtc: credentialExpiryFromSeconds(input.capturedAtTimeUtc, input.token.expiresInSeconds),
      refreshExpiresAtUtc: credentialExpiryFromSeconds(
        input.capturedAtTimeUtc,
        input.token.refreshExpiresInSeconds
      )
    },
    callback: {
      receivedAtUtc: capturedAtUtc,
      stateMatched: true,
      callbackOrigin: callback.origin,
      callbackPath: callback.pathname
    }
  });
}

export function parseAlibabaOpenApiCredentialBundle(value: unknown): AlibabaOpenApiCredentialBundle {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('Alibaba 授权包版本不受支持');
  const application = requiredRecord(value.application, 'application');
  const oauth = requiredRecord(value.oauth, 'oauth');
  const callback = requiredRecord(value.callback, 'callback');
  const permissions = application.permissions;
  if (
    !Array.isArray(permissions) ||
    permissions.length > 512 ||
    !permissions.every(
      (item) => isRecord(item) && validString(item.name, 512, true) && validString(item.status, 512, true)
    )
  ) {
    throw new Error('Alibaba 授权包 permissions 无效');
  }
  const bundle: AlibabaOpenApiCredentialBundle = {
    schemaVersion: 1,
    capturedAtUtc: requiredDate(value.capturedAtUtc, 'capturedAtUtc'),
    application: {
      appName: requiredString(application.appName, 'application.appName'),
      appKey: requiredSecret(application.appKey, 'application.appKey'),
      appSecret: requiredSecret(application.appSecret, 'application.appSecret'),
      callbackUrl: requiredHttpsUrl(application.callbackUrl, 'application.callbackUrl'),
      status: requiredString(application.status, 'application.status', true),
      permissions: permissions.map((item) => {
        const permission = requiredRecord(item, 'permission');
        return {
          name: requiredString(permission.name, 'permission.name', true),
          status: requiredString(permission.status, 'permission.status', true)
        };
      })
    },
    oauth: {
      accessToken: requiredSecret(oauth.accessToken, 'oauth.accessToken'),
      refreshToken: nullableSecret(oauth.refreshToken, 'oauth.refreshToken'),
      expiresAtUtc: nullableDate(oauth.expiresAtUtc, 'oauth.expiresAtUtc'),
      refreshExpiresAtUtc: nullableDate(oauth.refreshExpiresAtUtc, 'oauth.refreshExpiresAtUtc')
    },
    callback: {
      receivedAtUtc: requiredDate(callback.receivedAtUtc, 'callback.receivedAtUtc'),
      stateMatched: requiredState(callback.stateMatched),
      callbackOrigin: requiredOrigin(callback.callbackOrigin, 'callback.callbackOrigin'),
      callbackPath: requiredPath(callback.callbackPath, 'callback.callbackPath')
    }
  };
  return bundle;
}

export function isAlibabaOpenApiCredentialBundle(value: unknown): value is AlibabaOpenApiCredentialBundle {
  try {
    parseAlibabaOpenApiCredentialBundle(value);
    return true;
  } catch {
    return false;
  }
}

export function parseAlibabaTokenResponse(value: unknown): AlibabaTokenResponse {
  const record = requiredRecord(value, 'token response');
  return {
    accessToken: firstRequiredString(record, ['access_token', 'accessToken']),
    refreshToken: firstOptionalString(record, ['refresh_token', 'refreshToken']),
    expiresInSeconds: firstOptionalNumber(record, ['expires_in', 'expiresIn']),
    refreshExpiresInSeconds: firstOptionalNumber(record, [
      'refresh_token_timeout',
      'refresh_token_expires_in',
      'refreshExpiresIn'
    ])
  };
}

export function credentialExpiryFromSeconds(now: number, seconds: number | null): string | null {
  return seconds === null ? null : new Date(now + seconds * 1_000).toISOString();
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function requiredString(value: unknown, label: string, allowEmpty = false): string {
  if (!validString(value, 4096, allowEmpty)) throw new Error(`${label} 无效`);
  return value.trim();
}

function requiredSecret(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (/\s/u.test(result)) throw new Error(`${label} 不允许包含空白字符`);
  return result;
}

function nullableSecret(value: unknown, label: string): string | null {
  return value === null ? null : requiredSecret(value, label);
}

function requiredDate(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label} 不是有效时间`);
  return result;
}

function nullableDate(value: unknown, label: string): string | null {
  return value === null ? null : requiredDate(value, label);
}

function requiredHttpsUrl(value: unknown, label: string): string {
  const result = requiredString(value, label);
  const url = new URL(result);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${label} 必须是无凭据、无 fragment 的 HTTPS URL`);
  }
  return url.href;
}

function requiredOrigin(value: unknown, label: string): string {
  const result = requiredString(value, label);
  const url = new URL(result);
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) throw new Error(`${label} 无效`);
  return url.origin;
}

function requiredPath(value: unknown, label: string): string {
  const result = requiredString(value, label, true);
  if (!result.startsWith('/') || result.includes('?') || result.includes('#')) {
    throw new Error(`${label} 无效`);
  }
  return result;
}

function requiredState(value: unknown): true {
  if (value !== true) throw new Error('callback.stateMatched 必须为 true');
  return true;
}

function firstRequiredString(record: Record<string, unknown>, keys: readonly string[]): string {
  const value = firstOptionalString(record, keys);
  if (!value) throw new Error('Token 响应缺少 access token');
  return value;
}

function firstOptionalString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (validString(value, 4096, false)) return value.trim();
  }
  return null;
}

function firstOptionalNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function validString(value: unknown, maxLength: number, allowEmpty: boolean): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
