import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { chromium } from '@playwright/test';

import {
  authorizeApplication,
  captureSafeScreenshot,
  closeContext,
  ensureAlibabaLogin,
  openApplicationCenter,
  revealAppSecret,
  selectApplication,
  updateCallbackUrl
} from './openapi-auth/browser';
import { readOpenApiAuthConfiguration } from './openapi-auth/config';
import { exchangeAuthorizationCode, expiryFromSeconds, validateCallback } from './openapi-auth/oauth';
import { atomicWriteJson, OpenApiAuthError, safeError } from './openapi-auth/storage';
import type {
  AlibabaOpenApiCredentialBundle,
  OpenApiAuthDiagnostic,
  OpenApiAuthStage
} from './openapi-auth/types';

loadLocalEnvironment();

const configuration = readOpenApiAuthConfiguration(process.env, process.cwd());
let stage: OpenApiAuthStage = 'configuration';
let currentUrl: string | null = null;
let selectedApplication: OpenApiAuthDiagnostic['selectedApplication'] = {
  appName: null,
  appKeySuffix: null,
  status: null
};
const callbackDiagnostic: OpenApiAuthDiagnostic['callback'] = {
  configuredOrigin: null,
  configuredPath: null,
  updated: false,
  stateMatched: false
};
let screenshotSaved = false;

const context = await chromium.launchPersistentContext(configuration.profileDirectory, {
  channel: 'chrome',
  headless: false,
  acceptDownloads: false,
  viewport: { width: 1440, height: 960 }
});
const page = context.pages()[0] ?? (await context.newPage());

try {
  stage = 'login';
  await ensureAlibabaLogin(
    page,
    configuration.targetUrl,
    { account: configuration.account, password: configuration.password },
    {
      timeoutMilliseconds: configuration.timeoutMilliseconds,
      manualFallback: configuration.manualFallback,
      manualTimeoutMilliseconds: configuration.manualTimeoutMilliseconds
    }
  );

  stage = 'application';
  const frame = await openApplicationCenter(page, configuration.timeoutMilliseconds);
  let application = await selectApplication(
    frame,
    { appKey: configuration.appKey, appName: configuration.appName },
    configuration.timeoutMilliseconds
  );
  selectedApplication = {
    appName: application.appName,
    appKeySuffix: application.appKey.slice(-4),
    status: application.status
  };

  if (configuration.callbackUrl) {
    if (application.source === 'legacy-crosstrade') {
      throw new OpenApiAuthError(
        'LEGACY_CALLBACK_UPDATE_UNSUPPORTED',
        '旧 OAuth 应用的 Callback 不能通过新版应用中心安全修改；请先在对应旧平台确认配置'
      );
    }
    stage = 'callback-update';
    const previous = application.callbackUrl.href;
    application = await updateCallbackUrl(
      frame,
      configuration.callbackUrl,
      configuration.timeoutMilliseconds
    );
    callbackDiagnostic.updated = previous !== application.callbackUrl.href;
  }
  callbackDiagnostic.configuredOrigin = application.callbackUrl.origin;
  callbackDiagnostic.configuredPath = application.callbackUrl.pathname;

  await captureSafeScreenshot(page, configuration.screenshotPath);
  screenshotSaved = true;

  const revealed = await revealAppSecret(frame, application, configuration.timeoutMilliseconds);
  if (revealed.appKey) application = { ...application, appKey: revealed.appKey };
  selectedApplication = {
    appName: application.appName,
    appKeySuffix: application.appKey.slice(-4),
    status: application.status
  };
  stage = 'authorization';
  const state = randomUUID();
  const callback = await authorizeApplication(page, application, state, {
    timeoutMilliseconds: configuration.timeoutMilliseconds,
    manualFallback: configuration.manualFallback,
    manualTimeoutMilliseconds: configuration.manualTimeoutMilliseconds
  });
  const code = validateCallback(callback, state);
  callbackDiagnostic.stateMatched = true;

  stage = 'token-exchange';
  const token = await exchangeAuthorizationCode(context.request, {
    appKey: application.appKey,
    appSecret: revealed.appSecret,
    code,
    redirectUri: application.callbackUrl.href
  });
  const capturedAt = new Date();
  const bundle: AlibabaOpenApiCredentialBundle = {
    schemaVersion: 1,
    capturedAtUtc: capturedAt.toISOString(),
    application: {
      appName: application.appName,
      appKey: application.appKey,
      appSecret: revealed.appSecret,
      callbackUrl: application.callbackUrl.href,
      status: application.status,
      permissions: application.permissions
    },
    oauth: {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAtUtc: expiryFromSeconds(capturedAt, token.expiresInSeconds),
      refreshExpiresAtUtc: expiryFromSeconds(capturedAt, token.refreshExpiresInSeconds)
    },
    callback: {
      receivedAtUtc: capturedAt.toISOString(),
      stateMatched: true,
      callbackOrigin: callback.origin,
      callbackPath: callback.pathname
    }
  };

  stage = 'storage';
  await atomicWriteJson(configuration.outputPath, bundle);
  stage = 'complete';
  currentUrl = page.url();
  await writeDiagnostic(true, null);
  process.stdout.write(`OpenAPI 授权包已保存：${configuration.outputPath}\n`);
  process.stdout.write('该文件包含明文密钥，仅限本机开发使用。\n');
} catch (error) {
  currentUrl = page.url();
  if (!screenshotSaved) {
    await captureSafeScreenshot(page, configuration.screenshotPath).catch(() => undefined);
    screenshotSaved = true;
  }
  await writeDiagnostic(false, safeError(error));
  process.stderr.write(`OpenAPI 授权失败：${safeError(error).code} ${safeError(error).message}\n`);
  process.exitCode = 1;
} finally {
  await closeContext(context);
}

async function writeDiagnostic(ok: boolean, error: OpenApiAuthDiagnostic['error']): Promise<void> {
  const diagnostic: OpenApiAuthDiagnostic = {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    ok,
    stage,
    targetUrl: configuration.targetUrl.href,
    currentUrl: safeUrl(currentUrl),
    selectedApplication,
    callback: callbackDiagnostic,
    error,
    savedFiles: [configuration.diagnosticPath, ...(screenshotSaved ? [configuration.screenshotPath] : [])]
  };
  await atomicWriteJson(configuration.diagnosticPath, diagnostic);
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function loadLocalEnvironment(): void {
  if (!existsSync('.env')) return;
  loadEnvFile('.env');
}
