import { describe, expect, it } from 'vitest';

import {
  ALIBABA_GATEWAY,
  createCredentialVault,
  resealCredentialVault,
  unlockCredentialVault
} from '@one-vegetable/core';
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
    const worker = new ExtensionCredentialVaultSession(storage);
    await worker.lock();
    expect(await worker.read(created.record)).toBeUndefined();
    expect(
      (await new ExtensionCredentialVaultSession(storage).readForGateway(created.record))?.value.settings
    ).toEqual(input);
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

  it('hides credentials but retains API recovery after manual lock and worker restart', async () => {
    const storage = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'session-password');
    const session = new ExtensionCredentialVaultSession(storage, () => 1_000);
    await session.activate({ ...created, record: created.record }, created.sessionKeyMaterial);

    const retained = structuredClone(storage.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]);
    await session.lock('manual');

    expect(session.lockReason).toBe('manual');
    expect(storage.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toEqual({
      ...(retained as Record<string, unknown>),
      viewLocked: true
    });
    expect(await session.read(created.record)).toBeUndefined();
    for (const worker of [session, new ExtensionCredentialVaultSession(storage)]) {
      expect(await worker.read(created.record)).toBeUndefined();
      const active = await worker.readForGateway(created.record, true, 2_000);
      expect(active).toMatchObject({ lastActivityAt: 2_000, value: { settings } });
      expect(active?.value.key.extractable).toBe(false);
      expect(worker.lockReason).toBe('manual');
      expect(await worker.read(created.record, true)).toBeUndefined();
      expect(worker.lockReason).toBe('manual');
    }
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
    const worker = new ExtensionCredentialVaultSession(local);
    expect(await worker.read(created.record)).toBeUndefined();
    expect(await worker.readForGateway(created.record)).toBeUndefined();
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
    expect(
      await new ExtensionCredentialVaultSession(local, Date.now, legacy).readForGateway(created.record)
    ).toBeUndefined();
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toEqual({
      schemaVersion: 2,
      state: 'locked'
    });
  });

  it('does not resurrect a manually locked session from a concurrent read or late save', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const vault = new ExtensionCredentialVaultSession(local);
    await vault.activate(created, created.sessionKeyMaterial);
    const reading = vault.read(created.record);
    const locking = vault.lock();
    await Promise.all([reading, locking]);
    // An already-running API request may save its response without revealing UI.
    await vault.update(created);
    expect(await new ExtensionCredentialVaultSession(local).read(created.record)).toBeUndefined();
    expect((await vault.readForGateway(created.record))?.value.settings).toEqual(settings);
  });

  it('clears in-memory access after local data is removed', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const vault = new ExtensionCredentialVaultSession(local);
    await vault.activate(created, created.sessionKeyMaterial);
    await local.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    expect(await vault.read(created.record)).toBeUndefined();
    expect(await vault.readForGateway(created.record)).toBeUndefined();
    await expect(vault.protection(created.record)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
    await expect(vault.update(created)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
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

  it('reseals API refreshes without removing the view lock, including after restart', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const worker = new ExtensionCredentialVaultSession(local);
    await worker.activate(created, created.sessionKeyMaterial);
    await worker.lock();
    const refreshed = { ...settings, accessToken: 'refreshed-private-token' };
    const record = await resealCredentialVault(created.record, refreshed, created.key);
    const restarted = new ExtensionCredentialVaultSession(local);
    await restarted.update({ ...created, settings: refreshed, record }, 3_000, { encrypted: record });
    expect(local.values.encrypted).toEqual(record);
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: true });
    expect(await restarted.read(record, true)).toBeUndefined();
    expect((await restarted.readForGateway(record, true, 4_000))?.value.settings).toEqual(refreshed);
    expect(restarted.lockReason).toBe('manual');
    expect(await new ExtensionCredentialVaultSession(local).read(record)).toBeUndefined();
    expect((await new ExtensionCredentialVaultSession(local).readForGateway(record))?.value.settings).toEqual(
      refreshed
    );
    expect(JSON.stringify(local.values)).not.toContain(refreshed.accessToken);
  });

  it('allows background protection while hidden and reveals UI only after explicit unlock', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const worker = new ExtensionCredentialVaultSession(local);
    await worker.activate(created, created.sessionKeyMaterial);
    await worker.lock();
    const protection = await worker.protection(created.record);
    expect(protection.sessionKeyMaterial).toBe(created.sessionKeyMaterial);
    expect(protection.key.extractable).toBe(false);
    expect(worker.lockReason).toBe('manual');
    expect(await worker.read(created.record)).toBeUndefined();
    const unlocked = await unlockCredentialVault(created.record, '123456');
    await worker.activate({ ...unlocked, record: created.record }, unlocked.sessionKeyMaterial);
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: false });
    expect((await worker.read(created.record))?.value.settings).toEqual(settings);
    expect(worker.lockReason).toBeNull();
    expect((await new ExtensionCredentialVaultSession(local).read(created.record))?.value.settings).toEqual(
      settings
    );
  });

  it('never includes raw recovery material or passphrase in snapshots, even immediately after activate', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, 'private-passphrase');
    const worker = new ExtensionCredentialVaultSession(local);
    await worker.activate(created, created.sessionKeyMaterial);
    for (const snapshot of [await worker.read(created.record), await worker.readForGateway(created.record)]) {
      expect(snapshot).toBeDefined();
      expect(snapshot?.value).not.toHaveProperty('sessionKeyMaterial');
      expect(JSON.stringify(snapshot)).not.toContain(created.sessionKeyMaterial);
      expect(JSON.stringify(snapshot)).not.toContain('private-passphrase');
      if (!snapshot) throw new Error('expected active snapshot');
      await expect(crypto.subtle.exportKey('raw', snapshot.value.key)).rejects.toThrow();
    }
    await worker.lock();
    expect(await worker.read(created.record)).toBeUndefined();
    const serialized = JSON.stringify(local.values);
    for (const secret of ['private-passphrase', settings.appKey, settings.appSecret, settings.accessToken])
      expect(serialized).not.toContain(secret);
    // readForGateway/protection intentionally expose secrets only to background
    // code. Runtime response filtering is the integration owner's responsibility.
  });

  it('reads old schema1 records with no flag and migrates them through the gateway path', async () => {
    const local = new MemorySessionStorage();
    const legacy = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
    const stored = legacy.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY] as Record<string, unknown>;
    Reflect.deleteProperty(stored, 'viewLocked');
    const worker = new ExtensionCredentialVaultSession(local, () => 2_000, legacy);
    expect((await worker.readForGateway(created.record, true))?.value.settings).toEqual(settings);
    expect(legacy.values).toEqual({});
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: false });
    expect((await worker.read(created.record))?.value.settings).toEqual(settings);
  });

  it('requires a passphrase once for schema2 markers despite an available legacy session', async () => {
    const local = new MemorySessionStorage();
    const legacy = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
    local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY] = { schemaVersion: 2, state: 'locked' };
    const worker = new ExtensionCredentialVaultSession(local, Date.now, legacy);
    expect(await worker.readForGateway(created.record)).toBeUndefined();
    expect(await worker.read(created.record)).toBeUndefined();
    await expect(worker.update(created)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
    expect(worker.lockReason).toBe('manual');
    const unlocked = await unlockCredentialVault(created.record, '123456');
    await worker.activate({ ...unlocked, record: created.record }, unlocked.sessionKeyMaterial);
    expect(legacy.values).toEqual({});
    expect(
      (await new ExtensionCredentialVaultSession(local).readForGateway(created.record))?.value.settings
    ).toEqual(settings);
  });

  it('uses the legacy locked marker when retained recovery is invalid, without importing temporary keys', async () => {
    const created = await createCredentialVault(settings, '123456');
    for (const field of ['sessionKeyMaterial', 'recordCiphertext', 'viewLocked']) {
      const local = new MemorySessionStorage();
      const legacy = new MemorySessionStorage();
      await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
      await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
      const stored = local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY] as Record<string, unknown>;
      if (field === 'sessionKeyMaterial') Reflect.deleteProperty(stored, field);
      if (field === 'recordCiphertext') stored[field] = btoa('x'.repeat(64));
      if (field === 'viewLocked') stored[field] = 'false';
      const worker = new ExtensionCredentialVaultSession(local, Date.now, legacy);
      await worker.lock();
      expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toEqual({
        schemaVersion: 2,
        state: 'locked'
      });
      expect(legacy.values).toEqual({});
      expect(await worker.read(created.record)).toBeUndefined();
      expect(await worker.readForGateway(created.record)).toBeUndefined();
    }
  });

  it.each([undefined, null, 'true', 'false', 0, 1, {}, []])(
    'rejects a present non-boolean viewLocked flag: %j',
    async (viewLocked) => {
      const created = await createCredentialVault(settings, '123456');
      for (const gateway of [false, true]) {
        const local = new MemorySessionStorage();
        const worker = new ExtensionCredentialVaultSession(local);
        await worker.activate(created, created.sessionKeyMaterial);
        (local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY] as Record<string, unknown>).viewLocked =
          viewLocked;
        expect(
          await (gateway ? worker.readForGateway(created.record) : worker.read(created.record))
        ).toBeUndefined();
        expect(local.values).toEqual({});
      }
    }
  );

  it.each(['key', 'ciphertext', 'timestamp', 'salt'])(
    'rejects corrupt %s recovery material without falling back to a legacy session',
    async (field) => {
      const local = new MemorySessionStorage();
      const legacy = new MemorySessionStorage();
      const created = await createCredentialVault(settings, '123456');
      await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
      const worker = new ExtensionCredentialVaultSession(local, Date.now, legacy);
      await worker.activate(created, created.sessionKeyMaterial);
      // Recreate a stale legacy entry to verify invalid local data never falls back.
      await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
      const stored = local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY] as Record<string, unknown>;
      if (field === 'key') stored.sessionKeyMaterial = btoa('x'.repeat(32));
      if (field === 'ciphertext') stored.recordCiphertext = btoa('x'.repeat(64));
      if (field === 'timestamp') stored.lastActivityAt = -1;
      if (field === 'salt') stored.recordSalt = 'not-base64';
      expect(await worker.readForGateway(created.record)).toBeUndefined();
      expect(await worker.read(created.record)).toBeUndefined();
    }
  );

  it('does not destroy a newer hidden recovery record on stale reads or wrong-key updates', async () => {
    const local = new MemorySessionStorage();
    const original = await createCredentialVault(settings, '123456');
    const newer = await createCredentialVault({ ...settings, accessToken: 'newer-token' }, '654321');
    const worker = new ExtensionCredentialVaultSession(local);
    await worker.activate(newer, newer.sessionKeyMaterial);
    await worker.lock();
    const retained = structuredClone(local.values);
    expect(await worker.readForGateway(original.record)).toBeUndefined();
    await expect(worker.update(original)).rejects.toThrow();
    expect(local.values).toEqual(retained);
    expect((await worker.readForGateway(newer.record))?.value.settings).toEqual(newer.settings);
    expect(worker.lockReason).toBe('manual');
    expect(await worker.read(newer.record)).toBeUndefined();
  });

  it('uses the latest stored lock flag for updates and touches from another worker', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    const stale = new ExtensionCredentialVaultSession(local);
    const locker = new ExtensionCredentialVaultSession(local);
    await stale.activate(created, created.sessionKeyMaterial);
    await locker.lock();
    await stale.update(created);
    expect(await stale.read(created.record, true)).toBeUndefined();
    expect((await stale.readForGateway(created.record, true, 5_000))?.lastActivityAt).toBe(5_000);
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: true });
    expect(stale.lockReason).toBe('manual');
  });

  it.each(['read', 'gateway', 'update', 'protection'])(
    'does not resurrect data cleared while %s is loading',
    async (operation) => {
      const local = new MemorySessionStorage();
      const created = await createCredentialVault(settings, '123456');
      await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
      let cleared = false;
      const racing: ExtensionCredentialVaultSessionStorage = {
        get: async (key) => {
          const result = await local.get(key);
          if (!cleared) {
            cleared = true;
            await local.remove(key);
          }
          return result;
        },
        set: (items) => local.set(items),
        remove: (key) => local.remove(key)
      };
      const worker = new ExtensionCredentialVaultSession(racing);
      if (operation === 'read') expect(await worker.read(created.record, true)).toBeUndefined();
      if (operation === 'gateway') expect(await worker.readForGateway(created.record, true)).toBeUndefined();
      if (operation === 'update')
        await expect(worker.update(created)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
      if (operation === 'protection')
        await expect(worker.protection(created.record)).rejects.toThrow('CREDENTIAL_VAULT_LOCKED');
      expect(local.values).toEqual({});
      expect(await worker.read(created.record)).toBeUndefined();
      expect(await worker.readForGateway(created.record)).toBeUndefined();
    }
  );

  it('observes a manual lock that lands while a UI touch is loading', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
    let locked = false;
    const racing: ExtensionCredentialVaultSessionStorage = {
      get: async (key) => {
        const result = await local.get(key);
        if (!locked) {
          locked = true;
          await new ExtensionCredentialVaultSession(local).lock();
        }
        return result;
      },
      set: (items) => local.set(items),
      remove: (key) => local.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(racing);
    expect(await worker.read(created.record, true)).toBeUndefined();
    expect(worker.lockReason).toBe('manual');
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: true });
    expect((await worker.readForGateway(created.record))?.value.settings).toEqual(settings);
  });

  it('does not migrate a temporary recovery record cleared while it is being restored', async () => {
    const local = new MemorySessionStorage();
    const legacy = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(legacy).activate(created, created.sessionKeyMaterial);
    let cleared = false;
    const racingLegacy: ExtensionCredentialVaultSessionStorage = {
      get: async (key) => {
        const result = await legacy.get(key);
        if (!cleared) {
          cleared = true;
          await legacy.remove(key);
        }
        return result;
      },
      set: (items) => legacy.set(items),
      remove: (key) => legacy.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(local, Date.now, racingLegacy);
    expect(await worker.readForGateway(created.record, true)).toBeUndefined();
    expect(local.values).toEqual({});
    expect(legacy.values).toEqual({});
  });

  it('does not return a snapshot if local recovery is cleared as a touch finishes', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
    const racing: ExtensionCredentialVaultSessionStorage = {
      get: (key) => local.get(key),
      set: async (items) => {
        await local.set(items);
        await local.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      },
      remove: (key) => local.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(racing);
    expect(await worker.read(created.record, true)).toBeUndefined();
    expect(await worker.readForGateway(created.record)).toBeUndefined();
    expect(local.values).toEqual({});
  });

  it('does not return a UI touch when persistence fails for an unlocked session', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
    const broken: ExtensionCredentialVaultSessionStorage = {
      get: (key) => local.get(key),
      set: () => Promise.reject(new Error('storage failed')),
      remove: (key) => local.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(broken);
    await expect(worker.read(created.record, true)).rejects.toThrow('storage failed');
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: false });
  });

  it('rejects a failed manual lock write without deleting API recovery or revealing UI in memory', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
    const broken: ExtensionCredentialVaultSessionStorage = {
      get: (key) => local.get(key),
      set: () => Promise.reject(new Error('storage failed')),
      remove: (key) => local.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(broken);
    const retained = structuredClone(local.values);
    await expect(worker.lock()).rejects.toThrow('storage failed');
    expect(worker.lockReason).toBe('manual');
    expect(await worker.read(created.record)).toBeUndefined();
    expect((await worker.readForGateway(created.record))?.value.settings).toEqual(settings);
    expect(local.values).toEqual(retained);
    expect(local.values[CREDENTIAL_VAULT_SESSION_STORAGE_KEY]).toMatchObject({ viewLocked: false });
    // The rejected operation is not a durable lock: callers must show the
    // persistence error, not claim success across a worker/browser restart.
  });

  it('never attempts to remove retained keys as a fallback for failed lock persistence', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
    let removals = 0;
    const retained = structuredClone(local.values);
    const broken: ExtensionCredentialVaultSessionStorage = {
      get: (key) => local.get(key),
      set: () => Promise.reject(new Error('storage failed')),
      remove: () => {
        removals += 1;
        return Promise.reject(new Error('remove failed'));
      }
    };
    const worker = new ExtensionCredentialVaultSession(broken);
    await expect(worker.lock()).rejects.toThrow('storage failed');
    expect(await worker.read(created.record)).toBeUndefined();
    await expect(worker.activate(created, created.sessionKeyMaterial)).rejects.toThrow('storage failed');
    expect(await worker.read(created.record)).toBeUndefined();
    expect(worker.lockReason).toBe('manual');
    expect(removals).toBe(0);
    expect(local.values).toEqual(retained);
  });

  it('does not replace valid recovery with a legacy marker if the lock recheck fails', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    await new ExtensionCredentialVaultSession(local).activate(created, created.sessionKeyMaterial);
    const retained = structuredClone(local.values);
    let reads = 0;
    const unstable: ExtensionCredentialVaultSessionStorage = {
      get: (key) => {
        reads += 1;
        return reads === 2 ? Promise.reject(new Error('read failed')) : local.get(key);
      },
      set: (items) => local.set(items),
      remove: (key) => local.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(unstable);
    await expect(worker.lock()).rejects.toThrow('read failed');
    expect(local.values).toEqual(retained);
    expect(await worker.read(created.record)).toBeUndefined();
    expect((await worker.readForGateway(created.record))?.value.settings).toEqual(settings);
  });

  it.each(['read', 'gateway', 'update'])(
    'does not return successful %s results when required persistence fails',
    async (operation) => {
      const local = new MemorySessionStorage();
      const created = await createCredentialVault(settings, '123456');
      const worker = new ExtensionCredentialVaultSession(local);
      await worker.activate(created, created.sessionKeyMaterial);
      await worker.lock();
      const retained = structuredClone(local.values);
      const broken: ExtensionCredentialVaultSessionStorage = {
        get: (key) => local.get(key),
        set: () => Promise.reject(new Error('storage failed')),
        remove: (key) => local.remove(key)
      };
      const restarted = new ExtensionCredentialVaultSession(broken);
      if (operation === 'read') expect(await restarted.read(created.record, true)).toBeUndefined();
      if (operation === 'gateway')
        await expect(restarted.readForGateway(created.record, true)).rejects.toThrow('storage failed');
      if (operation === 'update') await expect(restarted.update(created)).rejects.toThrow('storage failed');
      expect(local.values).toEqual(retained);
      expect(await restarted.read(created.record)).toBeUndefined();
      expect(restarted.lockReason).toBe('manual');
    }
  );

  it('rejects unavailable storage without returning cached credentials', async () => {
    const local = new MemorySessionStorage();
    const created = await createCredentialVault(settings, '123456');
    let failed = false;
    const unstable: ExtensionCredentialVaultSessionStorage = {
      get: (key) => (failed ? Promise.reject(new Error('read failed')) : local.get(key)),
      set: (items) => local.set(items),
      remove: (key) => local.remove(key)
    };
    const worker = new ExtensionCredentialVaultSession(unstable);
    await worker.activate(created, created.sessionKeyMaterial);
    failed = true;
    await expect(worker.read(created.record)).rejects.toThrow('read failed');
    await expect(worker.readForGateway(created.record)).rejects.toThrow('read failed');
    await expect(worker.protection(created.record)).rejects.toThrow('read failed');
    await expect(worker.update(created)).rejects.toThrow('read failed');
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
