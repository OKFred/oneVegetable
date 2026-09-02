import { createApiApp } from './app';
import { EmergencyPauseFeatureFlags, StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { SqlPasskeyRepository } from './auth/passkey-repository';
import { PasskeyService } from './auth/passkey-service';
import { isD1DatabaseReady, openD1Database } from './db/d1-database';
import { createD1MetadataRepository } from './db/repository';
import { SqlRequestEventRepository } from './observability/request-events';
import { CredentialBackedAlibabaGatewayClient } from './gateway/alibaba-read-gateway';
import { GatewayConfigurationError } from './gateway/credentials';
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
import { readRealMutationsPaused, RealMutationControlService } from './safety/real-mutation-control';
import { SqlAlibabaCredentialAcquisitionJobRepository } from './alibaba-credential-acquisition/repository';
import { AlibabaCredentialAcquisitionService } from './alibaba-credential-acquisition/service';
import { CloudflareAlibabaCredentialAcquisitionDriver } from './alibaba-credential-acquisition/cloudflare-playwright-driver';
import { SqlMetaSocialRepository } from './social-meta/repository';
import { MetaSecretCipher } from './social-meta/secret-cipher';
import { MetaSocialService } from './social-meta/service';
import { R2SocialMediaStore } from './social-meta/r2-media-store';
import { SocialMediaAssetService } from './social-meta/media-service';
import { SqlSocialPublishingRepository } from './social-meta/publishing-repository';
import { MetaPublisher } from './social-meta/meta-publisher';
import { SocialPublishingService } from './social-meta/publishing-service';
import { SqlExtensionSocialDeviceRepository } from './social-meta/extension-device-repository';
import { ExtensionSocialDeviceService } from './social-meta/extension-device-service';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error: unknown) {
      if (!(error instanceof GatewayConfigurationError || error instanceof SelfHostedConfigurationError)) {
        throw error;
      }
      return selfHostedConfigurationFailure(request, error);
    }
  }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  assertBootstrapToken(env.BOOTSTRAP_ADMIN_TOKEN);
  const runtimeConfiguration = readRuntimeConfiguration(env, 'local-worker');
  const { gatewayMode } = runtimeConfiguration;
  const database = openD1Database(env.DB);
  const credentialRepository = new SqlGatewayCredentialRepository(database.executor);
  const metadataRepository = createD1MetadataRepository(database.db);
  const credentialCipher = await GatewayCredentialCipher.create(env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY);
  const metaSecretCipher = await MetaSecretCipher.create(env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY);
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
  const featureFlags = new EmergencyPauseFeatureFlags(
    new StaticOperationFeatureFlags(new Set(runtimeConfiguration.mutationFlags)),
    await readRealMutationsPaused(metadataRepository)
  );
  const realMutationControl = new RealMutationControlService(metadataRepository, featureFlags);
  const metaSocial = new MetaSocialService(new SqlMetaSocialRepository(database.executor), metaSecretCipher, {
    apiPrefix: runtimeConfiguration.apiPrefix
  });
  const socialMediaAssets = env.SOCIAL_MEDIA
    ? new SocialMediaAssetService(
        new SqlSocialPublishingRepository(database.executor),
        // Wrangler exposes the generated R2 binding as an ambient type that ESLint cannot resolve.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        new R2SocialMediaStore(env.SOCIAL_MEDIA)
      )
    : undefined;
  const socialPublishing = socialMediaAssets
    ? new SocialPublishingService(
        new SqlSocialPublishingRepository(database.executor),
        socialMediaAssets,
        metaSocial,
        metaSecretCipher,
        new MetaPublisher()
      )
    : undefined;
  const extensionSocialDevices = new ExtensionSocialDeviceService(
    new SqlExtensionSocialDeviceRepository(database.executor)
  );
  const alibabaCredentialAcquisition =
    runtimeConfiguration.environment === 'self-hosted' && env.BROWSER
      ? new AlibabaCredentialAcquisitionService(
          new SqlAlibabaCredentialAcquisitionJobRepository(database.executor),
          // Wrangler generates BrowserRun as a structural BrowserWorker binding; ESLint cannot resolve that ambient type.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          new CloudflareAlibabaCredentialAcquisitionDriver(env.BROWSER),
          credentialService
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
    featureFlags,
    realMutationControl,
    metaSocial,
    ...(socialMediaAssets ? { socialMediaAssets } : {}),
    ...(socialPublishing ? { socialPublishing } : {}),
    extensionSocialDevices,
    ...(alibabaCredentialAcquisition ? { alibabaCredentialAcquisition } : {}),
    requestEvents: new SqlRequestEventRepository(database.executor),
    productDescriptionTemplates: new SqlProductDescriptionTemplateRepository(database.executor),
    productMutationJobs: new SqlProductMutationJobRepository(database.executor),
    requestEventRetentionDays: runtimeConfiguration.requestEventRetentionDays,
    allowedOrigins: runtimeConfiguration.allowedOrigins,
    ready: () => isD1DatabaseReady(database)
  }).fetch(request, env);
}

function selfHostedConfigurationFailure(
  request: Request,
  error: GatewayConfigurationError | SelfHostedConfigurationError
): Response {
  const requestId = crypto.randomUUID();
  const pathname = new URL(request.url).pathname;
  const health = pathname.endsWith('/healthz');
  const body = health
    ? { requestId, status: 'ok' }
    : pathname.endsWith('/readyz')
      ? { requestId, status: 'not-ready' }
      : {
          requestId,
          ok: false,
          error: {
            code: error.code,
            message:
              error instanceof SelfHostedConfigurationError
                ? '管理员引导令牌尚未正确配置'
                : '凭据加密设施尚未正确配置',
            retryable: false
          }
        };
  return new Response(JSON.stringify(body), {
    status: health ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Request-ID': requestId
    }
  });
}

class SelfHostedConfigurationError extends Error {
  readonly code = 'BOOTSTRAP_ADMIN_TOKEN_INVALID';
}

function assertBootstrapToken(value: string | undefined): asserts value is string {
  if (!value || new TextEncoder().encode(value).byteLength < 32) {
    throw new SelfHostedConfigurationError('管理员引导令牌至少需要 32 字节');
  }
}
