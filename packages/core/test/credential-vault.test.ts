import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_VAULT_ITERATIONS,
  credentialVaultSessionTiming,
  CredentialVaultSession,
  createCredentialVault,
  CredentialVaultError,
  inspectCredentialStorage,
  resealCredentialVault,
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
      policy: { idleTimeoutMinutes: 15 }
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

  it('classifies empty, legacy, encrypted and invalid storage', async () => {
    expect(inspectCredentialStorage(undefined, false).kind).toBe('empty');
    expect(inspectCredentialStorage({ version: 1, settings }).kind).toBe('legacy');
    const { record } = await createCredentialVault(settings, 'correct horse battery staple');
    expect(inspectCredentialStorage(record).kind).toBe('vault');
    expect(inspectCredentialStorage({ version: 2 }).kind).toBe('invalid');
  });

  it('bounds passphrase byte length', () => {
    expect(() => {
      validateVaultPassphrase('short');
    }).toThrow(CredentialVaultError);
    expect(() => {
      validateVaultPassphrase('可用的保险库口令');
    }).not.toThrow();
    expect(() => {
      validateVaultPassphrase('x'.repeat(257));
    }).toThrow(/不能超过/u);
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
      createCredentialVault(settings, 'correct horse battery staple', { idleTimeoutMinutes: 0 })
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
