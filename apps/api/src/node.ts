import { serve } from '@hono/node-server';

import { createApiApp } from './app';

const port = readPort(process.env.ONE_VEGETABLE_PORT);
const app = createApiApp({
  runtime: 'node',
  database: 'sqlite',
  environment: process.env.ONE_VEGETABLE_ENVIRONMENT ?? 'local-node',
  gatewayMode: readGatewayMode(process.env.ONE_VEGETABLE_GATEWAY_MODE),
  apiPrefix: process.env.ONE_VEGETABLE_API_PREFIX
});

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`oneVegetable API listening on http://localhost:${info.port}\n`);
});

function readPort(value: string | undefined): number {
  const port = Number(value ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('ONE_VEGETABLE_PORT 无效');
  return port;
}

function readGatewayMode(value: string | undefined): 'mock' | 'disabled' {
  return value === 'disabled' ? 'disabled' : 'mock';
}
