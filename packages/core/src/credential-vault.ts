import { migrateGatewaySettings } from './settings-storage';
import type { GatewaySettings } from './types';

export const CREDENTIAL_VAULT_VERSION = 2;
export const CREDENTIAL_VAULT_ITERATIONS = 600_000;
export const CREDENTIAL_VAULT_MIN_PASSPHRASE_BYTES = 12;
export const CREDENTIAL_VAULT_MAX_PASSPHRASE_BYTES = 256;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_EXTRACTABLE = false;
const ADDITIONAL_DATA = new TextEncoder().encode('one-vegetable:v2:gateway-settings');

export interface CredentialVaultRecord {
  version: typeof CREDENTIAL_VAULT_VERSION;
  format: 'PBKDF2-HMAC-SHA256/AES-256-GCM';
  kdf: {
    salt: string;
    iterations: number;
    hash: 'SHA-256';
  };
  cipher: {
    iv: string;
    ciphertext: string;
  };
}

export interface UnlockedCredentialVault {
  key: CryptoKey;
  settings: GatewaySettings;
}

export type CredentialStorageState =
  | { kind: 'empty' }
  | { kind: 'legacy'; settings: GatewaySettings }
  | { kind: 'vault'; record: CredentialVaultRecord }
  | { kind: 'invalid' };

export class CredentialVaultError extends Error {
  constructor(
    public readonly code:
      'PASSPHRASE_TOO_SHORT' | 'PASSPHRASE_TOO_LONG' | 'VAULT_INVALID' | 'VAULT_UNLOCK_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

export async function createCredentialVault(
  settings: GatewaySettings,
  passphrase: string,
  cryptoSource: Crypto = globalThis.crypto
): Promise<{ record: CredentialVaultRecord; key: CryptoKey }> {
  validateVaultPassphrase(passphrase);
  const salt = cryptoSource.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt, CREDENTIAL_VAULT_ITERATIONS, cryptoSource);
  const record = await sealCredentialVault(settings, key, salt, CREDENTIAL_VAULT_ITERATIONS, cryptoSource);
  return { record, key };
}

export async function unlockCredentialVault(
  record: CredentialVaultRecord,
  passphrase: string,
  cryptoSource: Crypto = globalThis.crypto
): Promise<UnlockedCredentialVault> {
  validateVaultPassphrase(passphrase);
  if (!isCredentialVaultRecord(record)) {
    throw new CredentialVaultError('VAULT_INVALID', '凭证保险库格式无效');
  }
  const salt = fromBase64(record.kdf.salt);
  const key = await deriveKey(passphrase, salt, record.kdf.iterations, cryptoSource);
  try {
    const plaintext = await cryptoSource.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(record.cipher.iv),
        additionalData: ADDITIONAL_DATA,
        tagLength: 128
      },
      key,
      fromBase64(record.cipher.ciphertext)
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    const settings = strictGatewaySettings(parsed);
    return { key, settings };
  } catch (error: unknown) {
    if (error instanceof CredentialVaultError) throw error;
    throw new CredentialVaultError('VAULT_UNLOCK_FAILED', '保险库口令不正确或密文已损坏');
  }
}

export async function resealCredentialVault(
  record: CredentialVaultRecord,
  settings: GatewaySettings,
  key: CryptoKey,
  cryptoSource: Crypto = globalThis.crypto
): Promise<CredentialVaultRecord> {
  if (!isCredentialVaultRecord(record)) {
    throw new CredentialVaultError('VAULT_INVALID', '凭证保险库格式无效');
  }
  return sealCredentialVault(settings, key, fromBase64(record.kdf.salt), record.kdf.iterations, cryptoSource);
}

export function inspectCredentialStorage(
  value: unknown,
  present = value !== undefined
): CredentialStorageState {
  if (!present) return { kind: 'empty' };
  if (isCredentialVaultRecord(value)) return { kind: 'vault', record: value };
  if (isLegacySettings(value)) return { kind: 'legacy', settings: migrateGatewaySettings(value).settings };
  return { kind: 'invalid' };
}

