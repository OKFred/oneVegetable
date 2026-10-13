import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/system-api-authorization.json';
import {
  alibabaAuthorizationMetadata,
  alibabaAccessTokenCapturedTime
} from '../src/alibaba-authorization-metadata';
import { migrateGatewaySettings, persistGatewaySettings } from '../src/settings-storage';

describe('System API permission snapshot', () => {
  it('uses token capture rather than the original permission snapshot for a renewed lifetime', () => {
    const refreshed = '2026-10-12T00:00:00.000Z';
    expect(
      alibabaAccessTokenCapturedTime({
        capturedAtUtc: refreshed,
        callback: { receivedAtUtc: fixture.capturedAtUtc }
      })
    ).toBe(Date.parse(refreshed));
    for (const value of [null, {}, { capturedAtUtc: 'invalid' }, { capturedAtUtc: '1969-12-31T00:00:00Z' }])
      expect(alibabaAccessTokenCapturedTime(value)).toBeNull();
    expect(alibabaAccessTokenCapturedTime({ callback: { receivedAtUtc: fixture.capturedAtUtc } })).toBeNull();
  });
  it('roundtrips token capture metadata without inventing it for old settings', () => {
    const timestamp = Date.parse(fixture.capturedAtUtc);
    const settings = migrateGatewaySettings({ accessTokenCapturedTimeUtc: timestamp }).settings;
    expect(migrateGatewaySettings(persistGatewaySettings(settings)).settings.accessTokenCapturedTimeUtc).toBe(
      timestamp
    );
    expect(migrateGatewaySettings({}).settings.accessTokenCapturedTimeUtc).toBeUndefined();
    for (const value of [-1, NaN, Infinity, 'secret', 8_640_000_000_000_001])
      expect(
        migrateGatewaySettings({ accessTokenCapturedTimeUtc: value }).settings.accessTokenCapturedTimeUtc
      ).toBeNull();
  });
  it.each([
    [fixture.active, 'active'],
    [fixture.legacy, 'not-recorded'],
    [fixture.inactive, 'inactive']
  ])('distinguishes exact System API from SystemAPI (%s)', (permissions, expected) => {
    const metadata = alibabaAuthorizationMetadata({
      capturedAtUtc: fixture.capturedAtUtc,
      application: { permissions }
    });
    expect(metadata).toEqual({
      systemApiPermission: expected,
      permissionCapturedTimeUtc: Date.parse(fixture.capturedAtUtc)
    });
  });
  it('does not turn an absent, empty, damaged or manual snapshot into a missing permission claim', () => {
    for (const permissions of [undefined, [], 'Active', [{ name: 'System API' }]])
      expect(alibabaAuthorizationMetadata({ application: { permissions } })).toEqual({
        systemApiPermission: 'unknown',
        permissionCapturedTimeUtc: null
      });
    expect(alibabaAuthorizationMetadata(null).systemApiPermission).toBe('unknown');
    for (const status of ['', 'unexpected'])
      expect(
        alibabaAuthorizationMetadata({ application: { permissions: [{ name: 'System API', status }] } })
          .systemApiPermission
      ).toBe('unknown');
  });
  it('preserves safe metadata alongside encrypted settings and rejects arbitrary enum/time input', () => {
    const metadata = alibabaAuthorizationMetadata({
      capturedAtUtc: fixture.capturedAtUtc,
      application: { permissions: fixture.active }
    });
    const settings = migrateGatewaySettings({
      ...metadata,
      accessTokenExpiresTimeUtc: 1_800_000_000_000
    }).settings;
    expect(migrateGatewaySettings(persistGatewaySettings(settings)).settings).toMatchObject(metadata);
    expect(
      migrateGatewaySettings({ systemApiPermission: 'secret', permissionCapturedTimeUtc: -1 }).settings
    ).toMatchObject({ systemApiPermission: 'unknown', permissionCapturedTimeUtc: null });
  });
  it('does not make an old permission snapshot look fresh when only the token is refreshed', () => {
    const metadata = alibabaAuthorizationMetadata({
      capturedAtUtc: '2026-10-12T00:00:00.000Z',
      callback: { receivedAtUtc: fixture.capturedAtUtc },
      application: { permissions: fixture.active }
    });
    expect(metadata.permissionCapturedTimeUtc).toBe(Date.parse(fixture.capturedAtUtc));
  });
});
