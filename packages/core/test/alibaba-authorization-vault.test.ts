import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/node-gateway-credentials.json';
import { parseAlibabaOpenApiCredentialBundle } from '../src/alibaba-credential-bundle';
import {
  openAlibabaAuthorization,
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
