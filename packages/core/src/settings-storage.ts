import { ALIBABA_GATEWAY } from './signing';
import type { GatewaySettings, SignMethod } from './types';

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
    endpoint: stringValue(current.endpoint) || ALIBABA_GATEWAY,
    signMethod: signMethodValue(current.signMethod)
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
      endpoint: settings.endpoint,
      signMethod: settings.signMethod
    }
  };
}

/** Keep legacy settings unchanged; an unknown marker must never silently become TOP. */
export function gatewayProtocolMetadata(value: { protocol?: unknown }): Pick<GatewaySettings, 'protocol'> {
  if (value.protocol === undefined) return {};
  if (value.protocol !== 'top' && value.protocol !== 'iop') throw new Error('ALIBABA_PROTOCOL_INVALID');
  return { protocol: value.protocol };
}

export function gatewayCredentialExpiryMetadata(value: {
  accessTokenExpiresTimeUtc?: unknown;
  systemApiPermission?: unknown;
  permissionCapturedTimeUtc?: unknown;
}): Pick<GatewaySettings, 'accessTokenExpiresTimeUtc' | 'systemApiPermission' | 'permissionCapturedTimeUtc'> {
  const time = value.accessTokenExpiresTimeUtc;
  return {
    ...(time === undefined ? {} : { accessTokenExpiresTimeUtc: validTime(time) }),
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
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
