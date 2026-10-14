import { describe, expect, it } from 'vitest';

import { ALIBABA_GATEWAY, createCredentialVault } from '@one-vegetable/core';
import {
  CREDENTIAL_VAULT_SESSION_STORAGE_KEY,
  ExtensionCredentialVaultSession,
  type ExtensionCredentialVaultSessionStorage
} from '../lib/credential-vault-session';

const settings = {
  appKey: 'session-app-key',
  appSecret: 'session-app-secret',
  accessToken: 'session-access-token',
  endpoint: ALIBABA_GATEWAY,
  signMethod: 'hmac-sha256' as const
};

describe('extension credential vault session', () => {
  it('restores both encrypted protocol slots and confirmation without persisting plaintext', async () => {
    const storage = new MemorySessionStorage();
    const input = {
      ...settings,
      configurationId: 'top-profile',
      refreshToken: 'top-private-refresh',
      protocolCredentials: {
        iop: {
          ...settings,
          protocol: 'iop' as const,
          configurationId: 'iop-profile',
          endpoint: 'https://openapi-api.alibaba.com/rest',
          accessToken: 'iop-private-token',
          refreshToken: 'iop-private-refresh'
        }
      },
      authorizationBinding: {
        topConfigurationId: 'top-profile',
        iopConfigurationId: 'iop-profile',
        confirmedAtUtc: 1_000
      }
    };
    const created = await createCredentialVault(input, '123456');
    await new ExtensionCredentialVaultSession(storage).activate(created, created.sessionKeyMaterial);
    for (const secret of ['top-private-refresh', 'iop-private-refresh', 'iop-private-token'])
      expect(JSON.stringify(storage.values)).not.toContain(secret);
    expect((await new ExtensionCredentialVaultSession(storage).read(created.record))?.value.settings).toEqual(
      input
    );
  });
  it('restores an unlocked vault after the service worker memory is lost', async () => {
    const storage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password');
    const firstWorker = new ExtensionCredentialVaultSession(storage, () => 1_000);
    await firstWorker.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    const serialized = JSON.stringify(storage.values);
    expect(serialized).not.toContain('session-password');
    expect(serialized).not.toContain(settings.appKey);
    expect(serialized).not.toContain(settings.appSecret);
    expect(serialized).not.toContain(settings.accessToken);

    const restartedWorker = new ExtensionCredentialVaultSession(storage, () => 2_000);
    const restored = await restartedWorker.read(created.record);
    expect(restored).toMatchObject({
      lastActivityAt: 1_000,
      value: { settings, policy: { idleTimeoutMinutes: 0 } }
    });
  });

  it('persists activity touches across worker restarts', async () => {
    const storage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password', {
      idleTimeoutMinutes: 5
    });
    const firstWorker = new ExtensionCredentialVaultSession(storage, () => 1_000);
    await firstWorker.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    const restartedWorker = new ExtensionCredentialVaultSession(storage, () => 121_000);
    const touched = await restartedWorker.read(created.record, true);
    expect(touched?.lastActivityAt).toBe(121_000);

    const nextWorker = new ExtensionCredentialVaultSession(storage, () => 420_999);
    expect(await nextWorker.read(created.record)).toBeDefined();
  });

  it('clears an expired or record-mismatched session instead of restoring it', async () => {
    const expiredStorage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password', {
      idleTimeoutMinutes: 5
    });
    const active = new ExtensionCredentialVaultSession(expiredStorage, () => 1_000);
    await active.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    const expired = new ExtensionCredentialVaultSession(expiredStorage, () => 301_000);
    expect(await expired.read(created.record)).toBeUndefined();
    expect(expired.lockReason).toBe('idle');
    expect(expiredStorage.values).not.toHaveProperty(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);

    const mismatchedStorage = new MemorySessionStorage();
    const original = new ExtensionCredentialVaultSession(mismatchedStorage, () => 1_000);
    await original.activate({ ...created, record: created.record }, created.sessionKeyMaterial);
    const changed = structuredClone(created.record);
    changed.cipher.iv = btoa('changed-iv!!');
    const mismatched = new ExtensionCredentialVaultSession(mismatchedStorage, () => 2_000);
    expect(await mismatched.read(changed)).toBeUndefined();
    expect(mismatchedStorage.values).not.toHaveProperty(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
  });

  it('removes the session cache when the user locks the vault', async () => {
    const storage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password');
    const session = new ExtensionCredentialVaultSession(storage, () => 1_000);
    await session.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    await session.lock('manual');

    expect(session.lockReason).toBe('manual');
    expect(storage.values).not.toHaveProperty(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    expect(await session.read(created.record)).toBeUndefined();
  });
});

class MemorySessionStorage implements ExtensionCredentialVaultSessionStorage {
  readonly values: Record<string, unknown> = {};

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(key in this.values ? { [key]: structuredClone(this.values[key]) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    Reflect.deleteProperty(this.values, key);
    return Promise.resolve();
  }
}
