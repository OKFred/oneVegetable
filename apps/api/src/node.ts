import { serve } from '@hono/node-server';

import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { applyNodeMigrations, isNodeDatabaseReady, openNodeDatabase } from './db/node-database';

const port = readPort(process.env.ONE_VEGETABLE_PORT);
const environment = process.env.ONE_VEGETABLE_ENVIRONMENT ?? 'local-node';
const database = openNodeDatabase(process.env.ONE_VEGETABLE_SQLITE_PATH ?? '.data/one-vegetable.sqlite');
if (environment === 'local-node' && process.env.ONE_VEGETABLE_AUTO_MIGRATE !== 'false') {
  applyNodeMigrations(database);
}
const authRepository = new SqlAuthRepository(database.executor);
const authService = new AuthService({
  repository: authRepository,
  bootstrapToken: process.env.BOOTSTRAP_ADMIN_TOKEN
});
const app = createApiApp({
  runtime: 'node',
  database: 'sqlite',
  environment,
  gatewayMode: readGatewayMode(process.env.ONE_VEGETABLE_GATEWAY_MODE),
  apiPrefix: process.env.ONE_VEGETABLE_API_PREFIX,
  allowedOrigins: readOrigins(process.env.ONE_VEGETABLE_CORS_ORIGINS),
  authService,
  adminService: new AdminService(authRepository),
  featureFlags: readFeatureFlags(process.env.ONE_VEGETABLE_MUTATION_FLAGS),
  ready: () => Promise.resolve(isNodeDatabaseReady(database))
});

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`oneVegetable API listening on http://localhost:${info.port}\n`);
});

function readPort(value: string | undefined): number {
  const port = Number(value ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('ONE_VEGETABLE_PORT 无效');
  return port;
}

function readGatewayMode(value: string | undefined): 'mock' | 'disabled' {
  return value === 'disabled' ? 'disabled' : 'mock';
}

function readOrigins(value: string | undefined): string[] {
  return value?.split(',').map((origin) => new URL(origin.trim()).origin) ?? [];
}

function readFeatureFlags(value: string | undefined): StaticOperationFeatureFlags {
  return new StaticOperationFeatureFlags(
    new Set(
      value
        ?.split(',')
        .map((flag) => flag.trim())
        .filter(Boolean) ?? []
    )
  );
}
