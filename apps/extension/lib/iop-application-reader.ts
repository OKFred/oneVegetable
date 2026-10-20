import { browser } from 'wxt/browser';
import {
  ALIBABA_APPLICATION_CENTER_URL,
  inspectAlibabaApplicationCenter,
  inspectAlibabaApplicationPageState,
  revealAlibabaApplicationSecret,
  showAlibabaAuthorizationGuide,
  type AlibabaAuthorizationGuidePhase,
  type ExtensionAlibabaApplicationDetails,
  type ExtensionAlibabaPageState,
  type ExtensionAlibabaSecretResult
} from './alibaba-credential-page-driver';
import { clickAlibabaGuidedTarget, type AlibabaGuidedTarget } from './alibaba-guided-click';
import { failure, parseCallback } from './iop-authorization';
import {
  authorizationDiscoveryReason,
  type AuthorizationDiscoveryReason
} from './authorization-discovery-reason';
export { IOP_APPLICATION_READER_ORIGINS } from './iop-authorization-storage';

export interface IopApplicationReadResult {
  appName: string;
  appKey: string;
  appSecret: string;
  callbackUrl: string;
}
interface ReaderDriver {
  open(): Promise<number>;
  inspect(
    tabId: number
  ): Promise<{ application: ExtensionAlibabaApplicationDetails | null; frameId?: number }>;
  state(tabId: number): Promise<ExtensionAlibabaPageState>;
  click(
    tabId: number,
    target: AlibabaGuidedTarget,
    frameId?: number,
    expectedAppKey?: string,
    expiresAtUtc?: number
  ): Promise<boolean>;
  secret(tabId: number, frameId?: number, expectedAppKey?: string): Promise<ExtensionAlibabaSecretResult>;
  wait(): Promise<void>;
  guide?(
    tabId: number,
    phase: AlibabaAuthorizationGuidePhase,
    reasonCode?: AuthorizationDiscoveryReason
  ): Promise<void>;
}
const driver: ReaderDriver = {
  async open() {
    const tabs = await browser.tabs.query({ url: 'https://i.alibaba.com/explore/open-api*' });
    const candidates = tabs.filter((tab) => {
      if (!tab.url || tab.id === undefined) return false;
      const url = new URL(tab.url);
      return url.origin === 'https://i.alibaba.com' && url.pathname === '/explore/open-api';
    });
    if (candidates.length > 1) throw failure('IOP_APP_SELECTION_REQUIRED');
    const existing = candidates[0];
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      return existing.id;
    }
    const tab = await browser.tabs.create({ url: ALIBABA_APPLICATION_CENTER_URL, active: true });
    if (tab.id === undefined) throw failure('IOP_APP_READ_FAILED');
    return tab.id;
  },
  inspect: (tabId) => inspectAlibabaApplicationCenter(tabId, true),
  state: inspectAlibabaApplicationPageState,
  click: clickAlibabaGuidedTarget,
  secret: (tabId, frameId, expectedAppKey) =>
    revealAlibabaApplicationSecret(tabId, true, frameId, expectedAppKey),
  guide: (tabId, phase, reasonCode) => showAlibabaAuthorizationGuide(tabId, 'iop', phase, reasonCode),
  wait: () => new Promise((resolve) => setTimeout(resolve, 500))
};

/** One bounded, read-only discovery at a time. Nothing here is written to storage. */
export class IopApplicationReader {
  private running = false;
  constructor(
    private readonly page: ReaderDriver = driver,
    private readonly clock = Date.now
  ) {}

