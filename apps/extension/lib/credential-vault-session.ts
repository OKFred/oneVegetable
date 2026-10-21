import {
  CredentialVaultSession,
  CREDENTIAL_VAULT_ITERATIONS,
  CREDENTIAL_VAULT_VERSION,
  isCredentialVaultRecord,
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
  viewLocked?: boolean;
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
  #viewLocked = false;
  #allowLegacyMigration = true;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ExtensionCredentialVaultSessionStorage,
    private readonly clock: () => number = Date.now,
    private readonly legacySessionStorage?: ExtensionCredentialVaultSessionStorage
  ) {}

  get lockReason(): CredentialVaultSession['lockReason'] {
    return this.#viewLocked ? 'manual' : this.#session.lockReason;
  }

  activate(
    value: CredentialVaultSessionValue,
    sessionKeyMaterial: string,
    now = this.clock(),
    additionalItems: Record<string, unknown> = {}
  ): Promise<void> {
    return this.#serial(async () => {
      this.#allowLegacyMigration = false;
      // Commit before reporting success; a failed save must never appear remembered.
      await this.#persist(value.record, sessionKeyMaterial, now, false, additionalItems);
      await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      // Only an explicit, successfully persisted unlock may reveal credentials.
      this.#viewLocked = false;
      this.#activate(value, sessionKeyMaterial, now);
    });
  }

  update(
    value: CredentialVaultSessionValue,
    now = this.clock(),
    additionalItems: Record<string, unknown> = {}
  ): Promise<void> {
    return this.#serial(async () => {
      const stored = await this.#readStored();
      this.#allowLegacyMigration = false;
      // Recover from storage, not a UI session that manual lock deliberately clears.
      if (!isStoredSession(stored)) throw new Error('CREDENTIAL_VAULT_LOCKED');
      this.#viewLocked ||= stored.viewLocked === true;
      await restoreCredentialVaultSession(storedRecord(stored), stored.sessionKeyMaterial);
      const unlocked = await restoreCredentialVaultSession(value.record, stored.sessionKeyMaterial);
      const current = await this.#current(stored);
      if (!current) throw new Error('CREDENTIAL_VAULT_LOCKED');
      await this.#persist(value.record, current.sessionKeyMaterial, now, this.#viewLocked, additionalItems);
      this.#activate({ ...unlocked, record: value.record }, current.sessionKeyMaterial, now);
    });
  }

  lock(_reason: 'idle' | 'manual' = 'manual'): Promise<void> {
    return this.#serial(async () => {
      this.#viewLocked = true;
      this.#allowLegacyMigration = false;
      this.#forget();
      const stored = await this.#readStored();
      let retained: StoredCredentialVaultSession | undefined;
      if (isStoredSession(stored)) {
        let authenticated = false;
        try {
          await restoreCredentialVaultSession(storedRecord(stored), stored.sessionKeyMaterial);
          authenticated = true;
        } catch {
          // Corrupt recovery material is not an API-capable retained session.
        }
        if (authenticated) {
          retained = await this.#current(stored);
          // A failed/racing recheck is not evidence that recovery is absent.
          if (!retained) throw new Error('CREDENTIAL_VAULT_LOCKED');
        }
      }
      // One write retains the encrypted recovery and sets the UI gate together.
      // Without valid local recovery, block legacy temporary-session migration.
      // A failed write rejects: never delete API recovery as a lock fallback or
      // report a durable lock that storage did not acknowledge.
      await this.storage.set({
        [CREDENTIAL_VAULT_SESSION_STORAGE_KEY]: retained
          ? { ...retained, viewLocked: true }
          : { schemaVersion: 2, state: 'locked' }
      });
      await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    });
  }

  read(
    record: CredentialVaultRecord,
    touch = false,
    now = this.clock()
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    return this.#read(record, touch, now, false);
  }

  /** Background signing only. Never forward this snapshot to a page/runtime response. */
  readForGateway(
    record: CredentialVaultRecord,
    touch = false,
    now = this.clock()
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    return this.#read(record, touch, now, true);
  }

  #read(
    record: CredentialVaultRecord,
    touch: boolean,
    now: number,
    forGateway: boolean
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    return this.#serial(() => this.#readActive(record, touch, now, forGateway));
  }

  async #readActive(
    record: CredentialVaultRecord,
    touch: boolean,
    now: number,
    forGateway: boolean
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    let stored = await this.#readStored();
    let migrating = false;
    if (stored !== undefined) this.#allowLegacyMigration = false;
    if (stored === undefined && this.#allowLegacyMigration && this.legacySessionStorage) {
      stored = (await this.legacySessionStorage.get(CREDENTIAL_VAULT_SESSION_STORAGE_KEY))[
        CREDENTIAL_VAULT_SESSION_STORAGE_KEY
      ];
      migrating = stored !== undefined;
    }
    if (isRecord(stored) && stored.schemaVersion === 2 && stored.state === 'locked') {
      this.#viewLocked = true;
      this.#forget();
      return undefined;
    }
    if (!isStoredSession(stored)) {
      this.#forget();
      if (stored !== undefined) await this.#discard();
      return undefined;
    }
    this.#viewLocked ||= stored.viewLocked === true;
    if (
      (!forGateway && this.#viewLocked) ||
      !isCredentialVaultRecord(record) ||
      !matchesRecord(stored, record)
    ) {
      // An older in-flight caller must not erase a newer valid saved session.
      this.#forget();
      return undefined;
    }
    let snapshot = this.#session.read(record, false, now);
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
    }
    // Decryption yields: a clear or another caller's lock must win before
    // returning plaintext or writing a touch/migration over the current gate.
    const current = await this.#current(stored, migrating);
    if (!current || (!forGateway && this.#viewLocked)) {
      this.#forget();
      return undefined;
    }
    snapshot = this.#session.read(record, touch, now);
    if (snapshot && (migrating || touch)) {
      await this.#persist(record, current.sessionKeyMaterial, snapshot.lastActivityAt, this.#viewLocked);
      this.#allowLegacyMigration = false;
      await this.legacySessionStorage?.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      if (!(await this.#current(current)) || (!forGateway && this.#viewLocked)) {
        this.#forget();
        return undefined;
      }
    }
    return snapshot;
  }

  /** Background-only bridge. Never include this result in runtime/page responses. */
  async protection(record: CredentialVaultRecord) {
    return this.#serial(async () => {
      // Stay in the same queue item while checking and returning key material.
      const active = await this.#readActive(record, false, this.clock(), true);
      if (!active || !this.#sessionKeyMaterial) throw new Error('CREDENTIAL_VAULT_LOCKED');
      return { key: active.value.key, sessionKeyMaterial: this.#sessionKeyMaterial, salt: record.kdf.salt };
    });
  }

  #activate(value: CredentialVaultSessionValue, key: string, now: number): void {
    // Old encrypted idle policies remain readable but are no longer enforced.
    this.#session.activate(
      { record: value.record, key: value.key, settings: value.settings, policy: { idleTimeoutMinutes: 0 } },
      now
    );
    this.#session.lockReason = this.#viewLocked ? 'manual' : null;
    this.#sessionKeyMaterial = key;
  }

  #forget(): void {
    this.#session.lock('manual');
    this.#session.lockReason = this.#viewLocked ? 'manual' : null;
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

  async #current(
    expected: StoredCredentialVaultSession,
    migrating = false
  ): Promise<StoredCredentialVaultSession | undefined> {
    const current = await this.#readStored();
    if (migrating && current === undefined && this.legacySessionStorage) {
      const legacy = (await this.legacySessionStorage.get(CREDENTIAL_VAULT_SESSION_STORAGE_KEY))[
        CREDENTIAL_VAULT_SESSION_STORAGE_KEY
      ];
      if (isStoredSession(legacy)) {
        this.#viewLocked ||= legacy.viewLocked === true;
        if (
          matchesRecord(legacy, storedRecord(expected)) &&
          legacy.sessionKeyMaterial === expected.sessionKeyMaterial
        )
          return legacy;
      }
    }
    if (isRecord(current) && current.schemaVersion === 2 && current.state === 'locked')
      this.#viewLocked = true;
    if (isStoredSession(current)) {
      this.#viewLocked ||= current.viewLocked === true;
      if (
        matchesRecord(current, storedRecord(expected)) &&
        current.sessionKeyMaterial === expected.sessionKeyMaterial
      )
        return current;
    }
    this.#forget();
    return undefined;
  }

  #persist(
    record: CredentialVaultRecord,
    sessionKeyMaterial: string,
    lastActivityAt: number,
    viewLocked: boolean,
    additionalItems: Record<string, unknown> = {}
  ): Promise<void> {
    const value: StoredCredentialVaultSession = {
      schemaVersion: 1,
      recordSalt: record.kdf.salt,
      recordIv: record.cipher.iv,
      recordCiphertext: record.cipher.ciphertext,
      sessionKeyMaterial,
      lastActivityAt,
      viewLocked
    };
    return this.storage.set({ ...additionalItems, [CREDENTIAL_VAULT_SESSION_STORAGE_KEY]: value });
  }

  #serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(action).catch((error: unknown) => {
      this.#forget();
      throw error;
    });
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
    isKeyMaterial(value.sessionKeyMaterial) &&
    typeof value.lastActivityAt === 'number' &&
    Number.isSafeInteger(value.lastActivityAt) &&
    value.lastActivityAt >= 0 &&
    (!('viewLocked' in value) || typeof value.viewLocked === 'boolean') &&
    isCredentialVaultRecord(
      storedRecord({
        recordSalt: value.recordSalt,
        recordIv: value.recordIv,
        recordCiphertext: value.recordCiphertext
      })
    )
  );
}

function storedRecord(
  value: Pick<StoredCredentialVaultSession, 'recordSalt' | 'recordIv' | 'recordCiphertext'>
): CredentialVaultRecord {
  return {
    version: CREDENTIAL_VAULT_VERSION,
    format: 'PBKDF2-HMAC-SHA256/AES-256-GCM',
    kdf: { salt: value.recordSalt, iterations: CREDENTIAL_VAULT_ITERATIONS, hash: 'SHA-256' },
    cipher: { iv: value.recordIv, ciphertext: value.recordCiphertext }
  };
}

function isKeyMaterial(value: string): boolean {
  try {
    return atob(value).length === 32;
  } catch {
    return false;
  }
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
