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
  guide?(tabId: number, phase: AlibabaAuthorizationGuidePhase): Promise<void>;
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
  guide: (tabId, phase) => showAlibabaAuthorizationGuide(tabId, 'iop', phase),
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
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = this.clock() + 30_000;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(failure('IOP_APP_READ_FAILED'));
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
        try {
          state = await bounded(this.page.state(tabId));
        } catch {
          await bounded(this.page.wait());
          continue;
        }
        if (state.kind === 'challenge') throw failure('IOP_APP_SECURITY_CHECK');
        if (state.kind === 'login-required') throw failure('IOP_APP_LOGIN_REQUIRED');
        if (state.kind === 'prerequisite') throw failure('IOP_APP_PREREQUISITE_REQUIRED');
        const { application, frameId } = await bounded(this.page.inspect(tabId));
        if (application?.source === 'application-center') {
          const identity = JSON.stringify([application.appKey, application.callbackUrl, frameId]);
          if (selectedApplication !== undefined && identity !== selectedApplication)
            throw failure('IOP_APP_CHANGED');
          selectedApplication = identity;
          if (this.page.guide && !secretClicked)
            await bounded(this.page.guide(tabId, 'application')).catch(() => undefined);
          const callbackUrl = parseCallback(application.callbackUrl).href;
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
          }
        } else if (!centerClicked && ['navigation-ready', 'registration-approved'].includes(state.kind)) {
          centerClicked = await bounded(
            this.page.click(tabId, 'application-center', undefined, undefined, deadline)
          );
        }
        await bounded(this.page.wait());
      }
      throw failure(secretClicked ? 'IOP_APP_SECRET_UNAVAILABLE' : 'IOP_APP_READ_FAILED');
    } catch (error) {
      if (activeTabId !== undefined && this.page.guide)
        await bounded(this.page.guide(activeTabId, 'blocked')).catch(() => undefined);
      // No raw DOM, credential values or provider error text leave this boundary.
      if (error instanceof Error && 'gatewayError' in error) throw error;
      throw failure('IOP_APP_READ_FAILED');
    } finally {
      this.running = false;
      clearTimeout(timeoutHandle);
    }
  }
}
