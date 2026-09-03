import { randomUUID } from 'node:crypto';

import { chromium } from '@playwright/test';

import {
  callbackMatchesAlibabaRegistration,
  validateAlibabaOAuthCallback
} from '../../packages/core/src/alibaba-credential-acquisition';
import { createAlibabaOpenApiCredentialBundle } from '../../packages/core/src/alibaba-credential-bundle';

import {
  authorizeApplication,
  captureSafeScreenshot,
  closeContext,
  ensureAlibabaLogin,
  openApplicationCenter,
  revealAppSecret,
  selectApplication,
  updateCallbackUrl
} from './browser';
import { exchangeAuthorizationCode } from './oauth';
import { OpenApiAuthError } from './storage';

import type { OpenApiAuthConfiguration } from './config';
import type { AlibabaOpenApiCredentialBundle, OpenApiAuthDiagnostic, OpenApiAuthStage } from './types';

export interface NodePlaywrightAuthProgress {
  stage: OpenApiAuthStage;
  currentUrl: string | null;
  prerequisite: OpenApiAuthDiagnostic['prerequisite'];
  selectedApplication: OpenApiAuthDiagnostic['selectedApplication'];
  callback: OpenApiAuthDiagnostic['callback'];
  screenshotSaved: boolean;
}

export interface NodePlaywrightAuthOptions {
  confirmCallbackChange: (currentUrl: URL, requestedUrl: URL) => Promise<boolean>;
  onProgress?: (progress: NodePlaywrightAuthProgress) => void;
}

export interface NodePlaywrightAuthResult {
  bundle: AlibabaOpenApiCredentialBundle;
  progress: NodePlaywrightAuthProgress;
}

export function createNodePlaywrightAuthProgress(): NodePlaywrightAuthProgress {
  return {
    stage: 'configuration',
    currentUrl: null,
    prerequisite: null,
    selectedApplication: { appName: null, appKeySuffix: null, status: null },
    callback: {
      configuredOrigin: null,
      configuredPath: null,
      updated: false,
      stateMatched: false
    },
    screenshotSaved: false
  };
}

export async function acquireAlibabaCredentialWithNodePlaywright(
  configuration: OpenApiAuthConfiguration,
  options: NodePlaywrightAuthOptions
): Promise<NodePlaywrightAuthResult> {
  let progress = createNodePlaywrightAuthProgress();
  let secretRevealStarted = false;
  const update = (value: Partial<NodePlaywrightAuthProgress>): void => {
    progress = {
      ...progress,
      ...value,
      selectedApplication: value.selectedApplication ?? progress.selectedApplication,
      callback: value.callback ?? progress.callback
    };
    options.onProgress?.(cloneProgress(progress));
  };

  update({ stage: 'browser' });
  const context = await chromium.launchPersistentContext(configuration.profileDirectory, {
    channel: 'chrome',
    headless: false,
    acceptDownloads: false,
    viewport: { width: 1440, height: 960 }
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    update({ stage: 'login', currentUrl: page.url() });
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

    update({ stage: 'application', currentUrl: page.url() });
    const frame = await openApplicationCenter(page, configuration.timeoutMilliseconds);
    let application = await selectApplication(
      frame,
      { appKey: configuration.appKey, appName: configuration.appName },
      configuration.timeoutMilliseconds
    );
    update({
      selectedApplication: {
        appName: application.appName,
        appKeySuffix: application.appKey.slice(-4),
        status: application.status
      }
    });

    if (
      configuration.callbackUrl &&
      (!callbackMatchesAlibabaRegistration(configuration.callbackUrl, application.callbackUrl) ||
        configuration.callbackUrl.search !== application.callbackUrl.search)
    ) {
      if (application.source === 'legacy-crosstrade') {
        throw new OpenApiAuthError(
          'LEGACY_CALLBACK_UPDATE_UNSUPPORTED',
          '旧 OAuth 应用的 Callback 不能通过新版应用中心安全修改；请先在对应旧平台确认配置'
        );
      }
      update({ stage: 'callback-update' });
      const confirmed = await options.confirmCallbackChange(
        application.callbackUrl,
        configuration.callbackUrl
      );
      if (confirmed) {
        application = await updateCallbackUrl(
          frame,
          configuration.callbackUrl,
          configuration.timeoutMilliseconds
        );
        update({ callback: { ...progress.callback, updated: true } });
      }
    }

    update({
      callback: {
        ...progress.callback,
        configuredOrigin: application.callbackUrl.origin,
        configuredPath: application.callbackUrl.pathname
      }
    });
    await captureSafeScreenshot(page, configuration.screenshotPath);
    update({ screenshotSaved: true });

    secretRevealStarted = true;
    const revealed = await revealAppSecret(frame, application, configuration.timeoutMilliseconds);
    if (revealed.appKey) application = { ...application, appKey: revealed.appKey };
    update({
      selectedApplication: {
        appName: application.appName,
        appKeySuffix: application.appKey.slice(-4),
        status: application.status
      },
      stage: 'authorization'
    });
    const state = randomUUID();
    const callback = await authorizeApplication(page, application, state, {
      timeoutMilliseconds: configuration.timeoutMilliseconds,
      manualFallback: configuration.manualFallback,
      manualTimeoutMilliseconds: configuration.manualTimeoutMilliseconds
    });
    const code = validateAlibabaOAuthCallback(callback, application.callbackUrl, state);
    update({ callback: { ...progress.callback, stateMatched: true }, stage: 'token-exchange' });

    const token = await exchangeAuthorizationCode(context.request, {
      appKey: application.appKey,
      appSecret: revealed.appSecret,
      code,
      redirectUri: application.callbackUrl.href
    });
    const bundle = createAlibabaOpenApiCredentialBundle({
      capturedAtTimeUtc: Date.now(),
      application: {
        appName: application.appName,
        appKey: application.appKey,
        appSecret: revealed.appSecret,
        callbackUrl: application.callbackUrl.href,
        status: application.status,
        permissions: application.permissions
      },
      token,
      receivedCallbackUrl: callback.href
    });
    update({ stage: 'storage', currentUrl: page.url() });
    return { bundle, progress: cloneProgress(progress) };
  } catch (error: unknown) {
    update({ currentUrl: page.url() });
    if (error instanceof OpenApiAuthError && error.prerequisiteReason) {
      update({
        prerequisite: {
          status: 'prerequisite-required',
          reasonCode: error.prerequisiteReason,
          checkedAtUtc: Date.now()
        }
      });
    }
    if (!progress.screenshotSaved && !secretRevealStarted) {
      await captureSafeScreenshot(page, configuration.screenshotPath).catch(() => undefined);
      update({ screenshotSaved: true });
    }
    throw error;
  } finally {
    await closeContext(context);
  }
}

function cloneProgress(progress: NodePlaywrightAuthProgress): NodePlaywrightAuthProgress {
  return {
    ...progress,
    prerequisite: progress.prerequisite ? { ...progress.prerequisite } : null,
    selectedApplication: { ...progress.selectedApplication },
    callback: { ...progress.callback }
  };
}
