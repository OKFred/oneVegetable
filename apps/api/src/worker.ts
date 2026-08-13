import { createApiApp } from './app';
import { isD1DatabaseReady, openD1Database } from './db/d1-database';

interface Env {
  DB: D1Database;
  ONE_VEGETABLE_API_PREFIX?: string;
  ONE_VEGETABLE_ENVIRONMENT?: string;
  ONE_VEGETABLE_GATEWAY_MODE?: string;
  ONE_VEGETABLE_CORS_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const database = openD1Database(env.DB);
    return await createApiApp({
      runtime: 'cloudflare',
      database: 'd1',
      environment: env.ONE_VEGETABLE_ENVIRONMENT ?? 'local-worker',
      gatewayMode: env.ONE_VEGETABLE_GATEWAY_MODE === 'disabled' ? 'disabled' : 'mock',
      apiPrefix: env.ONE_VEGETABLE_API_PREFIX,
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
