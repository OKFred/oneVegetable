import { describe, expect, it } from 'vitest';

import { ALIBABA_GATEWAY } from '../src/signing';
import {
  migrateGatewaySettings,
  persistGatewaySettings,
  SETTINGS_SCHEMA_VERSION
} from '../src/settings-storage';

describe('versioned gateway settings', () => {
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
