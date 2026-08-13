import { drizzle } from 'drizzle-orm/d1';

import { CURRENT_SCHEMA_VERSION, schema } from './schema';

import type { DrizzleD1Database } from 'drizzle-orm/d1';

export interface D1DatabaseHandle {
  kind: 'd1';
  db: DrizzleD1Database<typeof schema>;
  binding: D1Database;
}

export function openD1Database(binding: D1Database): D1DatabaseHandle {
  return { kind: 'd1', db: drizzle(binding, { schema }), binding };
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
