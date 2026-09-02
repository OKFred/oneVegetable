import type { ExtensionSocialDevice } from '@one-vegetable/core';
import type { SqlExecutor } from '../db/sql-executor';

export interface ExtensionSocialPairingRecord {
  id: string;
  pairingCodeHash: string;
  extensionId: string;
  deviceName: string;
  status: 'pending' | 'approved' | 'consumed' | 'cancelled' | 'expired';
  approvedBy: string | null;
  deviceId: string | null;
  expiresTimeUtc: number;
  createTimeUtc: number;
  updateTimeUtc: number;
}

export interface ExtensionSocialDeviceRecord extends ExtensionSocialDevice {
  tokenHash: string;
}

export interface ExtensionSocialDeviceRepository {
  countRecentPairings(extensionId: string, sinceTimeUtc: number): Promise<number>;
  createPairing(input: ExtensionSocialPairingRecord): Promise<void>;
  findPairing(id: string, pairingCodeHash: string): Promise<ExtensionSocialPairingRecord | null>;
  findPairingByCodeHash(pairingCodeHash: string): Promise<ExtensionSocialPairingRecord | null>;
  approvePairing(id: string, actorId: string, now: number): Promise<boolean>;
  expirePairing(id: string, now: number): Promise<void>;
  consumePairing(id: string, deviceId: string, now: number): Promise<boolean>;
  createDevice(input: ExtensionSocialDeviceRecord): Promise<void>;
  findDevice(id: string): Promise<ExtensionSocialDeviceRecord | null>;
  findDeviceByTokenHash(tokenHash: string): Promise<ExtensionSocialDeviceRecord | null>;
  listDevices(now: number): Promise<ExtensionSocialDevice[]>;
  touchDevice(id: string, now: number): Promise<void>;
  revokeDevice(id: string, expectedRevision: number, actorId: string, now: number): Promise<boolean>;
  revokeOrphanDevice(id: string, actorId: string, now: number): Promise<void>;
}

