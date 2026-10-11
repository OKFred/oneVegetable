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
