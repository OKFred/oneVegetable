import { migrateGatewaySettings } from './settings-storage';
import type { CredentialVaultPolicy, GatewaySettings } from './types';

export const CREDENTIAL_VAULT_VERSION = 2;
export const CREDENTIAL_VAULT_ITERATIONS = 600_000;
export const CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS = 6;
export const CREDENTIAL_VAULT_MAX_PASSPHRASE_CHARACTERS = 256;
export const CREDENTIAL_VAULT_DEFAULT_IDLE_TIMEOUT_MINUTES = 0;
export const CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS = [0, 5, 15, 30, 60] as const;

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
  policy: CredentialVaultPolicy;
}

export interface CredentialVaultUnlockResult extends UnlockedCredentialVault {
  sessionKeyMaterial: string;
}

export interface CredentialVaultSessionTiming {
  expired: boolean;
  remainingSeconds: number | null;
}

export interface CredentialVaultSessionValue extends UnlockedCredentialVault {
  record: CredentialVaultRecord;
}

export interface CredentialVaultSessionSnapshot {
  value: CredentialVaultSessionValue;
  lastActivityAt: number;
  remainingSeconds: number | null;
}

export class CredentialVaultSession {
  private active:
    | {
        value: CredentialVaultSessionValue;
        lastActivityAt: number;
      }
    | undefined;

  lockReason: 'idle' | 'manual' | null = null;

  activate(value: CredentialVaultSessionValue, now = Date.now()): void {
    this.active = { value, lastActivityAt: now };
    this.lockReason = null;
  }

  lock(reason: 'idle' | 'manual' = 'manual'): void {
    this.active = undefined;
    this.lockReason = reason;
  }

  read(
    record: CredentialVaultRecord,
    touch = false,
    now = Date.now()
  ): CredentialVaultSessionSnapshot | undefined {
    if (!this.active) return undefined;
    if (!sameCredentialVaultRecord(this.active.value.record, record)) {
      this.active = undefined;
      this.lockReason = null;
      return undefined;
    }
    const timing = credentialVaultSessionTiming(this.active.value.policy, this.active.lastActivityAt, now);
    if (timing.expired) {
      this.lock('idle');
      return undefined;
    }
    if (touch) this.active.lastActivityAt = now;
    return {
      value: this.active.value,
      lastActivityAt: this.active.lastActivityAt,
      remainingSeconds: touch
        ? credentialVaultSessionTiming(this.active.value.policy, now, now).remainingSeconds
        : timing.remainingSeconds
    };
  }
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
  policy: CredentialVaultPolicy = defaultCredentialVaultPolicy(),
  cryptoSource: Crypto = globalThis.crypto
): Promise<CredentialVaultUnlockResult & { record: CredentialVaultRecord }> {
  validateVaultPassphrase(passphrase);
  const normalizedPolicy = strictCredentialVaultPolicy(policy);
  const salt = cryptoSource.getRandomValues(new Uint8Array(SALT_BYTES));
  const { key, sessionKeyMaterial } = await deriveKey(
    passphrase,
    salt,
    CREDENTIAL_VAULT_ITERATIONS,
    cryptoSource
  );
  const record = await sealCredentialVault(
    settings,
    normalizedPolicy,
    key,
    salt,
    CREDENTIAL_VAULT_ITERATIONS,
    cryptoSource
  );
  return { record, key, sessionKeyMaterial, settings, policy: normalizedPolicy };
}

export async function unlockCredentialVault(
  record: CredentialVaultRecord,
  passphrase: string,
  cryptoSource: Crypto = globalThis.crypto
): Promise<CredentialVaultUnlockResult> {
  validateVaultPassphrase(passphrase);
  if (!isCredentialVaultRecord(record)) {
    throw new CredentialVaultError('VAULT_INVALID', '凭证保险库格式无效');
  }
  const salt = fromBase64(record.kdf.salt);
  const { key, sessionKeyMaterial } = await deriveKey(passphrase, salt, record.kdf.iterations, cryptoSource);
  const unlocked = await decryptCredentialVault(record, key, cryptoSource);
  return { ...unlocked, sessionKeyMaterial };
}

export async function restoreCredentialVaultSession(
  record: CredentialVaultRecord,
  sessionKeyMaterial: string,
  cryptoSource: Crypto = globalThis.crypto
): Promise<CredentialVaultUnlockResult> {
  if (!isCredentialVaultRecord(record)) {
    throw new CredentialVaultError('VAULT_INVALID', '凭证保险库格式无效');
  }
  let rawKey: Uint8Array<ArrayBuffer>;
  try {
    rawKey = fromBase64(sessionKeyMaterial);
    if (rawKey.byteLength !== 32) throw new Error('invalid key length');
  } catch {
    throw new CredentialVaultError('VAULT_UNLOCK_FAILED', '保险库口令不正确或密文已损坏');
  }
  const key = await importVaultKey(rawKey, cryptoSource);
  const unlocked = await decryptCredentialVault(record, key, cryptoSource);
  return { ...unlocked, sessionKeyMaterial };
}

export async function resealCredentialVault(
  record: CredentialVaultRecord,
  settings: GatewaySettings,
  key: CryptoKey,
  policy: CredentialVaultPolicy = defaultCredentialVaultPolicy(),
  cryptoSource: Crypto = globalThis.crypto
): Promise<CredentialVaultRecord> {
  if (!isCredentialVaultRecord(record)) {
    throw new CredentialVaultError('VAULT_INVALID', '凭证保险库格式无效');
  }
  return sealCredentialVault(
    settings,
    strictCredentialVaultPolicy(policy),
    key,
    fromBase64(record.kdf.salt),
    record.kdf.iterations,
    cryptoSource
  );
}

