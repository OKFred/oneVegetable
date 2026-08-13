export type SqlPrimitive = string | number | bigint | Uint8Array | null;

export interface SqlExecuteResult {
  changes: number;
}

export interface SqlExecutor {
  query(sql: string, parameters?: readonly SqlPrimitive[]): Promise<Record<string, unknown>[]>;
  execute(sql: string, parameters?: readonly SqlPrimitive[]): Promise<SqlExecuteResult>;
}
