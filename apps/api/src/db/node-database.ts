import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import { CURRENT_SCHEMA_VERSION, schema } from './schema';

import type { SqlExecutor, SqlPrimitive } from './sql-executor';
import type { SQLInputValue } from 'node:sqlite';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

export interface NodeDatabaseHandle {
  kind: 'sqlite';
  db: SqliteRemoteDatabase<typeof schema>;
  connection: DatabaseSync;
  executor: SqlExecutor;
}

export function openNodeDatabase(path: string): NodeDatabaseHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const db = drizzle(
    (query, params, method) => {
      const statement = connection.prepare(query);
      const values = params.map(toSqlInputValue);
      if (method === 'run') {
        const result = statement.run(...values);
        return Promise.resolve({
          rows: [{ changes: result.changes, lastInsertRowid: result.lastInsertRowid }]
        });
      }
      if (method === 'get') return Promise.resolve({ rows: [statement.get(...values)] });
      statement.setReturnArrays(true);
      return Promise.resolve({ rows: statement.all(...values) });
    },
    { schema }
  );
  const executor: SqlExecutor = {
    query(sql, parameters = []) {
      return Promise.resolve(connection.prepare(sql).all(...parameters.map(toSqlInputValue)));
    },
    execute(sql, parameters = []) {
      const result = connection.prepare(sql).run(...parameters.map(toSqlInputValue));
      return Promise.resolve({ changes: Number(result.changes) });
    }
  };
  return { kind: 'sqlite', db, connection, executor };
}

export function applyNodeMigrations(handle: NodeDatabaseHandle): void {
  for (const name of [
    '0001_foundation.sql',
    '0002_auth_abac_audit.sql',
    '0003_request_observability.sql',
    '0004_product_description_templates.sql',
    '0005_product_mutation_jobs.sql'
  ]) {
    const migration = readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), 'utf8');
    handle.connection.exec(migration);
  }
}

export function isNodeDatabaseReady(handle: NodeDatabaseHandle): boolean {
  try {
    const row = handle.connection
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(CURRENT_SCHEMA_VERSION);
    return row?.version === CURRENT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

function toSqlInputValue(value: SqlPrimitive): SQLInputValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error('SQLite 参数类型无效');
}
