export interface WranglerD1Binding {
  binding?: string;
  database_name?: string;
  database_id?: string;
  migrations_dir?: string;
}

export interface WranglerEnvironment {
  name?: string;
  workers_dev?: boolean;
  vars?: Record<string, string>;
  d1_databases?: WranglerD1Binding[];
}

export interface WranglerConfiguration extends WranglerEnvironment {
  compatibility_date?: string;
  env?: Record<string, WranglerEnvironment>;
}

export interface DeploymentPreflightEnvironment {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  STAGING_BASE_URL?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

export interface StagingPreflightOptions {
  allowPlaceholders?: boolean;
  requireDeploymentEnvironment?: boolean;
  now?: Date;
}

const PLACEHOLDER_DATABASE_ID = /^00000000-0000-0000-0000-00000000000\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function stagingPreflightIssues(
  configuration: WranglerConfiguration,
  environment: DeploymentPreflightEnvironment,
  options: StagingPreflightOptions = {}
): string[] {
  const issues: string[] = [];
  validateCompatibilityDate(configuration.compatibility_date, options.now ?? new Date(), issues);
  const staging = configuration.env?.staging;
  const production = configuration.env?.production;
  if (!staging) issues.push('wrangler 缺少 staging 环境');
  if (!production) issues.push('wrangler 缺少 production 环境');
  if (staging) validateStaging(staging, options.allowPlaceholders === true, issues);
  if (production) validateProduction(production, options.allowPlaceholders === true, issues);
  if (staging && production) validateDatabaseIsolation(staging, production, issues);
  if (options.requireDeploymentEnvironment !== false) {
    validateDeploymentEnvironment(environment, options.allowPlaceholders === true, issues);
  }
  return issues;
}

function validateCompatibilityDate(value: string | undefined, now: Date, issues: string[]): void {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push('compatibility_date 必须使用 YYYY-MM-DD');
    return;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime()) {
    issues.push('compatibility_date 无效或晚于当前日期');
  }
}

function validateStaging(staging: WranglerEnvironment, allowPlaceholders: boolean, issues: string[]): void {
  if (staging.vars?.ONE_VEGETABLE_ENVIRONMENT !== 'staging') {
    issues.push('staging 的 ONE_VEGETABLE_ENVIRONMENT 必须为 staging');
  }
  if (staging.vars?.ONE_VEGETABLE_GATEWAY_MODE !== 'replay') {
    issues.push('staging 的 Alibaba 网关必须为 replay');
  }
  validateCommonDeployment(staging, 'staging', allowPlaceholders, issues);
}

function validateProduction(
  production: WranglerEnvironment,
  allowPlaceholders: boolean,
  issues: string[]
): void {
  if (production.vars?.ONE_VEGETABLE_ENVIRONMENT !== 'production') {
    issues.push('production 的 ONE_VEGETABLE_ENVIRONMENT 必须为 production');
  }
  if (production.vars?.ONE_VEGETABLE_GATEWAY_MODE !== 'disabled') {
    issues.push('production 的 Alibaba 网关必须为 disabled');
  }
  if (production.workers_dev !== false) issues.push('production 必须关闭 workers_dev');
  validateCommonDeployment(production, 'production', allowPlaceholders, issues);
}

function validateCommonDeployment(
  target: WranglerEnvironment,
  name: 'staging' | 'production',
  allowPlaceholders: boolean,
  issues: string[]
): void {
  if (target.vars?.ONE_VEGETABLE_MUTATION_FLAGS?.trim()) {
    issues.push(`${name} 不允许启用 mutation flag`);
  }
  const prefix = target.vars?.ONE_VEGETABLE_API_PREFIX;
  if (!prefix || !prefix.startsWith('/') || prefix.endsWith('/')) {
    issues.push(`${name} API prefix 无效`);
  }
  const origins = target.vars?.ONE_VEGETABLE_CORS_ORIGINS?.split(',') ?? [];
  if (origins.length === 0 || origins.some((origin) => !isSafeHttpsOrigin(origin, allowPlaceholders))) {
    issues.push(`${name} CORS 必须是非占位 HTTPS Origin`);
  }
  const binding = target.d1_databases?.find((item) => item.binding === 'DB');
  if (!binding) {
    issues.push(`${name} 缺少 DB binding`);
    return;
  }
  if (
    !binding.database_id ||
    (!UUID.test(binding.database_id) &&
      !(allowPlaceholders && PLACEHOLDER_DATABASE_ID.test(binding.database_id)))
  ) {
    issues.push(`${name} D1 database_id 必须是 UUID`);
  } else if (!allowPlaceholders && PLACEHOLDER_DATABASE_ID.test(binding.database_id)) {
    issues.push(`${name} D1 database_id 仍是占位符`);
  }
  if (!binding.database_name?.trim()) issues.push(`${name} D1 database_name 缺失`);
  if (binding.migrations_dir !== 'drizzle') issues.push(`${name} D1 migrations_dir 必须为 drizzle`);
}

function validateDatabaseIsolation(
  staging: WranglerEnvironment,
  production: WranglerEnvironment,
  issues: string[]
): void {
  const stagingDatabase = staging.d1_databases?.find((item) => item.binding === 'DB');
  const productionDatabase = production.d1_databases?.find((item) => item.binding === 'DB');
  if (
    stagingDatabase?.database_id &&
    stagingDatabase.database_id === productionDatabase?.database_id &&
    !PLACEHOLDER_DATABASE_ID.test(stagingDatabase.database_id)
  ) {
    issues.push('staging 与 production 必须使用不同 D1 database_id');
  }
  if (stagingDatabase?.database_name && stagingDatabase.database_name === productionDatabase?.database_name) {
    issues.push('staging 与 production 必须使用不同 D1 database_name');
  }
}

function validateDeploymentEnvironment(
  environment: DeploymentPreflightEnvironment,
  allowPlaceholders: boolean,
  issues: string[]
): void {
  for (const key of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CF_ACCESS_CLIENT_ID',
    'CF_ACCESS_CLIENT_SECRET'
  ] as const) {
    if (!environment[key]?.trim()) issues.push(`部署环境缺少 ${key}`);
  }
  if (!environment.STAGING_BASE_URL) {
    issues.push('部署环境缺少 STAGING_BASE_URL');
  } else if (!isSafeHttpsOrigin(environment.STAGING_BASE_URL, allowPlaceholders)) {
    issues.push('STAGING_BASE_URL 必须是非占位 HTTPS Origin');
  }
}

function isSafeHttpsOrigin(rawValue: string, allowPlaceholders: boolean): boolean {
  try {
    const value = rawValue.trim();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.href !== `${url.origin}/`) return false;
    return allowPlaceholders || !/\.invalid$|example\.(?:com|org|net)$/i.test(url.hostname);
  } catch {
    return false;
  }
}
