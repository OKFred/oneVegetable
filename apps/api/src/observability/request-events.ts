import type { UnixEpochMilliseconds } from '@one-vegetable/core';
import type { SqlExecutor, SqlPrimitive } from '../db/sql-executor';

export type RequestOutcome = 'success' | 'error' | 'denied';

export interface RequestEvent {
  id: string;
  eventTimeUtc: UnixEpochMilliseconds;
  requestId: string;
  environment: string;
  runtime: 'node' | 'cloudflare';
  route: string;
  operation: string;
  actorId: string | null;
  outcome: RequestOutcome;
  statusCode: number;
  durationMilliseconds: number;
}

export interface RequestEventQuery {
  requestId?: string;
  actorId?: string;
  route?: string;
  operation?: string;
  outcome?: RequestOutcome;
  fromTimeUtc?: UnixEpochMilliseconds;
  toTimeUtc?: UnixEpochMilliseconds;
  page: number;
  pageSize: number;
}

export interface RequestEventRepository {
  append(event: RequestEvent): Promise<void>;
  list(query: RequestEventQuery): Promise<{ items: RequestEvent[]; total: number }>;
  purgeBefore(cutoffTimeUtc: UnixEpochMilliseconds): Promise<number>;
}

export class SqlRequestEventRepository implements RequestEventRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async append(event: RequestEvent): Promise<void> {
    await this.executor.execute(
      `INSERT INTO request_events (
        id, event_time_utc, request_id, environment, runtime, route, operation,
        actor_id, outcome, status_code, duration_milliseconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.eventTimeUtc,
        event.requestId,
        event.environment,
        event.runtime,
        event.route,
        event.operation,
        event.actorId,
        event.outcome,
        event.statusCode,
        event.durationMilliseconds
      ]
    );
  }

  async list(query: RequestEventQuery): Promise<{ items: RequestEvent[]; total: number }> {
    assertPage(query.page, query.pageSize);
    const filters: string[] = [];
    const parameters: SqlPrimitive[] = [];
    addFilter(filters, parameters, 'request_id = ?', query.requestId);
    addFilter(filters, parameters, 'actor_id = ?', query.actorId);
    addFilter(filters, parameters, 'route = ?', query.route);
    addFilter(filters, parameters, 'operation = ?', query.operation);
    addFilter(filters, parameters, 'outcome = ?', query.outcome);
    addFilter(filters, parameters, 'event_time_utc >= ?', query.fromTimeUtc);
    addFilter(filters, parameters, 'event_time_utc <= ?', query.toTimeUtc);
    const where = filters.length === 0 ? '' : ` WHERE ${filters.join(' AND ')}`;
    const countRows = await this.executor.query(
      `SELECT COUNT(*) AS count FROM request_events${where}`,
      parameters
    );
    const offset = (query.page - 1) * query.pageSize;
    const rows = await this.executor.query(
      `SELECT * FROM request_events${where} ORDER BY event_time_utc DESC, id DESC LIMIT ? OFFSET ?`,
      [...parameters, query.pageSize, offset]
    );
    return { items: rows.map(readRequestEvent), total: readNumber(countRows[0], 'count') };
  }

  async purgeBefore(cutoffTimeUtc: UnixEpochMilliseconds): Promise<number> {
    const result = await this.executor.execute('DELETE FROM request_events WHERE event_time_utc < ?', [
      cutoffTimeUtc
    ]);
    return result.changes;
  }
}

export function requestEventRetentionCutoff(
  now: UnixEpochMilliseconds,
  retentionDays: number
): UnixEpochMilliseconds {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw new Error('请求诊断保留天数必须为 1–90');
  }
  return now - retentionDays * 24 * 60 * 60 * 1000;
}

function addFilter(
  filters: string[],
  parameters: SqlPrimitive[],
  expression: string,
  value: SqlPrimitive | undefined
): void {
  if (value === undefined) return;
  filters.push(expression);
  parameters.push(value);
}

function readRequestEvent(row: Record<string, unknown>): RequestEvent {
  return {
    id: readString(row, 'id'),
    eventTimeUtc: readNumber(row, 'event_time_utc'),
    requestId: readString(row, 'request_id'),
    environment: readString(row, 'environment'),
    runtime: readEnum(row, 'runtime', ['node', 'cloudflare']),
    route: readString(row, 'route'),
    operation: readString(row, 'operation'),
    actorId: readNullableString(row, 'actor_id'),
    outcome: readEnum(row, 'outcome', ['success', 'error', 'denied']),
    statusCode: readNumber(row, 'status_code'),
    durationMilliseconds: readNumber(row, 'duration_milliseconds')
  };
}

function assertPage(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('分页参数无效');
  }
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库字段 ${key} 无效`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null ? null : readString(row, key);
}

function readNumber(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`数据库字段 ${key} 无效`);
  }
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
