import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId } from '@one-vegetable/core';
import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlExtensionSocialDeviceRepository } from '../src/social-meta/extension-device-repository';
import { ExtensionSocialDeviceService } from '../src/social-meta/extension-device-service';
import { SqlMetaSocialRepository } from '../src/social-meta/repository';
import { MetaSecretCipher } from '../src/social-meta/secret-cipher';
import { MetaSocialService } from '../src/social-meta/service';

import type { ExtensionSocialPairingStart, ExtensionSocialPairingStatus } from '@one-vegetable/core';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const EXTENSION_ID = 'aepfdoldflokikbbcpnfifkacpfakmjc';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const databases: NodeDatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});

describe('Chrome extension social device pairing', () => {
  it('stores only hashes, returns a device token once, and enforces revocation', async () => {
    const { database, service, actorId } = await serviceHarness();
    const started = await service.start({ extensionId: EXTENSION_ID, deviceName: 'Windows Chrome' });
    expect(started.pairingCode).toMatch(/^[A-Z2-9]{16}$/u);
    const storedPairing = database.connection
      .prepare('SELECT pairing_code_hash FROM extension_social_pairings WHERE id = ?')
      .get(started.pairingId) as { pairing_code_hash: string };
    expect(storedPairing.pairing_code_hash).not.toContain(started.pairingCode);

    await service.approve(started.pairingCode, actorId);
    const paired = await service.status({
      pairingId: started.pairingId,
      pairingCode: started.pairingCode,
      extensionId: EXTENSION_ID
    });
    expect(paired).toMatchObject({ status: 'paired', device: { status: 'active' } });
    expect(paired.deviceToken).toMatch(/^ovd_[A-Za-z0-9_-]{43}$/u);
    const deviceId = paired.device?.id;
    if (!deviceId) throw new Error('paired device id missing');
    const storedDevice = database.connection
      .prepare('SELECT token_hash FROM extension_social_devices WHERE id = ?')
      .get(deviceId) as { token_hash: string };
    expect(storedDevice.token_hash).not.toContain(paired.deviceToken ?? 'missing');

    const authenticated = await service.authenticate({
      deviceToken: paired.deviceToken ?? '',
      extensionId: EXTENSION_ID
    });
    expect(authenticated.actorId).toBe(`extension-device:${paired.device?.id}`);
    const consumed = await service.status({
      pairingId: started.pairingId,
      pairingCode: started.pairingCode,
      extensionId: EXTENSION_ID
    });
    expect(consumed).toMatchObject({ status: 'consumed', deviceToken: null });

    await service.revoke({
      deviceId: paired.device?.id ?? '',
      revision: paired.device?.revision ?? 0,
      actorId
    });
    await expect(
      service.authenticate({ deviceToken: paired.deviceToken ?? '', extensionId: EXTENSION_ID })
    ).rejects.toMatchObject({ code: 'EXTENSION_DEVICE_UNAUTHORIZED' });
  });

  it('supports the complete extension-origin and administrator approval route flow', async () => {
    const database = openNodeDatabase(':memory:');
    databases.push(database);
    applyNodeMigrations(database);
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: 'bootstrap-secret-that-is-long'
    });
    const login = await authService.bootstrap({
      requestId: createRequestId(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value'
    });
    const devices = new ExtensionSocialDeviceService(
      new SqlExtensionSocialDeviceRepository(database.executor)
    );
    const cipher = await MetaSecretCipher.create(encodedKey(1));
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'mock',
      authService,
      adminService: new AdminService(authRepository),
      metaSocial: new MetaSocialService(new SqlMetaSocialRepository(database.executor), cipher),
      extensionSocialDevices: devices,
      allowedOrigins: ['http://localhost']
    });

    const startedResponse = await app.request('/api/v1/extension-pairings/start', {
      method: 'POST',
      headers: extensionHeaders(),
      body: JSON.stringify({
        requestId: createRequestId(),
        extensionId: EXTENSION_ID,
        deviceName: 'Windows Chrome'
      })
    });
    expect(startedResponse.status).toBe(200);
    expect(startedResponse.headers.get('Access-Control-Allow-Origin')).toBe(EXTENSION_ORIGIN);
    const started = await successData<ExtensionSocialPairingStart>(startedResponse);

    const approvedResponse = await app.request('/api/v1/admin/extension-pairings/approve', {
      method: 'POST',
      headers: adminHeaders(login.sessionToken, login.session.csrfToken),
      body: JSON.stringify({ requestId: createRequestId(), pairingCode: started.pairingCode })
    });
    expect(approvedResponse.status).toBe(200);

    const statusResponse = await app.request('/api/v1/extension-pairings/status', {
      method: 'POST',
      headers: extensionHeaders(),
      body: JSON.stringify({
        requestId: createRequestId(),
        pairingId: started.pairingId,
        pairingCode: started.pairingCode,
        extensionId: EXTENSION_ID
      })
    });
    const paired = await successData<ExtensionSocialPairingStatus>(statusResponse);
    expect(paired.status).toBe('paired');

    const destinationsResponse = await app.request('/api/v1/social/destinations/list', {
      method: 'POST',
      headers: extensionHeaders(paired.deviceToken ?? ''),
      body: JSON.stringify({ requestId: createRequestId() })
    });
    expect(destinationsResponse.status).toBe(200);
    await expect(destinationsResponse.json()).resolves.toMatchObject({ ok: true, data: { items: [] } });

    const revokeResponse = await app.request('/api/v1/admin/extension-devices/revoke', {
      method: 'POST',
      headers: adminHeaders(login.sessionToken, login.session.csrfToken),
      body: JSON.stringify({
        requestId: createRequestId(),
        deviceId: paired.device?.id,
        revision: paired.device?.revision
      })
    });
    expect(revokeResponse.status).toBe(200);
    const denied = await app.request('/api/v1/social/destinations/list', {
      method: 'POST',
      headers: extensionHeaders(paired.deviceToken ?? ''),
      body: JSON.stringify({ requestId: createRequestId() })
    });
    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: 'EXTENSION_DEVICE_UNAUTHORIZED' }
    });
  });
});

async function serviceHarness() {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const authService = new AuthService({
    repository: authRepository,
    bootstrapToken: 'bootstrap-secret-that-is-long'
  });
  const login = await authService.bootstrap({
    requestId: createRequestId(),
    bootstrapToken: 'bootstrap-secret-that-is-long',
    username: 'admin',
    password: 'correct-password-value'
  });
  return {
    database,
    actorId: login.user.id,
    service: new ExtensionSocialDeviceService(new SqlExtensionSocialDeviceRepository(database.executor))
  };
}

function extensionHeaders(deviceToken?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    Origin: EXTENSION_ORIGIN,
    'X-One-Vegetable-Extension-ID': EXTENSION_ID,
    ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {})
  };
}

function adminHeaders(sessionToken: string, csrfToken: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    Cookie: `ov_session=${sessionToken}`,
    Origin: 'http://localhost',
    'X-CSRF-Token': csrfToken
  };
}

async function successData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { ok: boolean; data: T };
  expect(body.ok).toBe(true);
  return body.data;
}

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
