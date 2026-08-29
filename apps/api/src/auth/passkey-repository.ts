import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/server';

import type { SqlExecutor } from '../db/sql-executor';

export type PasskeyChallengeKind = 'bootstrap' | 'login' | 'register' | 'recovery' | 'enrollment';

export interface StoredPasskeyCredential {
  id: string;
  userId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  rpId: string;
  name: string;
  createTimeUtc: number;
}

export interface StoredPasskeyChallenge {
  id: string;
  challenge: string;
  kind: PasskeyChallengeKind;
  userId: string | null;
  username: string | null;
  rpId: string;
  origin: string;
  context: Record<string, unknown>;
  expiresTimeUtc: number;
}

export interface PasskeyRepository {
  createChallenge(challenge: StoredPasskeyChallenge, now: number): Promise<void>;
  takeChallenge(id: string, kind: PasskeyChallengeKind, now: number): Promise<StoredPasskeyChallenge | null>;
  createCredential(input: StoredPasskeyCredential, actorId: string, now: number): Promise<void>;
  findCredential(id: string): Promise<StoredPasskeyCredential | null>;
  listCredentials(userId: string): Promise<StoredPasskeyCredential[]>;
  updateCredentialCounter(id: string, counter: number, now: number): Promise<void>;
  deleteCredential(id: string, userId: string): Promise<boolean>;
  replaceRecoveryCodes(userId: string, hashes: readonly string[], now: number): Promise<void>;
  hasRecoveryCode(userId: string, hash: string): Promise<boolean>;
  consumeRecoveryCode(userId: string, hash: string, now: number): Promise<boolean>;
  createEnrollmentToken(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresTimeUtc: number;
    creatorId: string;
    createTimeUtc: number;
  }): Promise<void>;
  findEnrollmentToken(tokenHash: string, now: number): Promise<{ id: string; userId: string } | null>;
  consumeEnrollmentToken(id: string, now: number): Promise<boolean>;
}

export class SqlPasskeyRepository implements PasskeyRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async createChallenge(challenge: StoredPasskeyChallenge, now: number): Promise<void> {
    await this.executor.execute(
      `DELETE FROM webauthn_challenges
       WHERE expires_time_utc < ? OR (consumed_time_utc IS NOT NULL AND consumed_time_utc < ?)`,
      [now - 24 * 60 * 60 * 1000, now - 24 * 60 * 60 * 1000]
    );
    await this.executor.execute(
      `INSERT INTO webauthn_challenges (
        id, challenge, kind, user_id, username, rp_id, origin, context_json,
        expires_time_utc, consumed_time_utc, create_time_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        challenge.id,
        challenge.challenge,
        challenge.kind,
        challenge.userId,
        challenge.username,
        challenge.rpId,
        challenge.origin,
        JSON.stringify(challenge.context),
        challenge.expiresTimeUtc,
        now
      ]
    );
  }

  async takeChallenge(
    id: string,
    kind: PasskeyChallengeKind,
    now: number
  ): Promise<StoredPasskeyChallenge | null> {
    const rows = await this.executor.query(
      `SELECT * FROM webauthn_challenges
       WHERE id = ? AND kind = ? AND consumed_time_utc IS NULL AND expires_time_utc > ? LIMIT 1`,
      [id, kind, now]
    );
    const row = rows[0];
    if (!row) return null;
    const consumed = await this.executor.execute(
      `UPDATE webauthn_challenges SET consumed_time_utc = ?
       WHERE id = ? AND consumed_time_utc IS NULL AND expires_time_utc > ?`,
      [now, id, now]
    );
    return consumed.changes === 1 ? toChallenge(row) : null;
  }

  async createCredential(input: StoredPasskeyCredential, actorId: string, now: number): Promise<void> {
    await this.executor.execute(
      `INSERT INTO webauthn_credentials (
        id, user_id, public_key_base64url, counter, transports_json, device_type,
        backed_up, rp_id, name, create_time_utc, update_time_utc, creator_id,
        updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      [
        input.id,
        input.userId,
        bytesToBase64Url(input.publicKey),
        input.counter,
        JSON.stringify(input.transports),
        input.deviceType,
        input.backedUp ? 1 : 0,
        input.rpId,
        input.name,
        now,
        now,
        actorId,
        actorId
      ]
    );
  }

  async findCredential(id: string): Promise<StoredPasskeyCredential | null> {
    const row = (
      await this.executor.query('SELECT * FROM webauthn_credentials WHERE id = ? LIMIT 1', [id])
    )[0];
    return row ? toCredential(row) : null;
  }

  async listCredentials(userId: string): Promise<StoredPasskeyCredential[]> {
    return (
      await this.executor.query(
        'SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY create_time_utc ASC',
        [userId]
      )
    ).map(toCredential);
  }

