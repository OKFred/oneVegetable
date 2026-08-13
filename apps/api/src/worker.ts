import { createApiApp } from './app';

interface Env {
  ONE_VEGETABLE_API_PREFIX?: string;
  ONE_VEGETABLE_ENVIRONMENT?: string;
  ONE_VEGETABLE_GATEWAY_MODE?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await createApiApp({
      runtime: 'cloudflare',
      database: 'd1',
      environment: env.ONE_VEGETABLE_ENVIRONMENT ?? 'local-worker',
      gatewayMode: env.ONE_VEGETABLE_GATEWAY_MODE === 'disabled' ? 'disabled' : 'mock',
      apiPrefix: env.ONE_VEGETABLE_API_PREFIX
    }).fetch(request, env);
  }
};
