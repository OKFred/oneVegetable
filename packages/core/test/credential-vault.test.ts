import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_VAULT_ITERATIONS,
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
      settings
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
});
