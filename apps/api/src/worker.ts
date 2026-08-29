import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { SqlPasskeyRepository } from './auth/passkey-repository';
import { PasskeyService } from './auth/passkey-service';
import { isD1DatabaseReady, openD1Database } from './db/d1-database';
import { SqlRequestEventRepository } from './observability/request-events';
import { CredentialBackedAlibabaGatewayClient } from './gateway/alibaba-read-gateway';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider
} from './gateway/credential-vault';
import { createDocumentationReplayGateway, documentationReplayStatus } from './gateway/documentation-replay';
import { readRuntimeConfiguration } from './runtime-config';
import { SqlProductDescriptionTemplateRepository } from './product-description-templates/repository';
import { SqlProductMutationJobRepository } from './product-mutations/repository';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtimeConfiguration = readRuntimeConfiguration(env, 'local-worker');
    const { gatewayMode } = runtimeConfiguration;
    const database = openD1Database(env.DB);
    const credentialRepository = new SqlGatewayCredentialRepository(database.executor);
    const credentialCipher = await GatewayCredentialCipher.create(
      env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY
    );
    const credentialService = new GatewayCredentialService(credentialRepository, credentialCipher);
    const credentialProvider = new StoredAlibabaCredentialProvider(credentialRepository, credentialCipher);
    const credentialStatus = await credentialProvider.status();
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: env.BOOTSTRAP_ADMIN_TOKEN,
      authenticationMode: runtimeConfiguration.authenticationMode
    });
    const passkeyService =
      runtimeConfiguration.authenticationMode === 'passkey'
        ? new PasskeyService(
            new SqlPasskeyRepository(database.executor),
            authRepository,
            authService,
            env.BOOTSTRAP_ADMIN_TOKEN
          )
        : undefined;
    return await createApiApp({
      runtime: 'cloudflare',
      database: 'd1',
      environment: runtimeConfiguration.environment,
      gatewayMode,
      gatewayStatus: gatewayMode === 'replay' ? documentationReplayStatus() : credentialStatus,
      ...(gatewayMode === 'real'
        ? { gateway: new CredentialBackedAlibabaGatewayClient(credentialProvider) }
        : gatewayMode === 'replay'
          ? { gateway: createDocumentationReplayGateway() }
          : {}),
      apiPrefix: runtimeConfiguration.apiPrefix,
      authService,
      authenticationMode: runtimeConfiguration.authenticationMode,
      ...(passkeyService ? { passkeyService } : {}),
      adminService: new AdminService(authRepository),
      gatewayCredentialService: credentialService,
      gatewayCredentialProvider: credentialProvider,
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