export function isCredentialVaultRecord(value: unknown): value is CredentialVaultRecord {
  if (!isRecord(value) || value.version !== CREDENTIAL_VAULT_VERSION) return false;
  if (value.format !== 'PBKDF2-HMAC-SHA256/AES-256-GCM') return false;
  const kdf = isRecord(value.kdf) ? value.kdf : {};
  const cipher = isRecord(value.cipher) ? value.cipher : {};
  return (
    kdf.hash === 'SHA-256' &&
    kdf.iterations === CREDENTIAL_VAULT_ITERATIONS &&
    isBase64WithByteLength(kdf.salt, SALT_BYTES) &&
    isBase64WithByteLength(cipher.iv, IV_BYTES) &&
    typeof cipher.ciphertext === 'string' &&
    cipher.ciphertext.length > 20
  );
}

export function validateVaultPassphrase(passphrase: string): void {
  const bytes = new TextEncoder().encode(passphrase).byteLength;
  if (bytes < CREDENTIAL_VAULT_MIN_PASSPHRASE_BYTES) {
    throw new CredentialVaultError(
      'PASSPHRASE_TOO_SHORT',
      `保险库口令至少需要 ${CREDENTIAL_VAULT_MIN_PASSPHRASE_BYTES} 个 UTF-8 字节`
    );
  }
  if (bytes > CREDENTIAL_VAULT_MAX_PASSPHRASE_BYTES) {
    throw new CredentialVaultError(
      'PASSPHRASE_TOO_LONG',
      `保险库口令不能超过 ${CREDENTIAL_VAULT_MAX_PASSPHRASE_BYTES} 个 UTF-8 字节`
    );
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  cryptoSource: Crypto
): Promise<CryptoKey> {
  const material = await cryptoSource.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return cryptoSource.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    KEY_EXTRACTABLE,
    ['encrypt', 'decrypt']
  );
}

async function sealCredentialVault(
  settings: GatewaySettings,
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  cryptoSource: Crypto
): Promise<CredentialVaultRecord> {
  const normalized = strictGatewaySettings(settings);
  const iv = cryptoSource.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await cryptoSource.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA, tagLength: 128 },
    key,
    new TextEncoder().encode(JSON.stringify(normalized))
  );
  return {
    version: CREDENTIAL_VAULT_VERSION,
    format: 'PBKDF2-HMAC-SHA256/AES-256-GCM',
    kdf: { salt: toBase64(salt), iterations, hash: 'SHA-256' },
    cipher: { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
  };
}

function strictGatewaySettings(value: unknown): GatewaySettings {
  if (!isRecord(value)) throw new CredentialVaultError('VAULT_INVALID', '保险库设置不是对象');
  const { appKey, appSecret, accessToken, endpoint, signMethod } = value;
  if (
    typeof appKey !== 'string' ||
    typeof appSecret !== 'string' ||
    typeof accessToken !== 'string' ||
    typeof endpoint !== 'string' ||
    (signMethod !== 'hmac' && signMethod !== 'md5' && signMethod !== 'hmac-sha256')
  ) {
    throw new CredentialVaultError('VAULT_INVALID', '保险库设置字段不完整');
  }
  return { appKey, appSecret, accessToken, endpoint, signMethod };
}

function isLegacySettings(value: unknown): boolean {
  const record = isRecord(value) ? value : {};
  const settings = record.version === 1 && isRecord(record.settings) ? record.settings : record;
  return (
    typeof settings.appKey === 'string' &&
    typeof settings.appSecret === 'string' &&
    typeof settings.accessToken === 'string' &&
    typeof settings.endpoint === 'string'
  );
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isBase64WithByteLength(value: unknown, length: number): value is string {
  if (typeof value !== 'string') return false;
  try {
    return fromBase64(value).byteLength === length;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
