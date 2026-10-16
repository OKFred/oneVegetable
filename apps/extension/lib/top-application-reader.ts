import { browser } from 'wxt/browser';
import {
  findAlibabaLegacyApplicationTab,
  readAlibabaLegacyApplications,
  revealAlibabaLegacyApplicationSecret,
  showAlibabaAuthorizationGuide
} from './alibaba-credential-page-driver';
import { failure, parseCallback } from './iop-authorization';
import type { IopApplicationReadResult } from './iop-application-reader';
import { authorizationDiscoveryReason } from './authorization-discovery-reason';

/** Never synthesize a TOP app from the IOP console or reopen a retired 404 URL. */
export async function readTopApplication(): Promise<IopApplicationReadResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + 30_000;
  try {
    return await Promise.race([
      readTopApplicationCore(deadline),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(failure('TOP_APP_NOT_AVAILABLE'));
        }, 30_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readTopApplicationCore(deadline: number): Promise<IopApplicationReadResult> {
  const tabId = await findAlibabaLegacyApplicationTab();
  if (tabId === null) throw failure('TOP_APP_NOT_AVAILABLE');
  await browser.tabs.update(tabId, { active: true });
  await showAlibabaAuthorizationGuide(tabId, 'top', 'opening').catch(() => undefined);
  try {
    const candidates = await readAlibabaLegacyApplications(tabId);
    if (Date.now() >= deadline) throw failure('TOP_APP_NOT_AVAILABLE');
    if (candidates.length !== 1)
      throw failure(candidates.length > 1 ? 'TOP_APP_SELECTION_REQUIRED' : 'TOP_APP_NOT_AVAILABLE');
    const application = candidates[0];
    if (application?.source !== 'legacy-crosstrade' || !application.callbackUrl)
      throw failure('TOP_APP_NOT_AVAILABLE');
    const callbackUrl = parseCallback(application.callbackUrl).href;
    await showAlibabaAuthorizationGuide(tabId, 'top', 'secret').catch(() => undefined);
    const secret = await revealAlibabaLegacyApplicationSecret(tabId, application.appKey);
    if (Date.now() >= deadline) throw failure('TOP_APP_NOT_AVAILABLE');
    if (secret.status !== 'available') throw failure('TOP_APP_NOT_AVAILABLE');
    await showAlibabaAuthorizationGuide(tabId, 'top', 'ready').catch(() => undefined);
    return {
      appName: application.appName,
      appKey: application.appKey,
      appSecret: secret.appSecret,
      callbackUrl
    };
  } catch (error) {
    const code =
      error instanceof Error &&
      'gatewayError' in error &&
      typeof error.gatewayError === 'object' &&
      error.gatewayError !== null &&
      'code' in error.gatewayError
        ? (authorizationDiscoveryReason(error.gatewayError.code) ?? 'TOP_APP_NOT_AVAILABLE')
        : 'TOP_APP_NOT_AVAILABLE';
    await showAlibabaAuthorizationGuide(tabId, 'top', 'blocked', code).catch(() => undefined);
    if (error instanceof Error && 'gatewayError' in error) throw error;
    throw failure('TOP_APP_NOT_AVAILABLE');
  }
}
