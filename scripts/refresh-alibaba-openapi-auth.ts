import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { request } from '@playwright/test';

import { readCredentialBundle } from './openapi-auth/bundle';
import { readOpenApiAuthConfiguration } from './openapi-auth/config';
import { expiryFromSeconds, refreshAccessToken } from './openapi-auth/oauth';
import { atomicWriteJson, safeError } from './openapi-auth/storage';

if (existsSync('.env')) loadEnvFile('.env');

const configuration = readOpenApiAuthConfiguration(process.env, process.cwd());
const api = await request.newContext();

try {
  const bundle = await readCredentialBundle(configuration.outputPath);
  if (!bundle.oauth.refreshToken) {
    throw new Error('授权包没有 Refresh Token，请重新运行 pnpm openapi:auth');
  }
  const refreshed = await refreshAccessToken(api, {
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    refreshToken: bundle.oauth.refreshToken
  });
  const capturedAt = new Date();
  await atomicWriteJson(configuration.outputPath, {
    ...bundle,
    capturedAtUtc: capturedAt.toISOString(),
    oauth: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? bundle.oauth.refreshToken,
      expiresAtUtc: expiryFromSeconds(capturedAt, refreshed.expiresInSeconds),
      refreshExpiresAtUtc:
        expiryFromSeconds(capturedAt, refreshed.refreshExpiresInSeconds) ?? bundle.oauth.refreshExpiresAtUtc
    }
  });
  process.stdout.write(`OpenAPI Access Token 已刷新：${configuration.outputPath}\n`);
} catch (error) {
  const safe = safeError(error);
  process.stderr.write(`OpenAPI Token 刷新失败：${safe.code} ${safe.message}\n`);
  process.exitCode = 1;
} finally {
  await api.dispose();
}
