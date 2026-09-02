import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_VAULT_ITERATIONS,
  credentialVaultSessionTiming,
  CredentialVaultSession,
  createCredentialVault,
  CredentialVaultError,
  inspectCredentialStorage,
  resealCredentialVault,
  restoreCredentialVaultSession,
  unlockCredentialVault,
  validateVaultPassphrase
} from '../src/credential-vault';
import { ALIBABA_GATEWAY } from '../src/signing';

const settings = {
  appKey: 'vault-key',
  appSecret: 'vault-secret',
  accessToken: 'vault-token',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac-sha256' as const
};

describe('credential vault', () => {
  it('encrypts all settings with the documented work factor and decrypts them', async () => {
    const { record, key } = await createCredentialVault(settings, 'correct horse battery staple');
    expect(record).toMatchObject({
      version: 2,
      kdf: { iterations: CREDENTIAL_VAULT_ITERATIONS, hash: 'SHA-256' }
    });
    expect(key.extractable).toBe(false);
    expect(JSON.stringify(record)).not.toContain('vault-secret');
    expect(JSON.stringify(record)).not.toContain('vault-token');
    await expect(unlockCredentialVault(record, 'correct horse battery staple')).resolves.toMatchObject({
      settings,
      policy: { idleTimeoutMinutes: 0 }
    });
  });

  it('rejects a wrong passphrase and tampered ciphertext without exposing details', async () => {
    const { record } = await createCredentialVault(settings, 'correct horse battery staple');
    await expect(unlockCredentialVault(record, 'wrong-password-value')).rejects.toMatchObject({
      code: 'VAULT_UNLOCK_FAILED'
    });
    const tampered = structuredClone(record);
    tampered.cipher.ciphertext = `${tampered.cipher.ciphertext.slice(0, -2)}AA`;
    await expect(unlockCredentialVault(tampered, 'correct horse battery staple')).rejects.toMatchObject({
      code: 'VAULT_UNLOCK_FAILED'
    });
  });

  it('uses a fresh IV when resealing with the in-memory key', async () => {
    const { record, key } = await createCredentialVault(settings, 'correct horse battery staple');
    const updated = await resealCredentialVault(record, { ...settings, appKey: 'updated-key' }, key);
    expect(updated.kdf.salt).toBe(record.kdf.salt);
    expect(updated.cipher.iv).not.toBe(record.cipher.iv);
    await expect(unlockCredentialVault(updated, 'correct horse battery staple')).resolves.toMatchObject({
      settings: { appKey: 'updated-key' }
    });
  });

  it('restores the non-extractable key from session-only key material', async () => {
    const created = await createCredentialVault(settings, 'correct horse battery staple');
    const restored = await restoreCredentialVaultSession(created.record, created.sessionKeyMaterial);

    expect(restored.settings).toEqual(settings);
    expect(restored.policy).toEqual({ idleTimeoutMinutes: 0 });
    expect(restored.key.extractable).toBe(false);
    await expect(
      restoreCredentialVaultSession(created.record, btoa('not-a-valid-session-key'))
    ).rejects.toMatchObject({ code: 'VAULT_UNLOCK_FAILED' });
  });

  it('classifies empty, legacy, encrypted and invalid storage', async () => {
    expect(inspectCredentialStorage(undefined, false).kind).toBe('empty');
    expect(inspectCredentialStorage({ version: 1, settings }).kind).toBe('legacy');
    const { record } = await createCredentialVault(settings, 'correct horse battery staple');
    expect(inspectCredentialStorage(record).kind).toBe('vault');
    expect(inspectCredentialStorage({ version: 2 }).kind).toBe('invalid');
  });

  it('accepts six-character passphrases and rejects shorter values', () => {
    expect(() => {
      validateVaultPassphrase('12345');
    }).toThrow(CredentialVaultError);
    expect(() => {
      validateVaultPassphrase('123456');
    }).not.toThrow();
    expect(() => {
      validateVaultPassphrase('六位保险口令');
    }).not.toThrow();
    expect(() => {
      validateVaultPassphrase('x'.repeat(257));
    }).toThrow(/不能超过/u);
  });

  it('keeps new vault sessions unlocked when idle locking is not selected', async () => {
    const { record, key, policy } = await createCredentialVault(settings, '123456');
    expect(policy).toEqual({ idleTimeoutMinutes: 0 });
    expect(credentialVaultSessionTiming(policy, 1_000, Number.MAX_SAFE_INTEGER)).toEqual({
      expired: false,
      remainingSeconds: null
    });

    const session = new CredentialVaultSession();
    session.activate({ record, key, settings, policy }, 1_000);
    expect(session.read(record, false, Number.MAX_SAFE_INTEGER)).toMatchObject({
      lastActivityAt: 1_000,
      remainingSeconds: null
    });
    expect(session.lockReason).toBeNull();
  });

  it('encrypts the idle-lock policy and calculates expiration without extending activity', async () => {
    const { record } = await createCredentialVault(settings, 'correct horse battery staple', {
      idleTimeoutMinutes: 5
    });
    expect(JSON.stringify(record)).not.toContain('idleTimeoutMinutes');
    await expect(unlockCredentialVault(record, 'correct horse battery staple')).resolves.toMatchObject({
      policy: { idleTimeoutMinutes: 5 }
    });

    expect(credentialVaultSessionTiming({ idleTimeoutMinutes: 5 }, 1_000, 300_999)).toEqual({
      expired: false,
      remainingSeconds: 1
    });
    expect(credentialVaultSessionTiming({ idleTimeoutMinutes: 5 }, 1_000, 301_000)).toEqual({
      expired: true,
      remainingSeconds: 0
    });
  });

  it('rejects unsupported idle-lock policies', async () => {
    await expect(
      createCredentialVault(settings, 'correct horse battery staple', { idleTimeoutMinutes: 1 })
    ).rejects.toMatchObject({ code: 'VAULT_INVALID' });
  });

  it('does not extend idle time for status reads and locks exactly at the deadline', async () => {
    const { record, key, policy } = await createCredentialVault(settings, 'correct horse battery staple', {
      idleTimeoutMinutes: 5
    });
    const session = new CredentialVaultSession();
    session.activate({ record, key, settings, policy }, 1_000);

    expect(session.read(record, false, 61_000)).toMatchObject({
      lastActivityAt: 1_000,
      remainingSeconds: 240
    });
    expect(session.read(record, true, 121_000)).toMatchObject({
      lastActivityAt: 121_000,
      remainingSeconds: 300
    });
    expect(session.read(record, false, 420_999)).toBeDefined();
    expect(session.read(record, false, 421_000)).toBeUndefined();
    expect(session.lockReason).toBe('idle');
  });

  it('invalidates the session when the encrypted record changes', async () => {
    const { record, key, policy } = await createCredentialVault(settings, 'correct horse battery staple');
    const session = new CredentialVaultSession();
    session.activate({ record, key, settings, policy }, 1_000);
    const changed = structuredClone(record);
    changed.cipher.iv = btoa('changed-iv!!');
    expect(session.read(changed, false, 2_000)).toBeUndefined();
    expect(session.lockReason).toBeNull();
  });
});
