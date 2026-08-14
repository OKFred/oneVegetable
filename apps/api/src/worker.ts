import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { isD1DatabaseReady, openD1Database } from './db/d1-database';
import { SqlRequestEventRepository } from './observability/request-events';
import { AlibabaReadGatewayClient } from './gateway/alibaba-read-gateway';
import { EnvironmentAlibabaCredentialProvider } from './gateway/credentials';

interface Env {
  DB: D1Database;
  ONE_VEGETABLE_API_PREFIX?: string;
  ONE_VEGETABLE_ENVIRONMENT?: string;
  ONE_VEGETABLE_GATEWAY_MODE?: string;
  ONE_VEGETABLE_CORS_ORIGINS?: string;
  ONE_VEGETABLE_MUTATION_FLAGS?: string;
  ONE_VEGETABLE_REQUEST_RETENTION_DAYS?: string;
  BOOTSTRAP_ADMIN_TOKEN?: string;
  ONE_VEGETABLE_ALIBABA_APP_KEY?: string;
  ONE_VEGETABLE_ALIBABA_APP_SECRET?: string;
  ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN?: string;
  ONE_VEGETABLE_ALIBABA_ENDPOINT?: string;
  ONE_VEGETABLE_ALIBABA_SIGN_METHOD?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const gatewayMode = readGatewayMode(env.ONE_VEGETABLE_GATEWAY_MODE);
    const credentialProvider = new EnvironmentAlibabaCredentialProvider(env);
    const database = openD1Database(env.DB);
    const authRepository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: env.BOOTSTRAP_ADMIN_TOKEN
    });
    return await createApiApp({
      runtime: 'cloudflare',
      database: 'd1',
      environment: env.ONE_VEGETABLE_ENVIRONMENT ?? 'local-worker',
      gatewayMode,
      ...(gatewayMode === 'real'
        ? { gateway: new AlibabaReadGatewayClient(credentialProvider.requireCredentials()) }
        : {}),
      apiPrefix: env.ONE_VEGETABLE_API_PREFIX,
      authService,
      adminService: new AdminService(authRepository),
      featureFlags: new StaticOperationFeatureFlags(
        new Set(
          env.ONE_VEGETABLE_MUTATION_FLAGS?.split(',')
            .map((flag) => flag.trim())
            .filter(Boolean) ?? []
        )
      ),
      requestEvents: new SqlRequestEventRepository(database.executor),
      requestEventRetentionDays: readRetentionDays(env.ONE_VEGETABLE_REQUEST_RETENTION_DAYS),
      ...(env.ONE_VEGETABLE_CORS_ORIGINS
        ? {
            allowedOrigins: env.ONE_VEGETABLE_CORS_ORIGINS.split(',').map(
              (origin) => new URL(origin.trim()).origin
            )
          }
        : {}),
      ready: () => isD1DatabaseReady(database)
    }).fetch(request, env);
  }
};

function readGatewayMode(value: string | undefined): 'mock' | 'disabled' | 'real' {
  if (value === undefined || value === 'mock') return 'mock';
  if (value === 'disabled' || value === 'real') return value;
  throw new Error('ONE_VEGETABLE_GATEWAY_MODE 无效');
}

function readRetentionDays(value: string | undefined): number {
  const days = Number(value ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('ONE_VEGETABLE_REQUEST_RETENTION_DAYS 必须为 1–90');
  }
  return days;
}