export function defaultCredentialVaultPolicy(): CredentialVaultPolicy {
  return { idleTimeoutMinutes: CREDENTIAL_VAULT_DEFAULT_IDLE_TIMEOUT_MINUTES };
}

export function credentialVaultSessionTiming(
  policy: CredentialVaultPolicy,
  lastActivityAt: number,
  now = Date.now()
): CredentialVaultSessionTiming {
  const normalized = strictCredentialVaultPolicy(policy);
  if (normalized.idleTimeoutMinutes === 0) {
    return { expired: false, remainingSeconds: null };
  }
  const timeoutMilliseconds = normalized.idleTimeoutMinutes * 60_000;
  const remainingMilliseconds = Math.max(0, timeoutMilliseconds - Math.max(0, now - lastActivityAt));
  return {
    expired: remainingMilliseconds === 0,
    remainingSeconds: Math.ceil(remainingMilliseconds / 1000)
  };
}

export function validateCredentialVaultIdleTimeout(idleTimeoutMinutes: number): void {
  if (!(CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS as readonly number[]).includes(idleTimeoutMinutes)) {
    throw new CredentialVaultError(
      'VAULT_INVALID',
      `空闲锁定时间仅支持 ${CREDENTIAL_VAULT_IDLE_TIMEOUT_OPTIONS.join('、')} 分钟`
    );
  }
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
  const characters = Array.from(passphrase).length;
  if (characters < CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS) {
    throw new CredentialVaultError(
      'PASSPHRASE_TOO_SHORT',
      `保险库口令至少需要 ${CREDENTIAL_VAULT_MIN_PASSPHRASE_CHARACTERS} 位`
    );
  }
  if (characters > CREDENTIAL_VAULT_MAX_PASSPHRASE_CHARACTERS) {
    throw new CredentialVaultError(
      'PASSPHRASE_TOO_LONG',
      `保险库口令不能超过 ${CREDENTIAL_VAULT_MAX_PASSPHRASE_CHARACTERS} 位`
    );
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  cryptoSource: Crypto
): Promise<{ key: CryptoKey; sessionKeyMaterial: string }> {
  const material = await cryptoSource.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await cryptoSource.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    256
  );
  const rawKey = new Uint8Array(bits);
  return {
    key: await importVaultKey(rawKey, cryptoSource),
    sessionKeyMaterial: toBase64(rawKey)
  };
}

function importVaultKey(rawKey: Uint8Array<ArrayBuffer>, cryptoSource: Crypto): Promise<CryptoKey> {
  return cryptoSource.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, KEY_EXTRACTABLE, [
    'encrypt',
    'decrypt'
  ]);
}

async function decryptCredentialVault(
  record: CredentialVaultRecord,
  key: CryptoKey,
  cryptoSource: Crypto
): Promise<UnlockedCredentialVault> {
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
    const payload = strictCredentialVaultPayload(parsed);
    return { key, ...payload };
  } catch (error: unknown) {
    if (error instanceof CredentialVaultError) throw error;
    throw new CredentialVaultError('VAULT_UNLOCK_FAILED', '保险库口令不正确或密文已损坏');
  }
}

async function sealCredentialVault(
  settings: GatewaySettings,
  policy: CredentialVaultPolicy,
  key: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  cryptoSource: Crypto
): Promise<CredentialVaultRecord> {
  const payload = {
    payloadVersion: 1,
    settings: strictGatewaySettings(settings),
    policy: strictCredentialVaultPolicy(policy)
  };
  const iv = cryptoSource.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await cryptoSource.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA, tagLength: 128 },
    key,
    new TextEncoder().encode(JSON.stringify(payload))
  );
  return {
    version: CREDENTIAL_VAULT_VERSION,
    format: 'PBKDF2-HMAC-SHA256/AES-256-GCM',
    kdf: { salt: toBase64(salt), iterations, hash: 'SHA-256' },
    cipher: { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
  };
}

function strictCredentialVaultPayload(value: unknown): {
  settings: GatewaySettings;
  policy: CredentialVaultPolicy;
} {
  if (isRecord(value) && value.payloadVersion === 1) {
    return {
      settings: strictGatewaySettings(value.settings),
      policy: strictCredentialVaultPolicy(value.policy)
    };
  }
  return {
    settings: strictGatewaySettings(value),
    policy: defaultCredentialVaultPolicy()
  };
}

function strictCredentialVaultPolicy(value: unknown): CredentialVaultPolicy {
  if (!isRecord(value) || typeof value.idleTimeoutMinutes !== 'number') {
    throw new CredentialVaultError('VAULT_INVALID', '保险库空闲锁定策略无效');
  }
  validateCredentialVaultIdleTimeout(value.idleTimeoutMinutes);
  return { idleTimeoutMinutes: value.idleTimeoutMinutes };
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

function sameCredentialVaultRecord(left: CredentialVaultRecord, right: CredentialVaultRecord): boolean {
  return (
    left.kdf.salt === right.kdf.salt &&
    left.cipher.iv === right.cipher.iv &&
    left.cipher.ciphertext === right.cipher.ciphertext
  );
}
