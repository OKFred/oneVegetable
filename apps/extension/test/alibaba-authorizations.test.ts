import { describe, expect, it } from 'vitest';
import type { GatewaySettings } from '@one-vegetable/core';
import { galleryGatewayId } from '@one-vegetable/core/gallery-transfer-context';
import {
  authorizationProfiles,
  clearAuthorizationProfile,
  editableAuthorization,
  initializeAuthorizationIdentities,
  resolveAuthorization,
  saveAuthorizationPatch,
  setDefaultAuthorization,
  summarizeAuthorizations,
  runtimeAuthorization
} from '../lib/alibaba-authorizations';

const top: GatewaySettings = {
  appKey: 'test-top-app-key',
  appSecret: 'test-top-secret',
  accessToken: 'test-top-token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac',
  refreshToken: 'test-top-refresh'
};
const iop: GatewaySettings = {
  protocol: 'iop',
  appKey: 'test-iop-app-key',
  appSecret: 'test-iop-secret',
  accessToken: 'test-iop-token',
  endpoint: 'https://openapi-api.alibaba.com/rest',
  signMethod: 'hmac-sha256',
  refreshToken: 'test-iop-refresh'
};
function pair() {
  const settings = saveAuthorizationPatch(initializeAuthorizationIdentities(top), iop);
  const ids = summarizeAuthorizations(settings).binding;
  if (!ids.topConfigurationId || !ids.iopConfigurationId) throw new Error('Missing fixture identities');
  settings.authorizationBinding = {
    topConfigurationId: ids.topConfigurationId,
    iopConfigurationId: ids.iopConfigurationId,
    confirmedAtUtc: 1_000
  };
  return settings;
}
describe('extension encrypted protocol profiles', () => {
  it('changes the persisted default without changing credentials, binding or pinned routing', async () => {
    const original = pair();
    const profiles = authorizationProfiles(original);
    const topId = profiles.top?.configurationId;
    const iopId = profiles.iop?.configurationId;
    if (!topId || !iopId) throw new Error('Missing fixture identities');
    const next = setDefaultAuthorization(original, 'iop', iopId);
    expect(next.protocol).toBe('iop');
    expect(authorizationProfiles(next).iop).toEqual(profiles.iop);
    expect(authorizationProfiles(next).top).toEqual(profiles.top);
    expect(next.authorizationBinding).toEqual(original.authorizationBinding);
    expect(original.protocol).toBeUndefined();
    expect(await resolveAuthorization(next)).toMatchObject(iop);
    expect(await resolveAuthorization(next, 'listPhotos', {})).toMatchObject(top);
    const restored = setDefaultAuthorization(next, 'top', topId);
    expect(restored.protocol).toBe('top');
    expect(restored.protocolCredentials?.iop).toEqual(profiles.iop);
  });
  it('rejects missing and stale profiles without changing the saved default', () => {
    const original = initializeAuthorizationIdentities(top);
    expect(() => setDefaultAuthorization(original, 'iop', 'missing')).toThrow();
    expect(() => setDefaultAuthorization(original, 'top', 'stale')).toThrow('ENTITY_VERSION_CONFLICT');
    expect(original.protocol).toBeUndefined();
  });
  it('preserves the original TOP profile and issues a new identity for every import', () => {
    const original = initializeAuthorizationIdentities(top);
    const settings = saveAuthorizationPatch(original, iop);
    expect(authorizationProfiles(settings).top).toEqual(original);
    expect(settings.protocol).toBeUndefined();
    const confirmed = pair();
    const next = saveAuthorizationPatch(confirmed, iop);
    expect(next.authorizationBinding).toBeUndefined();
    expect(next.protocolCredentials?.iop?.configurationId).not.toBe(
      confirmed.protocolCredentials?.iop?.configurationId
    );
  });
  it('reports stale binding as unconfirmed and never exposes nested plaintext or refresh tokens', () => {
    const settings = pair();
    expect(summarizeAuthorizations(settings).binding.confirmed).toBe(true);
    const binding = settings.authorizationBinding;
    if (!binding) throw new Error('Missing fixture binding');
    settings.authorizationBinding = { ...binding, iopConfigurationId: 'stale-fixture' };
    expect(summarizeAuthorizations(settings).binding).toMatchObject({
      confirmed: false,
      confirmedAtUtc: null
    });
    const exposed = JSON.stringify([
      summarizeAuthorizations(settings),
      editableAuthorization(settings),
      editableAuthorization(iop)
    ]);
    for (const secret of [
      top.appSecret,
      top.accessToken,
      top.refreshToken,
      iop.appSecret,
      iop.accessToken,
      iop.refreshToken
    ])
      expect(exposed).not.toContain(secret);
    expect(exposed).not.toContain('protocolCredentials');
    expect(summarizeAuthorizations(settings).top?.appKeySuffix).toBe(top.appKey.slice(-4));
  });
  it('keeps identities/binding for a blank redacted save and removes only the selected slot', () => {
    const settings = pair();
    const next = saveAuthorizationPatch(settings, { ...editableAuthorization(iop), protocol: 'iop' });
    expect(summarizeAuthorizations(next).binding).toEqual(summarizeAuthorizations(settings).binding);
    const cleared = clearAuthorizationProfile(next, 'iop');
    expect(summarizeAuthorizations(cleared)).toMatchObject({ iop: null, binding: { confirmed: false } });
    expect(authorizationProfiles(cleared).top?.accessToken).toBe(top.accessToken);
    expect(summarizeAuthorizations(clearAuthorizationProfile(settings, 'top'))).toMatchObject({
      top: null,
      defaultProtocol: 'iop'
    });
  });
  it('routes a configured pair by capability without requiring legacy confirmation', async () => {
    const settings = pair();
    for (const payload of [{}, { groupId: '-1' }, { ungrouped: true }])
      expect((await resolveAuthorization(settings, 'listPhotos', payload)).accessToken).toBe(top.accessToken);
    expect((await resolveAuthorization(settings, 'listPhotos', { groupId: '123' })).protocol).toBe('iop');
    const unconfirmed = { ...settings };
    delete unconfirmed.authorizationBinding;
    expect((await resolveAuthorization(unconfirmed, 'listPhotos', { groupId: '123' })).accessToken).toBe(
      iop.accessToken
    );
    expect((await resolveAuthorization(unconfirmed, 'listProducts')).protocol).toBe('iop');
    expect(summarizeAuthorizations(unconfirmed).binding.confirmed).toBe(false);
    expect(unconfirmed.authorizationBinding).toBeUndefined();
    expect((await resolveAuthorization(settings, 'getDashboard')).accessToken).toBe(top.accessToken);
    expect((await resolveAuthorization(settings, 'getTradeOrderAggregate')).accessToken).toBe(
      top.accessToken
    );
  });
  it('matches exact saved contexts ahead of preference and rejects removed contexts without rebinding', async () => {
    const settings = pair();
    delete settings.authorizationBinding;
    const profiles = authorizationProfiles(settings);
    if (!profiles.top || !profiles.iop) throw new Error('Missing fixture profiles');
    const topId = await galleryGatewayId(runtimeAuthorization(profiles.top));
    const iopId = await galleryGatewayId(runtimeAuthorization(profiles.iop));
    expect((await resolveAuthorization(settings, 'updateProduct', {}, topId)).accessToken).toBe(
      top.accessToken
    );
    expect((await resolveAuthorization(settings, 'uploadPhoto', {}, iopId)).protocol).toBe('iop');
    await expect(
      resolveAuthorization(clearAuthorizationProfile(settings, 'iop'), 'updateProduct', {}, iopId)
    ).rejects.toMatchObject({ gatewayError: { code: 'PRODUCT_CONTEXT_CHANGED' } });
  });
});
