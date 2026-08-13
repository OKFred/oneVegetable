import { drizzle } from 'drizzle-orm/d1';

import { CURRENT_SCHEMA_VERSION, schema } from './schema';

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { SqlExecutor } from './sql-executor';

export interface D1DatabaseHandle {
  kind: 'd1';
  db: DrizzleD1Database<typeof schema>;
  binding: D1Database;
  executor: SqlExecutor;
}

export function openD1Database(binding: D1Database): D1DatabaseHandle {
  const executor: SqlExecutor = {
    async query(sql, parameters = []) {
      const result = await binding
        .prepare(sql)
        .bind(...parameters)
        .all();
      if (!result.success) throw new Error('D1 查询失败');
      return result.results;
    },
    async execute(sql, parameters = []) {
      const result = await binding
        .prepare(sql)
        .bind(...parameters)
        .run();
      if (!result.success) throw new Error('D1 写入失败');
      return { changes: readChanges(result.meta) };
    }
  };
  return { kind: 'd1', db: drizzle(binding, { schema }), binding, executor };
}

export async function isD1DatabaseReady(handle: D1DatabaseHandle): Promise<boolean> {
  try {
    const row = await handle.binding
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .bind(CURRENT_SCHEMA_VERSION)
      .first<{ version: number }>();
    return row?.version === CURRENT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

function readChanges(meta: Record<string, unknown>): number {
  return typeof meta.changes === 'number' ? meta.changes : 0;
}
