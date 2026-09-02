import {
  CredentialVaultSession,
  credentialVaultSessionTiming,
  restoreCredentialVaultSession,
  type CredentialVaultRecord,
  type CredentialVaultSessionSnapshot,
  type CredentialVaultSessionValue
} from '@one-vegetable/core';

export const CREDENTIAL_VAULT_SESSION_STORAGE_KEY = 'one-vegetable-credential-vault-session-v1';
const SESSION_SCHEMA_VERSION = 1;

interface StoredCredentialVaultSession {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
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

export class ExtensionCredentialVaultSession {
  readonly #session = new CredentialVaultSession();
  #sessionKeyMaterial: string | null = null;

  constructor(
    private readonly storage: ExtensionCredentialVaultSessionStorage,
    private readonly clock: () => number = Date.now
  ) {}

  get lockReason(): CredentialVaultSession['lockReason'] {
    return this.#session.lockReason;
  }

  async activate(
    value: CredentialVaultSessionValue,
    sessionKeyMaterial: string,
    now = this.clock()
  ): Promise<void> {
    this.#session.activate(value, now);
    this.#sessionKeyMaterial = sessionKeyMaterial;
    await this.#persist(value.record, sessionKeyMaterial, now);
  }

  async update(value: CredentialVaultSessionValue, now = this.clock()): Promise<void> {
    const keyMaterial = this.#sessionKeyMaterial;
    if (!keyMaterial) throw new Error('凭证会话密钥不可用');
    await this.activate(value, keyMaterial, now);
  }

  async lock(reason: 'idle' | 'manual' = 'manual'): Promise<void> {
    this.#session.lock(reason);
    this.#sessionKeyMaterial = null;
    await this.storage.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
  }

  async read(
    record: CredentialVaultRecord,
    touch = false,
    now = this.clock()
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    let snapshot = this.#session.read(record, touch, now);
    if (!snapshot && this.#session.lockReason !== null) {
      await this.storage.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      this.#sessionKeyMaterial = null;
      return undefined;
    }
    snapshot ??= await this.#restore(record, touch, now);
    if (snapshot && touch) {
      const keyMaterial = this.#sessionKeyMaterial;
      if (!keyMaterial) {
        await this.lock('manual');
        return undefined;
      }
      await this.#persist(record, keyMaterial, snapshot.lastActivityAt);
    }
    return snapshot;
  }

  async #restore(
    record: CredentialVaultRecord,
    touch: boolean,
    now: number
  ): Promise<CredentialVaultSessionSnapshot | undefined> {
    const stored = await this.storage.get(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
    const value = stored[CREDENTIAL_VAULT_SESSION_STORAGE_KEY];
    if (value === undefined) return undefined;
    if (!isStoredSession(value) || !matchesRecord(value, record)) {
      await this.storage.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      return undefined;
    }
    try {
      const unlocked = await restoreCredentialVaultSession(record, value.sessionKeyMaterial);
      const timing = credentialVaultSessionTiming(unlocked.policy, value.lastActivityAt, now);
      if (timing.expired) {
        await this.lock('idle');
        return undefined;
      }
      this.#session.activate({ ...unlocked, record }, value.lastActivityAt);
      this.#sessionKeyMaterial = value.sessionKeyMaterial;
      return this.#session.read(record, touch, now);
    } catch {
      await this.storage.remove(CREDENTIAL_VAULT_SESSION_STORAGE_KEY);
      this.#sessionKeyMaterial = null;
      return undefined;
    }
  }

  #persist(record: CredentialVaultRecord, sessionKeyMaterial: string, lastActivityAt: number): Promise<void> {
    const value: StoredCredentialVaultSession = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      recordSalt: record.kdf.salt,
      recordIv: record.cipher.iv,
      recordCiphertext: record.cipher.ciphertext,
      sessionKeyMaterial,
      lastActivityAt
    };
    return this.storage.set({ [CREDENTIAL_VAULT_SESSION_STORAGE_KEY]: value });
  }
}

function isStoredSession(value: unknown): value is StoredCredentialVaultSession {
  return (
    isRecord(value) &&
    value.schemaVersion === SESSION_SCHEMA_VERSION &&
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
