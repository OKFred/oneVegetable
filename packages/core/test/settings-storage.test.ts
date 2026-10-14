import { describe, expect, it } from 'vitest';

import { ALIBABA_GATEWAY } from '../src/signing';
import {
  migrateGatewaySettings,
  persistGatewaySettings,
  SETTINGS_SCHEMA_VERSION
} from '../src/settings-storage';

describe('versioned gateway settings', () => {
  it('preserves both private profiles and user confirmation without flattening the default', () => {
    const input = {
      appKey: 'top-key',
      appSecret: 'top-secret',
      accessToken: 'top-token',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac' as const,
      configurationId: 'top-configuration',
      refreshToken: 'top-refresh',
      refreshTokenExpiresTimeUtc: 1_900_000_000_000,
      protocolCredentials: {
        iop: {
          protocol: 'iop' as const,
          appKey: 'iop-key',
          appSecret: 'iop-secret',
          accessToken: 'iop-token',
          endpoint: 'https://openapi-api.alibaba.com/rest',
          signMethod: 'hmac-sha256' as const,
          configurationId: 'iop-configuration',
          refreshToken: 'iop-refresh'
        }
      },
      authorizationBinding: {
        topConfigurationId: 'top-configuration',
        iopConfigurationId: 'iop-configuration',
        confirmedAtUtc: 1_000
      }
    };
    expect(migrateGatewaySettings(persistGatewaySettings(input)).settings).toEqual(input);
    expect(() =>
      migrateGatewaySettings({
        ...input,
        protocolCredentials: { iop: { ...input.protocolCredentials.iop, protocol: 'top' } }
      })
    ).toThrow('ALIBABA_AUTHORIZATIONS_INVALID');
    expect(() =>
      migrateGatewaySettings({
        ...input,
        authorizationBinding: { ...input.authorizationBinding, confirmedAtUtc: -1 }
      })
    ).toThrow('ALIBABA_AUTHORIZATION_BINDING_INVALID');
  });
  it('preserves IOP markers and never infers them on legacy settings', () => {
    const settings = migrateGatewaySettings({
      protocol: 'iop',
      endpoint: 'https://openapi-api.alibaba.com/rest'
    }).settings;
    expect(migrateGatewaySettings(persistGatewaySettings(settings)).settings.protocol).toBe('iop');
    expect(migrateGatewaySettings({ appKey: 'fixture-key' }).settings.protocol).toBeUndefined();
    expect(() => migrateGatewaySettings({ protocol: 'unknown' })).toThrow('ALIBABA_PROTOCOL_INVALID');
  });
  it('preserves token expiry metadata and discards malformed timestamps', () => {
    const settings = migrateGatewaySettings({ accessTokenExpiresTimeUtc: 1_800_000_000_000 }).settings;
    expect(migrateGatewaySettings(persistGatewaySettings(settings)).settings.accessTokenExpiresTimeUtc).toBe(
      1_800_000_000_000
    );
    for (const value of ['tomorrow', -1, Infinity]) {
      expect(
        migrateGatewaySettings({ accessTokenExpiresTimeUtc: value }).settings.accessTokenExpiresTimeUtc
      ).toBeNull();
    }
  });
  it('migrates the legacy flat value without losing credentials', () => {
    const result = migrateGatewaySettings({
      appKey: 'legacy-key',
      appSecret: 'legacy-secret',
      accessToken: 'legacy-token',
      endpoint: 'https://gateway.example.com/router',
      signMethod: 'md5'
    });

    expect(result.migrated).toBe(true);
    expect(result.settings).toMatchObject({ appKey: 'legacy-key', signMethod: 'md5' });
    expect(result.persistedValue).toEqual({ version: SETTINGS_SCHEMA_VERSION, settings: result.settings });
  });

  it('repairs incomplete or invalid values with safe defaults', () => {
    const result = migrateGatewaySettings({ version: 1, settings: { signMethod: 'unknown' } });
    expect(result.settings).toEqual({
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac'
    });
    expect(result.migrated).toBe(true);
  });

  it('recognizes and serializes the current schema', () => {
    const persisted = persistGatewaySettings({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac-sha256'
    });
    expect(migrateGatewaySettings(persisted)).toMatchObject({ migrated: false, persistedValue: persisted });
  });
});
