import { serve } from '@hono/node-server';

import { createApiApp } from './app';
import { EmergencyPauseFeatureFlags, StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { applyNodeMigrations, isNodeDatabaseReady, openNodeDatabase } from './db/node-database';
import { createSqliteMetadataRepository } from './db/repository';
import { SqlRequestEventRepository } from './observability/request-events';
import { AlibabaReadGatewayClient } from './gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from './gateway/node-credential-bundle';

import type { NodeAlibabaCredentialEnvironment } from './gateway/node-credential-bundle';

import { createDocumentationReplayGateway, documentationReplayStatus } from './gateway/documentation-replay';
import { readRuntimeConfiguration } from './runtime-config';
import { SqlProductDescriptionTemplateRepository } from './product-description-templates/repository';
import { SqlProductMutationJobRepository } from './product-mutations/repository';
import { readRealMutationsPaused, RealMutationControlService } from './safety/real-mutation-control';
import { SqlMetaSocialRepository } from './social-meta/repository';
import { MetaSecretCipher } from './social-meta/secret-cipher';
import { MetaSocialService } from './social-meta/service';

const port = readPort(process.env.ONE_VEGETABLE_PORT);
const runtimeConfiguration = readRuntimeConfiguration(process.env, 'local-node');
const { environment, gatewayMode } = runtimeConfiguration;
const credentialEnvironment = {
  ...optionalEnvironmentValue(
    'ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE',
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE
  ),
  ...optionalEnvironmentValue('ONE_VEGETABLE_ALIBABA_APP_KEY', process.env.ONE_VEGETABLE_ALIBABA_APP_KEY),
  ...optionalEnvironmentValue(
    'ONE_VEGETABLE_ALIBABA_APP_SECRET',
    process.env.ONE_VEGETABLE_ALIBABA_APP_SECRET
  ),
  ...optionalEnvironmentValue(
    'ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN',
    process.env.ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN
  ),
  ...optionalEnvironmentValue('ONE_VEGETABLE_ALIBABA_ENDPOINT', process.env.ONE_VEGETABLE_ALIBABA_ENDPOINT),
  ...optionalEnvironmentValue(
    'ONE_VEGETABLE_ALIBABA_SIGN_METHOD',
    process.env.ONE_VEGETABLE_ALIBABA_SIGN_METHOD
  )
} satisfies NodeAlibabaCredentialEnvironment;
const credentialProvider = createNodeAlibabaCredentialProvider(credentialEnvironment);
const database = openNodeDatabase(process.env.ONE_VEGETABLE_SQLITE_PATH ?? '.data/one-vegetable.sqlite');
if (environment === 'local-node' && process.env.ONE_VEGETABLE_AUTO_MIGRATE !== 'false') {
  applyNodeMigrations(database);
}
const authRepository = new SqlAuthRepository(database.executor);
const metadataRepository = createSqliteMetadataRepository(database.db);
const authService = new AuthService({
  repository: authRepository,
  bootstrapToken: process.env.BOOTSTRAP_ADMIN_TOKEN,
  authenticationMode: runtimeConfiguration.authenticationMode
});
const featureFlags = new EmergencyPauseFeatureFlags(
  new StaticOperationFeatureFlags(new Set(runtimeConfiguration.mutationFlags)),
  await readRealMutationsPaused(metadataRepository)
);
const metaSecretCipher = process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY
  ? await MetaSecretCipher.create(process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY)
  : undefined;
const metaSocial = metaSecretCipher
  ? new MetaSocialService(new SqlMetaSocialRepository(database.executor), metaSecretCipher, {
      apiPrefix: runtimeConfiguration.apiPrefix
    })
  : undefined;
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
  authenticationMode: runtimeConfiguration.authenticationMode,
  adminService: new AdminService(authRepository),
  featureFlags,
  realMutationControl: new RealMutationControlService(metadataRepository, featureFlags),
  ...(metaSocial ? { metaSocial } : {}),
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

function optionalEnvironmentValue<const Key extends string>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, string>);
}
