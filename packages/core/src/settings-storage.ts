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
    appKey: stringValue(current.appKey),
    appSecret: stringValue(current.appSecret),
    accessToken: stringValue(current.accessToken),
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
  return { version: SETTINGS_SCHEMA_VERSION, settings: structuredClone(settings) };
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
