import { createApiApp } from './app';
import { StaticOperationFeatureFlags } from './abac';
import { AdminService } from './auth/admin-service';
import { SqlAuthRepository } from './auth/repository';
import { AuthService } from './auth/service';
import { isD1DatabaseReady, openD1Database } from './db/d1-database';

interface Env {
  DB: D1Database;
  ONE_VEGETABLE_API_PREFIX?: string;
  ONE_VEGETABLE_ENVIRONMENT?: string;
  ONE_VEGETABLE_GATEWAY_MODE?: string;
  ONE_VEGETABLE_CORS_ORIGINS?: string;
  ONE_VEGETABLE_MUTATION_FLAGS?: string;
  BOOTSTRAP_ADMIN_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      gatewayMode: env.ONE_VEGETABLE_GATEWAY_MODE === 'disabled' ? 'disabled' : 'mock',
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
