import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import passwords from '../../../mock/data/auth-password-policy.json';
import contract from '../../../openapi/one-vegetable.json';
import {
  hashPassword,
  PASSWORD_ITERATIONS,
  PASSWORD_MIN_CHARACTERS,
  validatePassword,
  verifyPassword
} from '../src/auth/password';

describe('workspace password policy', () => {
  it('keeps new-password contracts at six characters and existing-password login compatible', () => {
    const schemas = contract.components.schemas;
    for (const policy of [
      schemas.AuthBootstrapRequest.properties.password,
      schemas.AuthPasswordChangeRequest.properties.newPassword,
      schemas.AdminUserCreateRequest.properties.password,
      schemas.AdminPasswordResetRequest.properties.newPassword
    ])
      expect(policy.minLength).toBe(PASSWORD_MIN_CHARACTERS);
    expect(schemas.AuthLoginRequest.properties.password.minLength).toBe(1);
  });

  it('accepts six characters without a complexity requirement and rejects five', () => {
    expect(() => {
      validatePassword(passwords.sixCharacters);
    }).not.toThrow();
    expect(() => {
      validatePassword(passwords.fiveCharacters);
    }).toThrow();
    expect(() => {
      validatePassword('新的六位密码');
    }).not.toThrow();
    expect(() => {
      validatePassword('😀'.repeat(5));
    }).toThrow();
  });

  it('keeps the 256-byte upper limit for Unicode and ASCII passwords', () => {
    expect(() => {
      validatePassword('a'.repeat(256));
    }).not.toThrow();
    expect(() => {
      validatePassword('a'.repeat(257));
    }).toThrow();
    expect(() => {
      validatePassword('字'.repeat(85));
    }).not.toThrow();
    expect(() => {
      validatePassword('字'.repeat(86));
    }).toThrow();
  });

  it('hashes and verifies six-character passwords with the unchanged PBKDF2 strength', async () => {
    expect(PASSWORD_ITERATIONS).toBe(600_000);
    const digest = await hashPassword(passwords.sixCharacters);
    expect(digest.hash).not.toBe(passwords.sixCharacters);
    await expect(verifyPassword(passwords.sixCharacters, digest.hash, digest.salt)).resolves.toBe(true);
    await expect(verifyPassword(passwords.replacement, digest.hash, digest.salt)).resolves.toBe(false);
  });

  it('still verifies existing Unicode passwords accepted by the old byte-based policy', async () => {
    const salt = Buffer.alloc(16, 3);
    const legacyHash = pbkdf2Sync(passwords.legacyUnicode, salt, 600_000, 32, 'sha256').toString('base64url');
    await expect(
      verifyPassword(passwords.legacyUnicode, legacyHash, salt.toString('base64url'))
    ).resolves.toBe(true);
    await expect(verifyPassword('', legacyHash, salt.toString('base64url'))).resolves.toBe(false);
  });
});
