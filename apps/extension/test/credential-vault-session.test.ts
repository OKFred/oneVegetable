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

  it('ignores old idle policies after browser restart but refuses mismatched records', async () => {
    const expiredStorage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password', {
      idleTimeoutMinutes: 5
    });
    const active = new ExtensionCredentialVaultSession(expiredStorage, () => 1_000);
    await active.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    const expired = new ExtensionCredentialVaultSession(expiredStorage, () => 301_000);
    expect(await expired.read(created.record)).toMatchObject({
      value: { settings, policy: { idleTimeoutMinutes: 0 } },
      remainingSeconds: null
    });
    expect(expired.lockReason).toBeNull();

    const mismatchedStorage = new MemorySessionStorage();
    const original = new ExtensionCredentialVaultSession(mismatchedStorage, () => 1_000);
    await original.activate({ ...created, record: created.record }, created.sessionKeyMaterial);
    const changed = structuredClone(created.record);
    changed.cipher.iv = btoa('changed-iv!!');
    const mismatched = new ExtensionCredentialVaultSession(mismatchedStorage, () => 2_000);
    expect(await mismatched.read(changed)).toBeUndefined();
    expect(mismatchedStorage.values).toHaveProperty(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    expect((await mismatched.read(created.record))?.value.settings).toEqual(settings);
  });

  it('removes the session cache when the user locks the vault', async () => {
    const storage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password');
    const session = new ExtensionCredentialVaultSession(storage, () => 1_000);
    await session.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    await session.lock('manual');

    expect(session.lockReason).toBe('manual');
    expect(storage.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toEqual({
      schemaVersion: 2,
      state: 'locked'
    });
    expect(await session.read(created.record)).toBeUndefined();
    expect(await new ExtensionCredentialVaultSession(storage).read(created.record)).toBeUndefined();
  });

  it('migrates a legacy temporary session once and survives its removal', async () => {
    const local = new MemorySessionStorage();
    const legacy = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456', { idleTimeoutMinutes: 5 });
    await new ExtensionCredentialVaultSession(legacy, () => 1000).activate(
      created,
      created.sessionKeyMaterial
    );
    const upgraded = new ExtensionCredentialVaultSession(local, () => 900000, legacy);
    expect((await upgraded.read(created.record))?.value.settings).toEqual(settings);
    expect(legacy.values).not.toHaveProperty(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    expect((await new ExtensionCredentialVaultSession(local).read(created.record))?.value.settings).toEqual(
      settings
    );
  });

  it('requires the original passphrase for an older locked vault without recovery material', async () => {
    const created = await createCredentialVault(settings, '123456');
    const local = new MemorySessionStorage();
    expect(await new ExtensionCredentialVaultSession(local).read(created.record)).toBeUndefined();
    expect(local.values).toEqual({});
  });

  it('does not reactivate from a legacy session after explicit lock', async () => {
    const local = new MemorySessionStorage();
    const legacy = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
    await new ExtensionCredentialVaultSession(local).lock();
    expect(
      await new ExtensionCredentialVaultSession(local, Date.now, legacy).read(created.record)
    ).toBeUndefined();
  });

  it('does not resurrect a manually locked session from a concurrent read or late save', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const vault = new ExtensionCredentialVaultSession(local);
    await vault.activate(created, created.sessionKeyMaterial);
    const reading = vault.read(created.record);
    const locking = vault.lock();
    await Promise.all([reading, locking]);
    await expect(vault.update(created)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
    expect(await new ExtensionCredentialVaultSession(local).read(created.record)).toBeUndefined();
  });

  it('clears in-memory access after local data is removed', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const vault = new ExtensionCredentialVaultSession(local);
    await vault.activate(created, created.sessionKeyMaterial);
    await local.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    expect(await vault.read(created.record)).toBeUndefined();
  });

  it('fails rather than claiming persistence when storage writes fail', async () => {
    const local = new MemorySessionStorage();
    const broken: ExtensionCredentialVaultSessionStorage = {
      get: (key) => local.get(key),
      set: () => Promise.reject(new Error('storage failed')),
      remove: (key) => local.remove(key)
    };
    const created = await createCredentialVault(settings, '123456');
    const vault = new ExtensionCredentialVaultSession(broken);
    await expect(vault.activate(created, created.sessionKeyMaterial)).rejects.toThrow('storage failed');
    expect(await vault.read(created.record)).toBeUndefined();
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
