import { isAbsolute, resolve } from 'node:path';

import {
  callbackMatchesAlibabaRegistration,
  optionalAlibabaCredentialCallbackUrl,
  parseAlibabaCredentialCallbackUrl
} from '../../packages/core/src/alibaba-credential-acquisition';

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
  return callbackMatchesAlibabaRegistration(expected, actual);
}

function httpsUrl(value: string, name: string): URL {
  try {
    return parseAlibabaCredentialCallbackUrl(value);
  } catch {
    throw new Error(`${name} 必须是无凭据、无 fragment 的公共 HTTPS URL`);
  }
}

function optionalHttpsUrl(value: string | undefined, name: string): URL | null {
  try {
    return optionalAlibabaCredentialCallbackUrl(value);
  } catch {
    throw new Error(`${name} 必须是无凭据、无 fragment 的公共 HTTPS URL`);
  }
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
