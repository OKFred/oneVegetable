import type { EntityAuditFields, UnixEpochMilliseconds } from '@one-vegetable/core';
import type { SqlExecutor, SqlPrimitive } from '../db/sql-executor';
import type { AuditEvent, AuditEventInput, AuthUser, StoredSession, UserRole, UserStatus } from './types';

export interface CreateUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  status: UserStatus;
  audit: EntityAuditFields;
}

export interface UpdateUserRecord {
  id: string;
  expectedRevision: number;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
  passwordSalt: string;
  audit: EntityAuditFields;
}

export interface AuditQuery {
  requestId?: string;
  actorId?: string;
  action?: string;
  outcome?: AuditEvent['outcome'];
  fromTimeUtc?: UnixEpochMilliseconds;
  toTimeUtc?: UnixEpochMilliseconds;
  page: number;
  pageSize: number;
}

export interface AuthRepository {
  countUsers(): Promise<number>;
  countActiveAdmins(excludeUserId?: string): Promise<number>;
  createUser(input: CreateUserRecord): Promise<AuthUser>;
  findUserByUsername(username: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  listUsers(page: number, pageSize: number): Promise<{ items: AuthUser[]; total: number }>;
  updateUser(input: UpdateUserRecord): Promise<AuthUser | null>;
  recordFailedLogin(
    id: string,
    failedLoginCount: number,
    lockedUntilUtc: number | null,
    now: number
  ): Promise<void>;
  resetFailedLogin(id: string, now: number): Promise<void>;
  createSession(session: StoredSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<{ session: StoredSession; user: AuthUser } | null>;
  touchSession(id: string, idleExpiresTimeUtc: number, now: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  appendAudit(input: AuditEventInput, eventTimeUtc: number): Promise<AuditEvent>;
  listAudit(query: AuditQuery): Promise<{ items: AuditEvent[]; total: number }>;
}

export class SqlAuthRepository implements AuthRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async countUsers(): Promise<number> {
    return readCount(await this.executor.query('SELECT COUNT(*) AS count FROM users'));
  }

  async countActiveAdmins(excludeUserId?: string): Promise<number> {
    const rows = excludeUserId
      ? await this.executor.query(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?",
          [excludeUserId]
        )
      : await this.executor.query(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'"
        );
    return readCount(rows);
  }

  async createUser(input: CreateUserRecord): Promise<AuthUser> {
    await this.executor.execute(
      `INSERT INTO users (
        id, username, password_hash, password_salt, role, status,
        failed_login_count, locked_until_utc, create_time_utc, update_time_utc,
        creator_id, updater_id, revision, remark
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.username,
        input.passwordHash,
        input.passwordSalt,
        input.role,
        input.status,
        input.audit.createTimeUtc,
        input.audit.updateTimeUtc,
        input.audit.creatorId,
        input.audit.updaterId,
        input.audit.revision,
        input.audit.remark
      ]
    );
    return requiredUser(await this.findUserById(input.id));
  }

  async findUserByUsername(username: string): Promise<AuthUser | null> {
    return firstUser(
      await this.executor.query('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1', [username])
    );
  }

  async findUserById(id: string): Promise<AuthUser | null> {
    return firstUser(await this.executor.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]));
  }

  async listUsers(page: number, pageSize: number): Promise<{ items: AuthUser[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [rows, countRows] = await Promise.all([
      this.executor.query('SELECT * FROM users ORDER BY username ASC LIMIT ? OFFSET ?', [pageSize, offset]),
      this.executor.query('SELECT COUNT(*) AS count FROM users')
    ]);
    return { items: rows.map(toUser), total: readCount(countRows) };
  }

  async updateUser(input: UpdateUserRecord): Promise<AuthUser | null> {
    const result = await this.executor.execute(
      `UPDATE users SET role = ?, status = ?, password_hash = ?, password_salt = ?,
       update_time_utc = ?, updater_id = ?, revision = ?, remark = ?
       WHERE id = ? AND revision = ?`,
      [
        input.role,
        input.status,
        input.passwordHash,
        input.passwordSalt,
        input.audit.updateTimeUtc,
        input.audit.updaterId,
        input.audit.revision,
        input.audit.remark,
        input.id,
        input.expectedRevision
      ]
    );
    return result.changes === 1 ? this.findUserById(input.id) : null;
  }

  async recordFailedLogin(
    id: string,
    failedLoginCount: number,
    lockedUntilUtc: number | null,
    now: number
  ): Promise<void> {
    await this.executor.execute(
      'UPDATE users SET failed_login_count = ?, locked_until_utc = ?, update_time_utc = ? WHERE id = ?',
      [failedLoginCount, lockedUntilUtc, now, id]
    );
  }

  async resetFailedLogin(id: string, now: number): Promise<void> {
    await this.executor.execute(
      'UPDATE users SET failed_login_count = 0, locked_until_utc = NULL, update_time_utc = ? WHERE id = ?',
      [now, id]
    );
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.executor.execute(
      `INSERT INTO sessions (
        id, token_hash, csrf_token_hash, user_id, absolute_expires_time_utc,
        idle_expires_time_utc, create_time_utc, update_time_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.tokenHash,
        session.csrfTokenHash,
        session.userId,
        session.absoluteExpiresTimeUtc,
        session.idleExpiresTimeUtc,
        session.createTimeUtc,
        session.updateTimeUtc
      ]
    );
  }

  async findSessionByTokenHash(
    tokenHash: string
  ): Promise<{ session: StoredSession; user: AuthUser } | null> {
    const rows = await this.executor.query(
      `SELECT
        s.id AS session_id, s.token_hash, s.csrf_token_hash, s.user_id,
        s.absolute_expires_time_utc, s.idle_expires_time_utc,
        s.create_time_utc AS session_create_time_utc,
        s.update_time_utc AS session_update_time_utc,
        u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    const row = rows[0];
    if (!row) return null;
    return { session: toSession(row), user: toUser(row) };
  }

  async touchSession(id: string, idleExpiresTimeUtc: number, now: number): Promise<void> {
    await this.executor.execute(
      'UPDATE sessions SET idle_expires_time_utc = ?, update_time_utc = ? WHERE id = ?',
      [idleExpiresTimeUtc, now, id]
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.executor.execute('DELETE FROM sessions WHERE id = ?', [id]);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.executor.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  async appendAudit(input: AuditEventInput, eventTimeUtc: number): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      id: crypto.randomUUID(),
      eventTimeUtc,
      revisionBefore: input.revisionBefore ?? null,
      revisionAfter: input.revisionAfter ?? null
    };
    await this.executor.execute(
      `INSERT INTO audit_events (
        id, event_time_utc, request_id, actor_id, action, resource_kind,
        resource_id, outcome, reason_code, revision_before, revision_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.eventTimeUtc,
        event.requestId,
        event.actorId,
        event.action,
        event.resourceKind,
        event.resourceId,
        event.outcome,
        event.reasonCode,
        event.revisionBefore,
        event.revisionAfter
      ]
    );
    return event;
  }

  async listAudit(query: AuditQuery): Promise<{ items: AuditEvent[]; total: number }> {
    const filters: string[] = [];
    const parameters: SqlPrimitive[] = [];
    addFilter(filters, parameters, 'request_id = ?', query.requestId);
    addFilter(filters, parameters, 'actor_id = ?', query.actorId);
    addFilter(filters, parameters, 'action = ?', query.action);
    addFilter(filters, parameters, 'outcome = ?', query.outcome);
    addFilter(filters, parameters, 'event_time_utc >= ?', query.fromTimeUtc);
    addFilter(filters, parameters, 'event_time_utc <= ?', query.toTimeUtc);
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const [rows, countRows] = await Promise.all([
      this.executor.query(
        `SELECT * FROM audit_events${where} ORDER BY event_time_utc DESC LIMIT ? OFFSET ?`,
        [...parameters, query.pageSize, offset]
      ),
      this.executor.query(`SELECT COUNT(*) AS count FROM audit_events${where}`, parameters)
    ]);
    return { items: rows.map(toAuditEvent), total: readCount(countRows) };
  }
}

function addFilter(
  filters: string[],
  parameters: SqlPrimitive[],
  sql: string,
  value: SqlPrimitive | undefined
): void {
  if (value === undefined) return;
  filters.push(sql);
  parameters.push(value);
}

function firstUser(rows: Record<string, unknown>[]): AuthUser | null {
  return rows[0] ? toUser(rows[0]) : null;
}

function requiredUser(user: AuthUser | null): AuthUser {
  if (!user) throw new Error('用户写入后无法读取');
  return user;
}

function toUser(row: Record<string, unknown>): AuthUser {
  return {
    id: readString(row, 'id'),
    username: readString(row, 'username'),
    passwordHash: readString(row, 'password_hash'),
    passwordSalt: readString(row, 'password_salt'),
    role: readEnum(row, 'role', ['admin', 'user']),
    status: readEnum(row, 'status', ['active', 'disabled']),
    failedLoginCount: readNumber(row, 'failed_login_count'),
    lockedUntilUtc: readNullableNumber(row, 'locked_until_utc'),
    createTimeUtc: readNumber(row, 'create_time_utc'),
    updateTimeUtc: readNumber(row, 'update_time_utc'),
    creatorId: readString(row, 'creator_id'),
    updaterId: readString(row, 'updater_id'),
    revision: readNumber(row, 'revision'),
    remark: readNullableString(row, 'remark')
  };
}

function toSession(row: Record<string, unknown>): StoredSession {
  return {
    id: readString(row, 'session_id'),
    tokenHash: readString(row, 'token_hash'),
    csrfTokenHash: readString(row, 'csrf_token_hash'),
    userId: readString(row, 'user_id'),
    absoluteExpiresTimeUtc: readNumber(row, 'absolute_expires_time_utc'),
    idleExpiresTimeUtc: readNumber(row, 'idle_expires_time_utc'),
    createTimeUtc: readNumber(row, 'session_create_time_utc'),
    updateTimeUtc: readNumber(row, 'session_update_time_utc')
  };
}

function toAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: readString(row, 'id'),
    eventTimeUtc: readNumber(row, 'event_time_utc'),
    requestId: readString(row, 'request_id'),
    actorId: readNullableString(row, 'actor_id'),
    action: readString(row, 'action'),
    resourceKind: readString(row, 'resource_kind'),
    resourceId: readNullableString(row, 'resource_id'),
    outcome: readEnum(row, 'outcome', ['success', 'error', 'denied']),
    reasonCode: readString(row, 'reason_code'),
    revisionBefore: readNullableNumber(row, 'revision_before'),
    revisionAfter: readNullableNumber(row, 'revision_after')
  };
}

function readCount(rows: Record<string, unknown>[]): number {
  return readNumber(rows[0] ?? {}, 'count');
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  return readNumber(row, key);
}

function readEnum<const T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T {
  const value = readString(row, key);
  if (!allowed.some((candidate) => candidate === value)) throw new Error(`数据库字段 ${key} 无效`);
  return value as T;
}
