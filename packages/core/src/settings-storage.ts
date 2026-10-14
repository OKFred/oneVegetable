import { ALIBABA_GATEWAY } from './signing';
import type { GatewayCredentialSettings, GatewaySettings, SignMethod } from './types';

export const SETTINGS_STORAGE_KEY = 'gatewaySettings';
export const SETTINGS_SCHEMA_VERSION = 1;

export interface SettingsMigrationResult {
  settings: GatewaySettings;
  persistedValue: { version: typeof SETTINGS_SCHEMA_VERSION; settings: GatewaySettings };
  migrated: boolean;
}

const DEFAULT_SETTINGS: GatewaySettings = {
  appKey: '',
  appSecret: '',
  accessToken: '',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac'
};

export function migrateGatewaySettings(value: unknown): SettingsMigrationResult {
  const record = asRecord(value);
  const current = record.version === SETTINGS_SCHEMA_VERSION ? asRecord(record.settings) : record;
  const settings: GatewaySettings = {
    ...gatewayProtocolMetadata(current),
    appKey: stringValue(current.appKey),
    appSecret: stringValue(current.appSecret),
    accessToken: stringValue(current.accessToken),
    ...gatewayCredentialExpiryMetadata(current),
    ...gatewayCredentialIdentityMetadata(current),
    endpoint: stringValue(current.endpoint) || ALIBABA_GATEWAY,
    signMethod: signMethodValue(current.signMethod),
    ...gatewayAuthorizationMetadata(current)
  };
  return {
    settings,
    persistedValue: { version: SETTINGS_SCHEMA_VERSION, settings },
    migrated: record.version !== SETTINGS_SCHEMA_VERSION || !isCompleteSettings(record.settings)
  };
}

export function persistGatewaySettings(settings: GatewaySettings): SettingsMigrationResult['persistedValue'] {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    settings: {
      ...gatewayProtocolMetadata(settings),
      appKey: settings.appKey,
      appSecret: settings.appSecret,
      accessToken: settings.accessToken,
      ...gatewayCredentialExpiryMetadata(settings),
      ...gatewayCredentialIdentityMetadata(settings),
      endpoint: settings.endpoint,
      signMethod: settings.signMethod,
      ...gatewayAuthorizationMetadata(settings)
    }
  };
}

/** Private metadata: persist only inside the vault, never in options-facing settings. */
export function gatewayCredentialIdentityMetadata(value: {
  configurationId?: unknown;
  refreshToken?: unknown;
  refreshTokenExpiresTimeUtc?: unknown;
}): Pick<GatewayCredentialSettings, 'configurationId' | 'refreshToken' | 'refreshTokenExpiresTimeUtc'> {
  if (
    value.configurationId !== undefined &&
    (typeof value.configurationId !== 'string' || !/^[\w.-]{1,128}$/u.test(value.configurationId))
  )
    throw new Error('ALIBABA_CONFIGURATION_ID_INVALID');
  if (
    value.refreshToken !== undefined &&
    value.refreshToken !== null &&
    (typeof value.refreshToken !== 'string' || value.refreshToken.length > 4096)
  )
    throw new Error('ALIBABA_REFRESH_TOKEN_INVALID');
  return {
    ...(value.configurationId === undefined ? {} : { configurationId: value.configurationId }),
    ...(value.refreshToken === undefined ? {} : { refreshToken: value.refreshToken }),
    ...(value.refreshTokenExpiresTimeUtc === undefined
      ? {}
      : {
          refreshTokenExpiresTimeUtc: validTime(value.refreshTokenExpiresTimeUtc)
        })
  };
}

