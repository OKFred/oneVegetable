import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { parseAlibabaOpenApiCredentialBundle } from '../src/alibaba-credential-bundle';
import {
  openAlibabaAuthorization,
  restoreAlibabaAuthorization,
  resealAlibabaAuthorization,
  sealAlibabaAuthorization
} from '../src/alibaba-authorization-vault';

describe('independent encrypted IOP authorization store', () => {
  it('round trips without exposing credentials and rotates the IV', async () => {
    const bundle = parseAlibabaOpenApiCredentialBundle({ ...fixture.oauthBundle, protocol: 'iop' });
    const sealed = await sealAlibabaAuthorization(bundle, '123456');
    expect(JSON.stringify(sealed.record)).not.toContain(bundle.application.appSecret);
    expect(JSON.stringify(sealed.record)).not.toContain(bundle.oauth.accessToken);
    expect((await openAlibabaAuthorization(sealed.record, '123456')).bundle).toEqual(bundle);
    const changed = await resealAlibabaAuthorization(bundle, sealed.key, sealed.record.salt);
    expect(changed.iv).not.toBe(sealed.record.iv);
    await expect(openAlibabaAuthorization(changed, 'wrong-password')).rejects.toThrow('AUTH_UNLOCK_FAILED');
    await expect(openAlibabaAuthorization({ ...changed, salt: '' }, '123456')).rejects.toThrow();
  });
  it('will not store a legacy document under an IOP identity', async () => {
    await expect(
      sealAlibabaAuthorization(parseAlibabaOpenApiCredentialBundle(fixture.oauthBundle), '123456')
    ).rejects.toThrow('IOP_REQUIRED');
  });
});

describe('protocol-isolated authorization encryption', () => {
  it.each(['top', 'iop'] as const)(
    'restores %s from derived material, keeping the runtime key non-exportable',
    async (protocol) => {
      const bundle = parseAlibabaOpenApiCredentialBundle({ ...fixture.oauthBundle, protocol });
      const sealed = await sealAlibabaAuthorization(bundle, '123456', protocol);
      const restored = await restoreAlibabaAuthorization(sealed.record, sealed.sessionKeyMaterial, protocol);
      expect(restored.bundle).toEqual(bundle);
      expect(restored.key.extractable).toBe(false);
      expect(atob(restored.sessionKeyMaterial)).toHaveLength(32);
      await expect(crypto.subtle.exportKey('raw', restored.key)).rejects.toThrow();
      await expect(
        restoreAlibabaAuthorization(
          sealed.record,
          sealed.sessionKeyMaterial,
          protocol === 'top' ? 'iop' : 'top'
        )
      ).rejects.toThrow('AUTH_UNLOCK_FAILED');
      for (const material of ['', 'invalid', btoa('0'.repeat(32))])
        await expect(restoreAlibabaAuthorization(sealed.record, material, protocol)).rejects.toThrow(
          'AUTH_UNLOCK_FAILED'
        );
    }
  );

  it('keeps the original PBKDF2 deriveKey ciphertext decryptable with its old passphrase', async () => {
    const bundle = parseAlibabaOpenApiCredentialBundle({ ...fixture.oauthBundle, protocol: 'iop' });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('123456'),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const oldKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const record = await resealAlibabaAuthorization(bundle, oldKey, encode(salt));
    const opened = await openAlibabaAuthorization(record, '123456');
    expect(opened.record).toEqual(record);
    expect((await restoreAlibabaAuthorization(record, opened.sessionKeyMaterial)).bundle).toEqual(bundle);
  });

  it('round trips a legacy TOP bundle only with explicit TOP AAD, including resealing', async () => {
    const bundle = parseAlibabaOpenApiCredentialBundle(fixture.oauthBundle);
    const sealed = await sealAlibabaAuthorization(bundle, '123456', 'top');
    expect((await openAlibabaAuthorization(sealed.record, '123456', 'top')).bundle).toEqual(bundle);
    const next = { ...bundle, protocol: 'top' as const };
    const rotated = await resealAlibabaAuthorization(next, sealed.key, sealed.record.salt, 'top');
    expect(rotated.salt).toBe(sealed.record.salt);
    expect(rotated.iv).not.toBe(sealed.record.iv);
    expect((await openAlibabaAuthorization(rotated, '123456', 'top')).bundle).toEqual(next);
    for (const secret of [bundle.application.appSecret, bundle.oauth.accessToken])
      expect(JSON.stringify(rotated)).not.toContain(secret);
    await expect(openAlibabaAuthorization(rotated, '123456')).rejects.toThrow('AUTH_UNLOCK_FAILED');
  });

  it('cannot decrypt an IOP ciphertext as TOP even with the same passphrase', async () => {
    const bundle = parseAlibabaOpenApiCredentialBundle({ ...fixture.oauthBundle, protocol: 'iop' });
    const sealed = await sealAlibabaAuthorization(bundle, '123456');
    await expect(openAlibabaAuthorization(sealed.record, '123456', 'top')).rejects.toThrow(
      'AUTH_UNLOCK_FAILED'
    );
    expect((await openAlibabaAuthorization(sealed.record, '123456')).bundle).toEqual(bundle);
    await expect(sealAlibabaAuthorization(bundle, '123456', 'top')).rejects.toThrow('TOP_REQUIRED');
  });

  it('does not permit cross-protocol resealing with an already unlocked key', async () => {
    const top = parseAlibabaOpenApiCredentialBundle(fixture.oauthBundle);
    const sealed = await sealAlibabaAuthorization(top, '123456', 'top');
    await expect(resealAlibabaAuthorization(top, sealed.key, sealed.record.salt)).rejects.toThrow(
      'IOP_REQUIRED'
    );
    await expect(
      resealAlibabaAuthorization({ ...top, protocol: 'iop' }, sealed.key, sealed.record.salt, 'top')
    ).rejects.toThrow('TOP_REQUIRED');
  });
});
