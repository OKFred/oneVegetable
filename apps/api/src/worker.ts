import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { isD1DatabaseReady, openD1Database } from './db/d1-database';
import { SqlRequestEventRepository } from './observability/request-events';
import { AlibabaReadGatewayClient } from './gateway/alibaba-read-gateway';
import { EnvironmentAlibabaCredentialProvider } from './gateway/credentials';
import { createDocumentationReplayGateway, documentationReplayStatus } from './gateway/documentation-replay';
import { readRuntimeConfiguration } from './runtime-config';
import { SqlProductDescriptionTemplateRepository } from './product-description-templates/repository';
import { SqlProductMutationJobRepository } from './product-mutations/repository';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtimeConfiguration = readRuntimeConfiguration(env, 'local-worker');
    const { gatewayMode } = runtimeConfiguration;
    const credentialProvider = new EnvironmentAlibabaCredentialProvider({});
    const database = openD1Database(env.DB);
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: env.BOOTSTRAP_ADMIN_TOKEN
    });
    return await createApiApp({
      runtime: 'cloudflare',
      database: 'd1',
      environment: runtimeConfiguration.environment,
      gatewayMode,
      gatewayStatus: gatewayMode === 'replay' ? documentationReplayStatus() : credentialProvider.status(),
      ...(gatewayMode === 'real'
        ? { gateway: new AlibabaReadGatewayClient(credentialProvider.requireCredentials()) }
        : gatewayMode === 'replay'
          ? { gateway: createDocumentationReplayGateway() }
          : {}),
      apiPrefix: runtimeConfiguration.apiPrefix,
      authService,
      adminService: new AdminService(authRepository),
      featureFlags: new StaticOperationFeatureFlags(new Set(runtimeConfiguration.mutationFlags)),
      requestEvents: new SqlRequestEventRepository(database.executor),
      productDescriptionTemplates: new SqlProductDescriptionTemplateRepository(database.executor),
      productMutationJobs: new SqlProductMutationJobRepository(database.executor),
      requestEventRetentionDays: runtimeConfiguration.requestEventRetentionDays,
      allowedOrigins: runtimeConfiguration.allowedOrigins,
      ready: () => isD1DatabaseReady(database)
    }).fetch(request, env);
  }
};
