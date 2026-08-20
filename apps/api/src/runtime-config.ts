import { normalizeApiPrefix } from '@one-vegetable/core';

export type GatewayMode = 'mock' | 'replay' | 'disabled' | 'real';

export interface RuntimeConfigurationEnvironment {
  ONE_VEGETABLE_API_PREFIX?: string;
  ONE_VEGETABLE_ENVIRONMENT?: string;
  ONE_VEGETABLE_GATEWAY_MODE?: string;
  ONE_VEGETABLE_CORS_ORIGINS?: string;
  ONE_VEGETABLE_MUTATION_FLAGS?: string;
  ONE_VEGETABLE_REQUEST_RETENTION_DAYS?: string;
}

export interface RuntimeConfiguration {
  apiPrefix: string;
  environment: string;
  gatewayMode: GatewayMode;
  allowedOrigins: readonly string[];
  mutationFlags: ReadonlySet<string>;
  requestEventRetentionDays: number;
}

export function readRuntimeConfiguration(
  input: RuntimeConfigurationEnvironment,
  defaultEnvironment: 'local-node' | 'local-worker'
): RuntimeConfiguration {
  const environment = readEnvironment(input.ONE_VEGETABLE_ENVIRONMENT, defaultEnvironment);
  const configuration: RuntimeConfiguration = {
    apiPrefix: normalizeApiPrefix(input.ONE_VEGETABLE_API_PREFIX),
    environment,
    gatewayMode: readGatewayMode(input.ONE_VEGETABLE_GATEWAY_MODE),
    allowedOrigins: readOrigins(input.ONE_VEGETABLE_CORS_ORIGINS, environment),
    mutationFlags: readMutationFlags(input.ONE_VEGETABLE_MUTATION_FLAGS),
    requestEventRetentionDays: readRetentionDays(input.ONE_VEGETABLE_REQUEST_RETENTION_DAYS)
  };
  assertDeploymentSafety(configuration);
  return configuration;
}

function readEnvironment(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? '';
  const environment = candidate === '' ? fallback : candidate;
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(environment)) {
    throw new Error('ONE_VEGETABLE_ENVIRONMENT 无效');
  }
  return environment;
}

function readGatewayMode(value: string | undefined): GatewayMode {
  if (value === undefined || value === '' || value === 'mock') return 'mock';
  if (value === 'replay' || value === 'disabled' || value === 'real') return value;
  throw new Error('ONE_VEGETABLE_GATEWAY_MODE 无效');
}

function readOrigins(value: string | undefined, environment: string): readonly string[] {
  if (!value?.trim()) {
    return environment === 'local-node' || environment === 'local-worker'
      ? ['http://localhost:5173', 'http://127.0.0.1:5173']
      : [];
  }
  const origins = value.split(',').map((rawOrigin) => {
    const origin = new URL(rawOrigin.trim());
    if (origin.href !== `${origin.origin}/`) {
      throw new Error('ONE_VEGETABLE_CORS_ORIGINS 只能包含 Origin');
    }
    return origin.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error('ONE_VEGETABLE_CORS_ORIGINS 包含重复 Origin');
  }
  return origins;
}

function readMutationFlags(value: string | undefined): ReadonlySet<string> {
  const flags =
    value
      ?.split(',')
      .map((flag) => flag.trim())
      .filter(Boolean) ?? [];
  return new Set(flags);
}

function readRetentionDays(value: string | undefined): number {
  const days = Number(value ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('ONE_VEGETABLE_REQUEST_RETENTION_DAYS 必须为 1–90');
  }
  return days;
}

function assertDeploymentSafety(configuration: RuntimeConfiguration): void {
  const deployed = configuration.environment === 'staging' || configuration.environment === 'production';
  if (!deployed) return;
  if (configuration.allowedOrigins.length === 0) {
    throw new Error(`${configuration.environment} 必须配置 CORS Origin`);
  }
  if (configuration.allowedOrigins.some((origin) => new URL(origin).protocol !== 'https:')) {
    throw new Error(`${configuration.environment} 的 CORS Origin 必须使用 HTTPS`);
  }
  if (configuration.mutationFlags.size > 0) {
    throw new Error(`${configuration.environment} 不允许启用 mutation flag`);
  }
  if (configuration.environment === 'staging' && configuration.gatewayMode === 'real') {
    throw new Error('staging 尚未允许真实 Alibaba 网关');
  }
  if (configuration.environment === 'production' && configuration.gatewayMode !== 'disabled') {
    throw new Error('production Alibaba 网关必须保持 disabled');
  }
}
