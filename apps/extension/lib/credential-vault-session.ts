import {
  CredentialVaultSession,
  restoreCredentialVaultSession,
  type CredentialVaultRecord,
  type CredentialVaultSessionSnapshot,
  type CredentialVaultSessionValue
} from '@one-vegetable/core';

import { CREDENTIAL_VAULT_SESSION_STORAGE_KEY } from './credential-vault-storage';
export { CREDENTIAL_VAULT_SESSION_STORAGE_KEY } from './credential-vault-storage';

interface StoredCredentialVaultSession {
  schemaVersion: 1;
  recordSalt: string;
  recordIv: string;
  recordCiphertext: string;
  sessionKeyMaterial: string;
  lastActivityAt: number;
}

export interface ExtensionCredentialVaultSessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Local-device convenience, not protection against an offline profile reader.
 * Never store this recovery material in sync or return it in runtime responses.
 */
export class ExtensionCredentialVaultSession {
  readonly #session = new CredentialVaultSession();
  #sessionKeyMaterial: string | null = null;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ExtensionCredentialVaultSessionStorage,
    private readonly clock: () => number = Date.now,
    private readonly legacySessionStorage?: ExtensionCredentialVaultSessionStorage
  ) {}

  get lockReason(): CredentialVaultSession['lockReason'] {
    return this.#session.lockReason;
  }

  activate(
    value: CredentialVaultSessionValue,
    sessionKeyMaterial: string,
    now = this.clock()
  ): Promise<void> {
    return this.#serial(async () => {
      // Commit before reporting success; a failed save must never appear remembered.
      await this.#persist(value.record, sessionKeyMaterial, now);
      await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      this.#activate(value, sessionKeyMaterial, now);
    });
  }

  update(value: CredentialVaultSessionValue, now = this.clock()): Promise<void> {
    return this.#serial(async () => {
      const stored = await this.#readStored();
      const keyMaterial = this.#sessionKeyMaterial;
      // A concurrent clear/lock must not be undone by a late settings response.
      if (!keyMaterial || !isStoredSession(stored) || stored.sessionKeyMaterial !== keyMaterial)
        throw new Error('CREDENTIAL_VAULT_LOCKED');
      await this.#persist(value.record, keyMaterial, now);
      this.#activate(value, keyMaterial, now);
    });
  }

  lock(_reason: 'idle' | 'manual' = 'manual'): Promise<void> {
    return this.#serial(async () => {
      this.#session.lock('manual');
      this.#sessionKeyMaterial = null;
      // A content-free marker blocks migration from an old temporary session,
      // including if Chrome shuts down between these two storage writes.
      await this.storage.set({
        [CREDENTIAL_VAULT_SESSION_STORAGE_KEY]: { schemaVersion: 2, state: 'locked' }
      });
      await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    });
  }

  read(
    record: CredentialVaultRecord,
    touch = false,
    now = this.clock()
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    return this.#serial(async () => {
      let stored = await this.#readStored();
      let migrating = false;
      if (stored === undefined && this.legacySessionStorage) {
        stored = (await this.legacySessionStorage.get(CREDENTIAL_VAULT_SESSION_STORAGE_KEY))[
          CREDENTIAL_VAULT_SESSION_STORAGE_KEY
        ];
        migrating = stored !== undefined;
      }
      if (isRecord(stored) && stored.schemaVersion === 2 && stored.state === 'locked') {
        this.#forget('manual');
        return undefined;
      }
      if (!isStoredSession(stored)) {
        this.#forget();
        if (stored !== undefined) await this.#discard();
        return undefined;
      }
      if (!matchesRecord(stored, record)) {
        // An older in-flight caller must not erase a newer valid saved session.
        this.#forget();
        return undefined;
      }
      let snapshot = this.#session.read(record, touch, now);
      if (!snapshot || this.#sessionKeyMaterial !== stored.sessionKeyMaterial) {
        let unlocked;
        try {
          unlocked = await restoreCredentialVaultSession(record, stored.sessionKeyMaterial);
        } catch {
          this.#forget();
          await this.#discard();
          return undefined;
        }
        this.#activate({ ...unlocked, record }, stored.sessionKeyMaterial, stored.lastActivityAt);
        snapshot = this.#session.read(record, touch, now);
      }
      if (snapshot && (migrating || touch)) {
        await this.#persist(record, stored.sessionKeyMaterial, snapshot.lastActivityAt);
        await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      }
      return snapshot;
    });
  }

  #activate(value: CredentialVaultSessionValue, key: string, now: number): void {
    // Old encrypted idle policies remain readable but are no longer enforced.
    this.#session.activate({ ...value, policy: { idleTimeoutMinutes: 0 } }, now);
    this.#sessionKeyMaterial = key;
  }

  #forget(reason: 'manual' | null = null): void {
    this.#session.lock('manual');
    this.#session.lockReason = reason;
    this.#sessionKeyMaterial = null;
  }

  async #discard(): Promise<void> {
    await this.storage.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
  }

  async #readStored(): Promise<unknown> {
    return (await this.storage.get(CREDENTIAL_VAULT_SESSION_STORAGE_KEY))[
      CREDENTIAL_VAULT_SESSION_STORAGE_KEY
    ];
  }

  #persist(record: CredentialVaultRecord, sessionKeyMaterial: string, lastActivityAt: number): Promise<void> {
    const value: StoredCredentialVaultSession = {
      schemaVersion: 1,
      recordSalt: record.kdf.salt,
      recordIv: record.cipher.iv,
      recordCiphertext: record.cipher.ciphertext,
      sessionKeyMaterial,
      lastActivityAt
    };
    return this.storage.set({ [CREDENTIAL_VAULT_SESSION_STORAGE_KEY]: value });
  }

  #serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(action);
    this.#pending = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function isStoredSession(value: unknown): value is StoredCredentialVaultSession {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.recordSalt === 'string' &&
    typeof value.recordIv === 'string' &&
    typeof value.recordCiphertext === 'string' &&
    typeof value.sessionKeyMaterial === 'string' &&
    typeof value.lastActivityAt === 'number' &&
    Number.isSafeInteger(value.lastActivityAt) &&
    value.lastActivityAt >= 0
  );
}

function matchesRecord(value: StoredCredentialVaultSession, record: CredentialVaultRecord): boolean {
  return (
    value.recordSalt === record.kdf.salt &&
    value.recordIv === record.cipher.iv &&
    value.recordCiphertext === record.cipher.ciphertext
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
