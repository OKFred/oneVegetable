import {
  ALIBABA_GATEWAY,
  SETTINGS_STORAGE_KEY,
  createCredentialVault,
  createCredentialVaultFromProtection,
  inspectCredentialStorage,
  restoreCredentialVaultSession,
  unlockCredentialVault,
  type CredentialVaultRecord,
  type GatewaySettings
} from '@one-vegetable/core';
import type { OpenAlibabaAuthorizationVault } from '@one-vegetable/core/alibaba-authorization-vault';
import type { ExtensionCredentialVaultSession } from './credential-vault-session';

export const DEVICE_PROTECTION_KEY = 'one-vegetable-device-protection-v1';
export interface AuthorizationProtectionKey {
  key: CryptoKey;
  sessionKeyMaterial: string;
  salt: string;
}
interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Only used behind trusted-page checks and the background's serialized vault queue. */
export class AuthorizationProtection {
  constructor(
    private readonly storage: Storage,
    private readonly session: ExtensionCredentialVaultSession
  ) {}

  async prepare(passphrase: string): Promise<AuthorizationProtectionKey> {
    const stored = await this.storage.get(SETTINGS_STORAGE_KEY);
    const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY]);
    if (state.kind === 'invalid') throw new Error('CREDENTIAL_VAULT_INVALID');
    if (state.kind === 'empty' || state.kind === 'legacy') {
      await this.create(
        state.kind === 'legacy'
          ? state.settings
          : { appKey: '', appSecret: '', accessToken: '', endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' },
        passphrase
      );
    } else if (!(await this.session.read(state.record))) {
      const device = await this.deviceKey(state.record);
      const unlocked =
        passphrase !== ''
          ? await unlockCredentialVault(state.record, passphrase)
          : device
            ? await restoreCredentialVaultSession(state.record, device)
            : undefined;
      if (!unlocked) throw new Error('CREDENTIAL_VAULT_LOCKED');
      await this.session.activate({ ...unlocked, record: state.record }, unlocked.sessionKeyMaterial);
    }
    const current = inspectCredentialStorage(
      (await this.storage.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY]
    );
    if (current.kind !== 'vault') throw new Error('CREDENTIAL_VAULT_INVALID');
    return this.session.protection(current.record);
  }

  async create(settings: GatewaySettings, passphrase: string) {
    // Blank means a random device key, never a known empty-password key.
    const generated = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const created = await createCredentialVault(settings, passphrase === '' ? generated : passphrase);
    await this.session.activate(created, created.sessionKeyMaterial, undefined, {
      [SETTINGS_STORAGE_KEY]: created.record,
      [DEVICE_PROTECTION_KEY]:
        passphrase === ''
          ? {
              schemaVersion: 1,
              salt: created.record.kdf.salt,
              sessionKeyMaterial: created.sessionKeyMaterial
            }
          : null
    });
    return created;
  }

  /** Adopt an existing tool's authenticated key, without asking for a second password. */
  async adopt(vault: OpenAlibabaAuthorizationVault): Promise<void> {
    const state = inspectCredentialStorage(
      (await this.storage.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY]
    );
    if (state.kind !== 'empty') return; // Never replace an independently protected older workbench.
    const created = await createCredentialVaultFromProtection(
      { appKey: '', appSecret: '', accessToken: '', endpoint: ALIBABA_GATEWAY, signMethod: 'hmac' },
      { key: vault.key, sessionKeyMaterial: vault.sessionKeyMaterial, salt: vault.record.salt }
    );
    await this.session.activate(created, created.sessionKeyMaterial, undefined, {
      [SETTINGS_STORAGE_KEY]: created.record,
      [DEVICE_PROTECTION_KEY]: null
    });
  }

  async deviceKey(record: CredentialVaultRecord): Promise<string | undefined> {
    const value = (await this.storage.get(DEVICE_PROTECTION_KEY))[DEVICE_PROTECTION_KEY];
    if (typeof value !== 'object' || value === null) return undefined;
    const candidate = value as Record<string, unknown>;
    return candidate.schemaVersion === 1 &&
      candidate.salt === record.kdf.salt &&
      typeof candidate.sessionKeyMaterial === 'string' &&
      /^[A-Za-z0-9+/]{43}=$/u.test(candidate.sessionKeyMaterial)
      ? candidate.sessionKeyMaterial
      : undefined;
  }
}
