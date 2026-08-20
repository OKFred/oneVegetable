import { isAbsolute, resolve } from 'node:path';

export interface OpenApiAuthConfiguration {
  targetUrl: URL;
  callbackUrl: URL | null;
  outputPath: string;
  diagnosticPath: string;
  screenshotPath: string;
  profileDirectory: string;
  appKey: string | null;
  appName: string | null;
  account: string | null;
  password: string | null;
  manualFallback: boolean;
  timeoutMilliseconds: number;
  manualTimeoutMilliseconds: number;
}

export function readOpenApiAuthConfiguration(
  environment: NodeJS.ProcessEnv,
  workingDirectory: string
): OpenApiAuthConfiguration {
  const outputPath = absolutePath(
    environment.OPEN_API_OUTPUT ?? 'artifacts/openapi-auth/credentials.json',
    workingDirectory
  );
  return {
    targetUrl: httpsUrl(
      environment.OPEN_API_TARGET_URL ?? 'https://i.alibaba.com/explore/open-api',
      'OPEN_API_TARGET_URL'
    ),
    callbackUrl: optionalHttpsUrl(environment.OPEN_API_CALLBACK_URL, 'OPEN_API_CALLBACK_URL'),
    outputPath,
    diagnosticPath: absolutePath(
      environment.OPEN_API_DIAGNOSTIC_OUTPUT ?? 'artifacts/openapi-auth/last-run.json',
      workingDirectory
    ),
    screenshotPath: absolutePath(
      environment.OPEN_API_SCREENSHOT ?? 'artifacts/openapi-auth/page.png',
      workingDirectory
    ),
    profileDirectory: absolutePath(
      environment.OPEN_API_PROFILE_DIR ?? 'artifacts/openapi-auth/profile',
      workingDirectory
    ),
    appKey: optionalString(environment.OPEN_API_APP_KEY),
    appName: optionalString(environment.OPEN_API_APP_NAME),
    account: optionalString(environment.ALI_ACCOUNT),
    password: optionalString(environment.ALL_PASS),
    manualFallback: booleanFlag(environment.OPEN_API_MANUAL_FALLBACK, true),
    timeoutMilliseconds: duration(environment.OPEN_API_TIMEOUT_MS, 180_000, 'OPEN_API_TIMEOUT_MS'),
    manualTimeoutMilliseconds: duration(
      environment.OPEN_API_MANUAL_TIMEOUT_MS,
      600_000,
      'OPEN_API_MANUAL_TIMEOUT_MS'
    )
  };
}

export function callbackMatches(expected: URL, actual: URL): boolean {
  return (
    expected.origin === actual.origin && normalizePath(expected.pathname) === normalizePath(actual.pathname)
  );
}

function httpsUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 不是有效 URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.hostname === 'localhost' ||
    isPrivateHost(url.hostname)
  ) {
    throw new Error(`${name} 必须是无凭据、无 fragment 的公共 HTTPS URL`);
  }
  return url;
}

function optionalHttpsUrl(value: string | undefined, name: string): URL | null {
  const candidate = optionalString(value);
  return candidate ? httpsUrl(candidate, name) : null;
}

function optionalString(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

function absolutePath(value: string, workingDirectory: string): string {
  const candidate = value.trim();
  if (candidate === '') throw new Error('输出路径不能为空');
  return isAbsolute(candidate) ? candidate : resolve(workingDirectory, candidate);
}

function booleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  throw new Error('OPEN_API_MANUAL_FALLBACK 只能是 1/0 或 true/false');
}

function duration(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1_000 || result > 3_600_000) {
    throw new Error(`${name} 必须是 1000 到 3600000 之间的整数毫秒`);
  }
  return result;
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '0.0.0.0') return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
