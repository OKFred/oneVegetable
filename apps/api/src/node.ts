import { serve } from '@hono/node-server';

import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { applyNodeMigrations, isNodeDatabaseReady, openNodeDatabase } from './db/node-database';
import { SqlRequestEventRepository } from './observability/request-events';
import { AlibabaReadGatewayClient } from './gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from './gateway/node-credential-bundle';

import type { NodeAlibabaCredentialEnvironment } from './gateway/node-credential-bundle';
import { createDocumentationReplayGateway, documentationReplayStatus } from './gateway/documentation-replay';
import { readRuntimeConfiguration, type RuntimeConfigurationEnvironment } from './runtime-config';
import { SqlProductDescriptionTemplateRepository } from './product-description-templates/repository';
import { SqlProductMutationJobRepository } from './product-mutations/repository';

const port = readPort(process.env.ONE_VEGETABLE_PORT);
const runtimeConfiguration = readRuntimeConfiguration(
  process.env as unknown as RuntimeConfigurationEnvironment,
  'local-node'
);
const { environment, gatewayMode } = runtimeConfiguration;
const credentialProvider = createNodeAlibabaCredentialProvider(
  process.env as unknown as NodeAlibabaCredentialEnvironment
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
  gatewayStatus: gatewayMode === 'replay' ? documentationReplayStatus() : credentialProvider.status(),
  ...(gatewayMode === 'real'
    ? { gateway: new AlibabaReadGatewayClient(credentialProvider.requireCredentials()) }
    : gatewayMode === 'replay'
      ? { gateway: createDocumentationReplayGateway() }
      : {}),
  apiPrefix: runtimeConfiguration.apiPrefix,
  allowedOrigins: runtimeConfiguration.allowedOrigins,
  authService,
  adminService: new AdminService(authRepository),
  featureFlags: new StaticOperationFeatureFlags(new Set(runtimeConfiguration.mutationFlags)),
  requestEvents: new SqlRequestEventRepository(database.executor),
  productDescriptionTemplates: new SqlProductDescriptionTemplateRepository(database.executor),
  productMutationJobs: new SqlProductMutationJobRepository(database.executor),
  requestEventRetentionDays: runtimeConfiguration.requestEventRetentionDays,
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