  async updateCredentialCounter(id: string, counter: number, now: number): Promise<void> {
    await this.executor.execute(
      `UPDATE webauthn_credentials
       SET counter = ?, update_time_utc = ?, revision = revision + 1 WHERE id = ?`,
      [counter, now, id]
    );
  }

  async deleteCredential(id: string, userId: string): Promise<boolean> {
    return (
      (
        await this.executor.execute('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?', [
          id,
          userId
        ])
      ).changes === 1
    );
  }

  async replaceRecoveryCodes(userId: string, hashes: readonly string[], now: number): Promise<void> {
    await this.executor.execute('DELETE FROM auth_recovery_codes WHERE user_id = ?', [userId]);
    for (const hash of hashes) {
      await this.executor.execute(
        `INSERT INTO auth_recovery_codes (
          id, user_id, code_hash, consumed_time_utc, create_time_utc
        ) VALUES (?, ?, ?, NULL, ?)`,
        [crypto.randomUUID(), userId, hash, now]
      );
    }
  }

  async hasRecoveryCode(userId: string, hash: string): Promise<boolean> {
    const rows = await this.executor.query(
      `SELECT id FROM auth_recovery_codes
       WHERE user_id = ? AND code_hash = ? AND consumed_time_utc IS NULL LIMIT 1`,
      [userId, hash]
    );
    return rows.length === 1;
  }

  async consumeRecoveryCode(userId: string, hash: string, now: number): Promise<boolean> {
    return (
      (
        await this.executor.execute(
          `UPDATE auth_recovery_codes SET consumed_time_utc = ?
         WHERE user_id = ? AND code_hash = ? AND consumed_time_utc IS NULL`,
          [now, userId, hash]
        )
      ).changes === 1
    );
  }

  async createEnrollmentToken(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresTimeUtc: number;
    creatorId: string;
    createTimeUtc: number;
  }): Promise<void> {
    await this.executor.execute(
      `INSERT INTO user_enrollment_tokens (
        id, user_id, token_hash, expires_time_utc, consumed_time_utc, creator_id, create_time_utc
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [input.id, input.userId, input.tokenHash, input.expiresTimeUtc, input.creatorId, input.createTimeUtc]
    );
  }

  async findEnrollmentToken(tokenHash: string, now: number): Promise<{ id: string; userId: string } | null> {
    const row = (
      await this.executor.query(
        `SELECT id, user_id FROM user_enrollment_tokens
         WHERE token_hash = ? AND consumed_time_utc IS NULL AND expires_time_utc > ? LIMIT 1`,
        [tokenHash, now]
      )
    )[0];
    return row ? { id: readString(row, 'id'), userId: readString(row, 'user_id') } : null;
  }

  async consumeEnrollmentToken(id: string, now: number): Promise<boolean> {
    return (
      (
        await this.executor.execute(
          `UPDATE user_enrollment_tokens SET consumed_time_utc = ?
         WHERE id = ? AND consumed_time_utc IS NULL AND expires_time_utc > ?`,
          [now, id, now]
        )
      ).changes === 1
    );
  }
}

function toChallenge(row: Record<string, unknown>): StoredPasskeyChallenge {
  return {
    id: readString(row, 'id'),
    challenge: readString(row, 'challenge'),
    kind: readEnum(row, 'kind', ['bootstrap', 'login', 'register', 'recovery', 'enrollment']),
    userId: readNullableString(row, 'user_id'),
    username: readNullableString(row, 'username'),
    rpId: readString(row, 'rp_id'),
    origin: readString(row, 'origin'),
    context: readJsonObject(row, 'context_json'),
    expiresTimeUtc: readNumber(row, 'expires_time_utc')
  };
}

function toCredential(row: Record<string, unknown>): StoredPasskeyCredential {
  return {
    id: readString(row, 'id'),
    userId: readString(row, 'user_id'),
    publicKey: base64UrlToBytes(readString(row, 'public_key_base64url')),
    counter: readNumber(row, 'counter'),
    transports: readTransports(row),
    deviceType: readEnum(row, 'device_type', ['singleDevice', 'multiDevice']),
    backedUp: readNumber(row, 'backed_up') === 1,
    rpId: readString(row, 'rp_id'),
    name: readString(row, 'name'),
    createTimeUtc: readNumber(row, 'create_time_utc')
  };
}

function readTransports(row: Record<string, unknown>): AuthenticatorTransportFuture[] {
  const value: unknown = JSON.parse(readString(row, 'transports_json'));
  const allowed = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'] as const;
  if (!Array.isArray(value) || !value.every((entry) => allowed.some((candidate) => candidate === entry))) {
    throw new Error('数据库字段 transports_json 无效');
  }
  return value as AuthenticatorTransportFuture[];
}

function readJsonObject(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readString(row, key));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`数据库字段 ${key} 无效`);
  }
  return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  return readString(row, key);
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readEnum<const T extends string>(
  row: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = readString(row, key);
  if (!values.some((candidate) => candidate === value)) throw new Error(`数据库字段 ${key} 无效`);
  return value as T;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
