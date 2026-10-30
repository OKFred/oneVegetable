import { createProductMaintenanceIntent } from '../../../../packages/core/src/product-maintenance-api';
import {
  parseProductMaintenanceRecord,
  productMaintenanceIsTerminal,
  productMaintenanceLockEntities,
  type ProductMaintenanceRecord,
  type ProductMaintenanceRepository
} from '../../../../packages/core/src/product-maintenance-service';
import type { SqlExecutor, SqlPrimitive } from '../db/sql-executor';

const MAX_RECORD_LENGTH = 100_000;
function fail(code: string): never {
  throw new Error(code);
}
function assertRevision(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('ENTITY_VERSION_CONFLICT');
}
async function serialize(value: unknown) {
  try {
    const record = parseProductMaintenanceRecord(value);
    const expected = await createProductMaintenanceIntent(record.task.intent.draft);
    if (JSON.stringify(expected) !== JSON.stringify(record.task.intent))
      return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const entities = productMaintenanceLockEntities(record.task);
    if (!entities.length || new Set(entities).size !== entities.length)
      return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    const json = JSON.stringify(record);
    if (json.length > MAX_RECORD_LENGTH) return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    return {
      record,
      json,
      entitiesJson: JSON.stringify(entities),
      active: productMaintenanceIsTerminal(record.task.status) ? 0 : 1
    };
  } catch {
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  }
}
async function parseRow(row: Record<string, unknown>, ownerId: string): Promise<ProductMaintenanceRecord> {
  if (typeof row.record_json !== 'string' || row.record_json.length > MAX_RECORD_LENGTH)
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  let raw: unknown;
  try {
    raw = JSON.parse(row.record_json);
  } catch {
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  }
  const { record, entitiesJson, active } = await serialize(raw);
  const task = record.task;
  const expected: Record<string, SqlPrimitive> = {
    owner_id: ownerId,
    id: task.id,
    context_identity: task.context.identity,
    context_gateway: task.context.gateway,
    entity_keys_json: entitiesJson,
    request_id: task.requestId,
    payload_fingerprint: task.intent.fingerprint,
    revision: task.revision,
    status: task.status,
    submit_attempted: task.submitAttempted ? 1 : 0,
    create_time_utc: task.createTimeUtc,
    update_time_utc: task.updateTimeUtc,
    active
  };
  if (record.ownerId !== ownerId || Object.entries(expected).some(([key, value]) => row[key] !== value))
    return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
  return record;
}
function storageFailure(cause: unknown): never {
  // D1 may wrap a SQLite trigger error as a cause. Never expose SQL/payloads.
  let current = cause;
  for (let depth = 0; depth < 4; depth++) {
    if (current === null || typeof current !== 'object') break;
    const detail = current as Record<string, unknown>;
    if (typeof detail.message === 'string') {
      for (const code of ['PRODUCT_MAINTENANCE_ENTITY_BUSY', 'PRODUCT_MAINTENANCE_TASK_CORRUPT'])
        if (detail.message.includes(code)) return fail(code);
    }
    current = detail.cause;
  }
  return fail('PRODUCT_MAINTENANCE_STORAGE_FAILED');
}

/** Shared SQLite/D1 persistence. Each save is one SQL statement, including all entity locks. */
export class SqlProductMaintenanceRepository implements ProductMaintenanceRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async get(id: string, ownerId: string): Promise<ProductMaintenanceRecord | null> {
    const rows = await this.executor.query(
      'SELECT * FROM product_maintenance_jobs WHERE owner_id = ? AND id = ?',
      [ownerId, id]
    );
    if (!rows[0]) return null;
    const record = await parseRow(rows[0], ownerId);
    if (record.task.id !== id) return fail('PRODUCT_MAINTENANCE_TASK_CORRUPT');
    return record;
  }
  async list(ownerId: string): Promise<ProductMaintenanceRecord[]> {
    const rows = await this.executor.query(
      'SELECT * FROM product_maintenance_jobs WHERE owner_id = ? ORDER BY update_time_utc DESC, id LIMIT 100',
      [ownerId]
    );
    return Promise.all(rows.map((row) => parseRow(row, ownerId)));
  }
  async save(value: ProductMaintenanceRecord, expectedRevision: number | null): Promise<void> {
    const { record, json, entitiesJson, active } = await serialize(value);
    const task = record.task;
    if (expectedRevision === null) {
      if (task.revision !== 1) return fail('ENTITY_VERSION_CONFLICT');
    } else {
      assertRevision(expectedRevision);
      if (task.revision !== expectedRevision + 1) return fail('ENTITY_VERSION_CONFLICT');
    }
    let changes: number;
    try {
      const result =
        expectedRevision === null
          ? await this.executor.execute(
              'INSERT OR IGNORE INTO product_maintenance_jobs ' +
                '(owner_id, id, context_identity, context_gateway, entity_keys_json, request_id, payload_fingerprint, ' +
                'revision, status, submit_attempted, create_time_utc, update_time_utc, active, record_json) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                record.ownerId,
                task.id,
                task.context.identity,
                task.context.gateway,
                entitiesJson,
                task.requestId,
                task.intent.fingerprint,
                task.revision,
                task.status,
                task.submitAttempted ? 1 : 0,
                task.createTimeUtc,
                task.updateTimeUtc,
                active,
                json
              ]
            )
          : await this.executor.execute(
              'UPDATE product_maintenance_jobs SET revision = ?, status = ?, submit_attempted = ?, ' +
                'update_time_utc = ?, active = ?, record_json = ? ' +
                'WHERE owner_id = ? AND id = ? AND revision = ? AND context_identity = ? ' +
                'AND context_gateway = ? AND entity_keys_json = ? AND payload_fingerprint = ?',
              [
                task.revision,
                task.status,
                task.submitAttempted ? 1 : 0,
                task.updateTimeUtc,
                active,
                json,
                record.ownerId,
                task.id,
                expectedRevision,
                task.context.identity,
                task.context.gateway,
                entitiesJson,
                task.intent.fingerprint
              ]
            );
      changes = result.changes;
    } catch (cause: unknown) {
      return storageFailure(cause);
    }
    if (changes !== 1) fail('ENTITY_VERSION_CONFLICT');
  }
}