  async read(): Promise<IopApplicationReadResult> {
    if (this.running) throw failure('AUTH_TASK_ACTIVE');
    this.running = true;
    let centerClicked = false;
    let secretClicked = false;
    let guideShown = false;
    let activeTabId: number | undefined;
    let selectedApplication: string | undefined;
    let waitingReason: AuthorizationDiscoveryReason = 'IOP_APP_READ_FAILED';
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = this.clock() + 30_000;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(failure(waitingReason));
      }, 30_000);
    });
    const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, timeout]);
    try {
      const tabId = await bounded(this.page.open());
      activeTabId = tabId;
      // Iteration bound also protects against a broken/rolled-back local clock.
      for (let attempt = 0; attempt < 50 && this.clock() < deadline; attempt += 1) {
        if (!guideShown && this.page.guide) {
          // The tab can still be loading on the first attempt. Inject before
          // inspecting or clicking Application center as soon as DOM is ready.
          guideShown = await bounded(this.page.guide(tabId, 'opening')).then(
            () => true,
            () => false
          );
        }
        if (this.page.guide && !guideShown) {
          await bounded(this.page.wait());
          continue;
        }
        let state: ExtensionAlibabaPageState;
        // Set before awaiting: the deadline rejection captures the current phase,
        // and cannot be corrected by changing waitingReason after it has rejected.
        waitingReason = 'IOP_APP_PAGE_UNAVAILABLE';
        try {
          state = await bounded(this.page.state(tabId));
        } catch {
          waitingReason = 'IOP_APP_PAGE_UNAVAILABLE';
          await bounded(this.page.wait());
          continue;
        }
        if (state.kind === 'challenge') throw failure('IOP_APP_SECURITY_CHECK');
        if (state.kind === 'login-required') throw failure('IOP_APP_LOGIN_REQUIRED');
        if (state.kind === 'prerequisite') throw failure('IOP_APP_PREREQUISITE_REQUIRED');
        let inspected: Awaited<ReturnType<ReaderDriver['inspect']>>;
        try {
          inspected = await bounded(this.page.inspect(tabId));
        } catch {
          // Entering Application center can replace its iframe while a read is
          // in flight. Wait within the same deadline instead of failing at once.
          waitingReason = 'IOP_APP_PAGE_UNAVAILABLE';
          await bounded(this.page.wait());
          continue;
        }
        const { application, frameId } = inspected;
        if (application?.source === 'application-center') {
          const identity = JSON.stringify([application.appKey, application.callbackUrl, frameId]);
          if (selectedApplication !== undefined && identity !== selectedApplication)
            throw failure('IOP_APP_CHANGED');
          selectedApplication = identity;
          if (this.page.guide && !secretClicked)
            await bounded(this.page.guide(tabId, 'application')).catch(() => undefined);
          const callbackUrl = parseCallback(application.callbackUrl).href;
          waitingReason = secretClicked ? 'IOP_APP_SECRET_UNAVAILABLE' : 'IOP_APP_SECRET_CONTROL_UNAVAILABLE';
          const result = await bounded(this.page.secret(tabId, frameId, application.appKey));
          if (result.status === 'available') {
            if (this.page.guide) await bounded(this.page.guide(tabId, 'ready')).catch(() => undefined);
            return {
              appName: application.appName,
              appKey: application.appKey,
              appSecret: result.appSecret,
              callbackUrl
            };
          }
          if (result.reason === 'security-verification') throw failure('IOP_APP_SECURITY_CHECK');
          if (!secretClicked) {
            if (this.page.guide) await bounded(this.page.guide(tabId, 'secret')).catch(() => undefined);
            secretClicked = await bounded(
              this.page.click(tabId, 'reveal-secret', frameId, application.appKey, deadline)
            );
            // A blocked View control requires the user, not repeated guided
            // clicks. Keep this concrete reason instead of timing out in a
            // later generic page-inspection phase.
            if (!secretClicked) throw failure('IOP_APP_SECRET_CONTROL_UNAVAILABLE');
            waitingReason = 'IOP_APP_SECRET_UNAVAILABLE';
          }
        } else if (!centerClicked && ['navigation-ready', 'registration-approved'].includes(state.kind)) {
          waitingReason = 'IOP_APP_CENTER_UNAVAILABLE';
          centerClicked = await bounded(
            this.page.click(tabId, 'application-center', undefined, undefined, deadline)
          );
          if (centerClicked) waitingReason = 'IOP_APP_READ_FAILED';
        } else {
          waitingReason = 'IOP_APP_READ_FAILED';
        }
        await bounded(this.page.wait());
      }
      throw failure(waitingReason);
    } catch (error) {
      // No raw DOM, credential values or provider error text leave this boundary.
      const code =
        error instanceof Error &&
        'gatewayError' in error &&
        typeof error.gatewayError === 'object' &&
        error.gatewayError !== null &&
        'code' in error.gatewayError
          ? (authorizationDiscoveryReason(error.gatewayError.code) ?? waitingReason)
          : waitingReason;
      if (activeTabId !== undefined && this.page.guide) {
        // The discovery deadline may already be rejected. Give its final safe
        // status a separate bounded delivery so the guide does not stay spinning.
        let guideTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.page.guide(activeTabId, 'blocked', code),
            new Promise<void>((resolve) => {
              guideTimeout = setTimeout(resolve, 1500);
            })
          ]);
        } catch {
          // The original bounded failure still reaches the authorization tool.
        } finally {
          clearTimeout(guideTimeout);
        }
      }
      throw failure(code);
    } finally {
      this.running = false;
      clearTimeout(timeoutHandle);
    }
  }
}
