import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** Only inspect whether encrypted records exist; never read their contents. */
export function hasNodeEncryptedData(path: string): boolean {
  if (!existsSync(path)) return false;
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = [
      'alibaba_gateway_credentials',
      'product_mutation_jobs',
      'meta_app_configurations',
      'meta_oauth_grants',
      'social_destinations',
      'social_publish_jobs',
      's3_storage_configurations'
    ];
    for (const table of tables) {
      if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      if (database.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get()) return true;
    }
    return false;
  } finally {
    database.close();
  }
}