export function gatewayAuthorizationMetadata(value: {
  protocolCredentials?: unknown;
  authorizationBinding?: unknown;
}): Pick<GatewaySettings, 'protocolCredentials' | 'authorizationBinding'> {
  const result: Pick<GatewaySettings, 'protocolCredentials' | 'authorizationBinding'> = {};
  if (value.protocolCredentials !== undefined) {
    if (
      !isRecord(value.protocolCredentials) ||
      Object.keys(value.protocolCredentials).some((key) => key !== 'top' && key !== 'iop')
    )
      throw new Error('ALIBABA_AUTHORIZATIONS_INVALID');
    const profiles: NonNullable<GatewaySettings['protocolCredentials']> = {};
    for (const protocol of ['top', 'iop'] as const) {
      const profile = value.protocolCredentials[protocol];
      if (profile === undefined) continue;
      if (
        !isRecord(profile) ||
        !isCompleteSettings(profile) ||
        (profile.protocol !== undefined && profile.protocol !== protocol) ||
        profile.protocolCredentials !== undefined ||
        profile.authorizationBinding !== undefined
      )
        throw new Error('ALIBABA_AUTHORIZATIONS_INVALID');
      profiles[protocol] = {
        protocol,
        appKey: stringValue(profile.appKey),
        appSecret: stringValue(profile.appSecret),
        accessToken: stringValue(profile.accessToken),
        endpoint: stringValue(profile.endpoint),
        signMethod: signMethodValue(profile.signMethod),
        ...gatewayCredentialExpiryMetadata(profile),
        ...gatewayCredentialIdentityMetadata(profile)
      };
    }
    result.protocolCredentials = profiles;
  }
  if (value.authorizationBinding !== undefined) {
    const binding = value.authorizationBinding;
    if (
      !isRecord(binding) ||
      Object.keys(binding).length !== 3 ||
      typeof binding.topConfigurationId !== 'string' ||
      !/^[\w.-]{1,128}$/u.test(binding.topConfigurationId) ||
      typeof binding.iopConfigurationId !== 'string' ||
      !/^[\w.-]{1,128}$/u.test(binding.iopConfigurationId) ||
      validTime(binding.confirmedAtUtc) === null
    )
      throw new Error('ALIBABA_AUTHORIZATION_BINDING_INVALID');
    result.authorizationBinding = {
      topConfigurationId: binding.topConfigurationId,
      iopConfigurationId: binding.iopConfigurationId,
      confirmedAtUtc: binding.confirmedAtUtc as number
    };
  }
  return result;
}

/** Keep legacy settings unchanged; an unknown marker must never silently become TOP. */
export function gatewayProtocolMetadata(value: { protocol?: unknown }): Pick<GatewaySettings, 'protocol'> {
  if (value.protocol === undefined) return {};
  if (value.protocol !== 'top' && value.protocol !== 'iop') throw new Error('ALIBABA_PROTOCOL_INVALID');
  return { protocol: value.protocol };
}

export function gatewayCredentialExpiryMetadata(value: {
  accessTokenExpiresTimeUtc?: unknown;
  accessTokenCapturedTimeUtc?: unknown;
  systemApiPermission?: unknown;
  permissionCapturedTimeUtc?: unknown;
}): Pick<
  GatewaySettings,
  | 'accessTokenExpiresTimeUtc'
  | 'accessTokenCapturedTimeUtc'
  | 'systemApiPermission'
  | 'permissionCapturedTimeUtc'
> {
  const time = value.accessTokenExpiresTimeUtc;
  return {
    ...(time === undefined ? {} : { accessTokenExpiresTimeUtc: validTime(time) }),
    ...(value.accessTokenCapturedTimeUtc === undefined
      ? {}
      : { accessTokenCapturedTimeUtc: validTime(value.accessTokenCapturedTimeUtc) }),
    ...(value.systemApiPermission === undefined
      ? {}
      : {
          systemApiPermission:
            value.systemApiPermission === 'active' ||
            value.systemApiPermission === 'inactive' ||
            value.systemApiPermission === 'not-recorded'
              ? value.systemApiPermission
              : 'unknown',
          permissionCapturedTimeUtc: validTime(value.permissionCapturedTimeUtc)
        })
  };
}

function validTime(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
    ? value
    : null;
}

function isCompleteSettings(value: unknown): boolean {
  const record = asRecord(value);
  return (
    typeof record.appKey === 'string' &&
    typeof record.appSecret === 'string' &&
    typeof record.accessToken === 'string' &&
    typeof record.endpoint === 'string' &&
    isSignMethod(record.signMethod)
  );
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function signMethodValue(value: unknown): SignMethod {
  return isSignMethod(value) ? value : DEFAULT_SETTINGS.signMethod;
}

function isSignMethod(value: unknown): value is SignMethod {
  return value === 'hmac' || value === 'md5' || value === 'hmac-sha256';
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