export class SqlExtensionSocialDeviceRepository implements ExtensionSocialDeviceRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async countRecentPairings(extensionId: string, sinceTimeUtc: number): Promise<number> {
    const row = (
      await this.executor.query(
        'SELECT COUNT(*) AS count FROM extension_social_pairings WHERE extension_id = ? AND create_time_utc >= ?',
        [extensionId, sinceTimeUtc]
      )
    )[0];
    return optionalNumber(row?.count) ?? 0;
  }

  async createPairing(input: ExtensionSocialPairingRecord): Promise<void> {
    await this.executor.execute(
      `INSERT INTO extension_social_pairings (
        id, pairing_code_hash, extension_id, device_name, status, approved_by, device_id,
        expires_time_utc, create_time_utc, update_time_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.pairingCodeHash,
        input.extensionId,
        input.deviceName,
        input.status,
        input.approvedBy,
        input.deviceId,
        input.expiresTimeUtc,
        input.createTimeUtc,
        input.updateTimeUtc
      ]
    );
  }

  async findPairing(id: string, pairingCodeHash: string): Promise<ExtensionSocialPairingRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM extension_social_pairings WHERE id = ? AND pairing_code_hash = ? LIMIT 1',
      [id, pairingCodeHash]
    );
    return rows[0] ? toPairing(rows[0]) : null;
  }

  async findPairingByCodeHash(pairingCodeHash: string): Promise<ExtensionSocialPairingRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM extension_social_pairings WHERE pairing_code_hash = ? LIMIT 1',
      [pairingCodeHash]
    );
    return rows[0] ? toPairing(rows[0]) : null;
  }

  async approvePairing(id: string, actorId: string, now: number): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE extension_social_pairings
       SET status = 'approved', approved_by = ?, update_time_utc = ?
       WHERE id = ? AND status = 'pending' AND expires_time_utc > ?`,
      [actorId, now, id, now]
    );
    return result.changes === 1;
  }

  async expirePairing(id: string, now: number): Promise<void> {
    await this.executor.execute(
      `UPDATE extension_social_pairings SET status = 'expired', update_time_utc = ?
       WHERE id = ? AND status IN ('pending', 'approved')`,
      [now, id]
    );
  }

  async consumePairing(id: string, deviceId: string, now: number): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE extension_social_pairings
       SET status = 'consumed', device_id = ?, update_time_utc = ?
       WHERE id = ? AND status = 'approved' AND expires_time_utc > ?`,
      [deviceId, now, id, now]
    );
    return result.changes === 1;
  }

  async createDevice(input: ExtensionSocialDeviceRecord): Promise<void> {
    await this.executor.execute(
      `INSERT INTO extension_social_devices (
        id, token_hash, extension_id, name, status, expires_time_utc, last_used_time_utc,
        create_time_utc, update_time_utc, creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.tokenHash,
        input.extensionId,
        input.name,
        input.status,
        input.expiresTimeUtc,
        input.lastUsedTimeUtc,
        input.createTimeUtc,
        input.updateTimeUtc,
        input.creatorId,
        input.updaterId,
        input.revision,
        input.remark
      ]
    );
  }

  async findDevice(id: string): Promise<ExtensionSocialDeviceRecord | null> {
    const rows = await this.executor.query('SELECT * FROM extension_social_devices WHERE id = ? LIMIT 1', [
      id
    ]);
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<ExtensionSocialDeviceRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM extension_social_devices WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async listDevices(now: number): Promise<ExtensionSocialDevice[]> {
    await this.executor.execute(
      `UPDATE extension_social_devices
       SET status = 'expired', update_time_utc = ?, updater_id = 'system:maintenance', revision = revision + 1
       WHERE status = 'active' AND expires_time_utc <= ?`,
      [now, now]
    );
    const rows = await this.executor.query(
      'SELECT * FROM extension_social_devices ORDER BY create_time_utc DESC'
    );
    return rows.map((row) => publicDevice(toDevice(row)));
  }

  async touchDevice(id: string, now: number): Promise<void> {
    await this.executor.execute(
      "UPDATE extension_social_devices SET last_used_time_utc = ? WHERE id = ? AND status = 'active'",
      [now, id]
    );
  }

  async revokeDevice(id: string, expectedRevision: number, actorId: string, now: number): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE extension_social_devices
       SET status = 'revoked', update_time_utc = ?, updater_id = ?, revision = revision + 1
       WHERE id = ? AND revision = ? AND status = 'active'`,
      [now, actorId, id, expectedRevision]
    );
    return result.changes === 1;
  }

  async revokeOrphanDevice(id: string, actorId: string, now: number): Promise<void> {
    await this.executor.execute(
      `UPDATE extension_social_devices
       SET status = 'revoked', update_time_utc = ?, updater_id = ?, revision = revision + 1
       WHERE id = ? AND status = 'active'`,
      [now, actorId, id]
    );
  }
}

export function publicDevice(record: ExtensionSocialDeviceRecord): ExtensionSocialDevice {
  const { tokenHash: _tokenHash, ...device } = record;
  return device;
}

function toPairing(row: Record<string, unknown>): ExtensionSocialPairingRecord {
  return {
    id: requiredString(row, 'id'),
    pairingCodeHash: requiredString(row, 'pairing_code_hash'),
    extensionId: requiredString(row, 'extension_id'),
    deviceName: requiredString(row, 'device_name'),
    status: requiredEnum(row, 'status', ['pending', 'approved', 'consumed', 'cancelled', 'expired']),
    approvedBy: nullableString(row, 'approved_by'),
    deviceId: nullableString(row, 'device_id'),
    expiresTimeUtc: requiredNumber(row, 'expires_time_utc'),
    createTimeUtc: requiredNumber(row, 'create_time_utc'),
    updateTimeUtc: requiredNumber(row, 'update_time_utc')
  };
}

function toDevice(row: Record<string, unknown>): ExtensionSocialDeviceRecord {
  return {
    id: requiredString(row, 'id'),
    tokenHash: requiredString(row, 'token_hash'),
    extensionId: requiredString(row, 'extension_id'),
    name: requiredString(row, 'name'),
    status: requiredEnum(row, 'status', ['active', 'revoked', 'expired']),
    expiresTimeUtc: requiredNumber(row, 'expires_time_utc'),
    lastUsedTimeUtc: nullableNumber(row, 'last_used_time_utc'),
    createTimeUtc: requiredNumber(row, 'create_time_utc'),
    updateTimeUtc: requiredNumber(row, 'update_time_utc'),
    creatorId: requiredString(row, 'creator_id'),
    updaterId: requiredString(row, 'updater_id'),
    revision: requiredNumber(row, 'revision'),
    remark: nullableString(row, 'remark')
  };
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null ? null : requiredString(row, key);
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : requiredNumber(row, key);
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function requiredEnum<const Value extends string>(
  row: Record<string, unknown>,
  key: string,
  values: readonly Value[]
): Value {
  const value = requiredString(row, key);
  if (!values.includes(value as Value)) throw new Error(`数据库字段 ${key} 无效`);
  return value as Value;
}
