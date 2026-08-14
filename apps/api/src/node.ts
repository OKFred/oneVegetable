import { serve } from '@hono/node-server';

import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { applyNodeMigrations, isNodeDatabaseReady, openNodeDatabase } from './db/node-database';
import { SqlRequestEventRepository } from './observability/request-events';
import { AlibabaReadGatewayClient } from './gateway/alibaba-read-gateway';
import {
  EnvironmentAlibabaCredentialProvider,
  type AlibabaCredentialEnvironment
} from './gateway/credentials';

const port = readPort(process.env.ONE_VEGETABLE_PORT);
const environment = process.env.ONE_VEGETABLE_ENVIRONMENT ?? 'local-node';
const gatewayMode = readGatewayMode(process.env.ONE_VEGETABLE_GATEWAY_MODE);
const credentialProvider = new EnvironmentAlibabaCredentialProvider(
  process.env as unknown as AlibabaCredentialEnvironment
);
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
  gatewayMode,
  ...(gatewayMode === 'real'
    ? { gateway: new AlibabaReadGatewayClient(credentialProvider.requireCredentials()) }
    : {}),
  apiPrefix: process.env.ONE_VEGETABLE_API_PREFIX,
  allowedOrigins: readOrigins(process.env.ONE_VEGETABLE_CORS_ORIGINS),
  authService,
  adminService: new AdminService(authRepository),
  featureFlags: readFeatureFlags(process.env.ONE_VEGETABLE_MUTATION_FLAGS),
  requestEvents: new SqlRequestEventRepository(database.executor),
  requestEventRetentionDays: readRetentionDays(process.env.ONE_VEGETABLE_REQUEST_RETENTION_DAYS),
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

function readGatewayMode(value: string | undefined): 'mock' | 'disabled' | 'real' {
  if (value === undefined || value === 'mock') return 'mock';
  if (value === 'disabled' || value === 'real') return value;
  throw new Error('ONE_VEGETABLE_GATEWAY_MODE 无效');
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

function readRetentionDays(value: string | undefined): number {
  const days = Number(value ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('ONE_VEGETABLE_REQUEST_RETENTION_DAYS 必须为 1–90');
  }
  return days;
}
