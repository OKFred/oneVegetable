import { browser } from 'wxt/browser';

import {
  GatewayException,
  NetworkManager,
  ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY,
  createAlibabaCredentialAcquisitionCompletedSummary,
  createAlibabaCredentialAcquisitionFailure,
  createAlibabaCredentialAcquisitionState,
  createAlibabaDeveloperOnboardingSnapshot,
  createAlibabaOpenApiCredentialBundle,
  optionalAlibabaCredentialCallbackUrl,
  parseAlibabaDeveloperOnboardingSnapshot,
  parseAlibabaCredentialCallbackUrl,
  parseAlibabaTokenResponse,
  resolveAlibabaCredentialApplication,
  snapshotToAlibabaCredentialPrerequisiteState,
  transitionAlibabaCredentialAcquisitionState,
  validateAlibabaOAuthCallback,
  type AlibabaCredentialAcquisitionContinueCommand,
  type AlibabaCredentialAcquisitionState,
  type AlibabaCredentialApplicationCandidate,
  type AlibabaOpenApiCredentialBundle
} from '@one-vegetable/core';

import {
  advanceAlibabaOAuthPage,
  ALIBABA_APPLICATION_CENTER_URL,
  closeAlibabaTabs,
  findAlibabaLegacyApplicationTab,
  focusNextAlibabaDeveloperRegistrationField,
  hideAlibabaDeveloperGuide,
  inspectAlibabaApplicationCenter,
  inspectAlibabaApplicationPageState,
  openAlibabaApplicationCenterSection,
  openAlibabaApplicationCenterTab,
  openAlibabaOAuthTab,
  readAlibabaLegacyApplications,
  readTabUrl,
  revealAlibabaLegacyApplicationSecret,
  showAlibabaDeveloperGuide,
  type ExtensionAlibabaApplicationCandidate,
  type ExtensionAlibabaApplicationDetails
} from './alibaba-credential-page-driver';

const ALIBABA_TOKEN_ENDPOINT = 'https://oauth.alibaba.com/token';
const ALIBABA_OAUTH_AUTHORIZE_ENDPOINT = 'https://oauth.alibaba.com/authorize';

type AcquisitionPhase = 'discover' | 'callback-confirmation' | 'secret' | 'oauth' | 'completed';

interface InternalApplicationCandidate extends AlibabaCredentialApplicationCandidate {
  callbackUrl: string | null;
  permissions: ExtensionAlibabaApplicationDetails['permissions'];
}

interface ExtensionAcquisitionTask {
  jobId: string;
  expiresAtUtc: number;
  state: AlibabaCredentialAcquisitionState;
  phase: AcquisitionPhase;
  requestedCallbackUrl: URL | null;
  applicationTabId: number;
  legacyTabId: number | null;
  legacyDiscoveryAttempts: number;
  oauthTabId: number | null;
  oauthCallbackUrl: URL | null;
  oauthState: string | null;
  candidates: InternalApplicationCandidate[];
  selected: InternalApplicationCandidate | null;
  appSecret: string | null;
  bundle: AlibabaOpenApiCredentialBundle | null;
}

export class ExtensionAlibabaCredentialAcquisitionController {
  #task: ExtensionAcquisitionTask | null = null;
  #guideTabId: number | null = null;
  readonly #network = new NetworkManager({
    policies: {
      alibaba: {
        allowedOrigins: ['https://oauth.alibaba.com'],
        timeoutMilliseconds: 30_000,
        maxRequestBytes: 16 * 1024,
        maxResponseBytes: 256 * 1024,
        credentials: 'omit',
        redirect: 'error'
      },
      bff: { allowedOrigins: [] },
      'external-photo': { allowedOrigins: [] }
    }
  });

  constructor() {
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      const task = this.#task;
      if (task?.oauthTabId !== tabId || typeof changeInfo.url !== 'string') return;
      try {
        task.oauthCallbackUrl = new URL(changeInfo.url);
      } catch {
        // 中间导航并不总是绝对 HTTP(S) URL，保持等待即可。
      }
    });
  }

  async start(callbackUrl: string | null): Promise<AlibabaCredentialAcquisitionState> {
    const requestedCallbackUrl = optionalAlibabaCredentialCallbackUrl(callbackUrl);
    const previousTask = this.#task;
    let applicationTabId: number;
    if (previousTask?.state.status === 'prerequisite-required') {
      this.#task = null;
      await closeAlibabaTabs([previousTask.oauthTabId]);
      applicationTabId = await activateAlibabaTab(previousTask.applicationTabId).catch(() =>
        openAlibabaApplicationCenterTab()
      );
    } else {
      await this.#discardTask();
      applicationTabId = await openAlibabaApplicationCenterTab();
    }
    const jobId = crypto.randomUUID();
    const state = createAlibabaCredentialAcquisitionState(jobId);
    if (state.status !== 'running') throw acquisitionError('INTERNAL_ERROR', '凭据获取任务初始化失败');
    this.#task = {
      jobId,
      expiresAtUtc: state.expiresAtUtc,
      state,
      phase: 'discover',
      requestedCallbackUrl,
      applicationTabId,
      legacyTabId: null,
      legacyDiscoveryAttempts: 0,
      oauthTabId: null,
      oauthCallbackUrl: null,
      oauthState: null,
      candidates: [],
      selected: null,
      appSecret: null,
      bundle: null
    };
    return cloneState(state);
  }

  async continue(
    jobId: string,
    command: AlibabaCredentialAcquisitionContinueCommand
  ): Promise<AlibabaCredentialAcquisitionState> {
    const task = await this.#activeTask(jobId);
    if (command.type === 'select-application') {
      if (task.state.status !== 'selection-required') {
        throw acquisitionError('APPLICATION_SELECTION_INVALID', '当前任务不在应用选择阶段');
      }
      const selected = task.candidates.find((candidate) => candidate.applicationId === command.applicationId);
      if (!selected) {
        task.state = failedAcquisitionState('APPLICATION_SELECTION_INVALID');
        return cloneState(task.state);
      }
      task.selected = selected;
      task.state = transitionAlibabaCredentialAcquisitionState(task.state, { type: 'resume' });
      this.#requireCallbackConfirmation(task);
      return cloneState(task.state);
    }

    if (task.state.status !== 'callback-confirmation-required' || !task.selected) {
      throw acquisitionError('CALLBACK_INVALID', '当前任务不在 Callback 确认阶段');
    }
    const current = parseAlibabaCredentialCallbackUrl(task.state.currentUrl);
    const requested = parseAlibabaCredentialCallbackUrl(task.state.requestedUrl);
    const effective = command.confirmed ? requested : current;
    if (command.confirmed && effective.href !== current.href) {
      task.state = failedAcquisitionState('CALLBACK_UPDATE_FAILED');
      return cloneState(task.state);
    }
    task.selected = { ...task.selected, callbackUrl: effective.href };
    task.phase = 'secret';
    task.state = { status: 'running', jobId: task.jobId, expiresAtUtc: task.expiresAtUtc };
    return cloneState(task.state);
  }

  async status(jobId: string): Promise<AlibabaCredentialAcquisitionState> {
    const task = await this.#activeTask(jobId);
    if (isTerminalState(task.state) || task.phase === 'callback-confirmation') {
      return cloneState(task.state);
    }
    try {
      if (task.phase === 'discover') await this.#discoverApplications(task);
      else if (task.phase === 'secret') await this.#revealSecretAndOpenOAuth(task);
      else if (task.phase === 'oauth') await this.#advanceOAuth(task);
    } catch (error: unknown) {
      if (error instanceof GatewayException) throw error;
      task.state = failedAcquisitionState('INTERNAL_ERROR');
    }
    return cloneState(task.state);
  }

  async cancel(jobId: string): Promise<AlibabaCredentialAcquisitionState> {
    const task = await this.#activeTask(jobId);
    const state = isTerminalState(task.state)
      ? task.state
      : transitionAlibabaCredentialAcquisitionState(task.state, { type: 'cancel' });
    await closeAlibabaTabs([task.applicationTabId, task.oauthTabId]);
    await hideAlibabaDeveloperGuide(task.legacyTabId ?? task.applicationTabId);
    this.#task = null;
    return cloneState(state);
  }

  async readPrerequisite(): Promise<Extract<
    AlibabaCredentialAcquisitionState,
    { status: 'prerequisite-required' }
  > | null> {
    const currentTask = this.#task;
    const taskState = currentTask?.state;
    const stored = await browser.storage.local.get(ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY);
    const snapshot = parseAlibabaDeveloperOnboardingSnapshot(
      stored[ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY]
    );
    if (!snapshot && taskState?.status !== 'prerequisite-required') {
      if (Object.prototype.hasOwnProperty.call(stored, ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY)) {
        await browser.storage.local.remove(ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY);
      }
      return null;
    }
    let state =
      taskState?.status === 'prerequisite-required'
        ? structuredClone(taskState)
        : snapshot
          ? snapshotToAlibabaCredentialPrerequisiteState(snapshot)
          : null;
    if (!state) return null;
    const tabId = await this.#resolvePrerequisiteTabId();
    if (tabId !== null) {
      const page = await inspectAlibabaApplicationPageState(tabId).catch(() => null);
      if (page?.kind === 'ready' || page?.kind === 'registration-approved') {
        await this.#clearPrerequisite();
        if (this.#task?.state.status === 'prerequisite-required') this.#task = null;
        await hideAlibabaDeveloperGuide(tabId);
        this.#guideTabId = null;
        return null;
      }
      if (page?.kind === 'prerequisite') {
        state = { status: 'prerequisite-required', reasonCode: page.reasonCode, checkedAtUtc: Date.now() };
        await this.#storePrerequisite(state);
        if (this.#task?.state.status === 'prerequisite-required') this.#task.state = state;
      }
      await this.#showGuide(tabId, state).catch(() => undefined);
    }
    return state;
  }

  isGuideSender(sender: {
    id?: string | undefined;
    url?: string | undefined;
    tab?: { id?: number | undefined } | undefined;
  }): boolean {
    if (sender.id !== browser.runtime.id || this.#guideTabId === null || sender.tab?.id !== this.#guideTabId)
      return false;
    try {
      const url = new URL(sender.url ?? '');
      return (
        (url.origin === 'https://i.alibaba.com' && url.pathname === '/explore/open-api') ||
        (url.origin === 'https://openapi-account.alibaba.com' && url.pathname === '/profile')
      );
    } catch {
      return false;
    }
  }

  async #showGuide(
    tabId: number,
    state: Extract<AlibabaCredentialAcquisitionState, { status: 'prerequisite-required' | 'failed' }>
  ): Promise<void> {
    await showAlibabaDeveloperGuide(tabId, state);
    this.#guideTabId = tabId;
  }

  async locatePrerequisiteField(): Promise<string | null> {
    const tabId = await this.#resolvePrerequisiteTabId();
    if (tabId === null) return null;
    await activateAlibabaTab(tabId);
    return focusNextAlibabaDeveloperRegistrationField(tabId);
  }

  async focusPrerequisitePage(): Promise<void> {
    const tabId = await this.#resolvePrerequisiteTabId();
    if (tabId === null) {
      await openAlibabaApplicationCenterTab();
      return;
    }
    await activateAlibabaTab(tabId);
    const prerequisite = await this.readPrerequisite();
    if (prerequisite) await this.#showGuide(tabId, prerequisite).catch(() => undefined);
  }

  async exportBundle(): Promise<AlibabaOpenApiCredentialBundle> {
    const task = await this.#completedTask();
    return structuredClone(task.bundle);
  }

  async completedBundle(): Promise<AlibabaOpenApiCredentialBundle> {
    return this.exportBundle();
  }

  async #discoverApplications(task: ExtensionAcquisitionTask): Promise<void> {
    const snapshot = await inspectAlibabaApplicationCenter(task.applicationTabId);
    if (!snapshot.application) {
      const pageState = await inspectAlibabaApplicationPageState(task.applicationTabId);
      if (pageState.kind === 'prerequisite') {
        const prerequisite = transitionAlibabaCredentialAcquisitionState(task.state, {
          type: 'require-prerequisite',
          reasonCode: pageState.reasonCode
        });
        if (prerequisite.status !== 'prerequisite-required') {
          throw acquisitionError('INTERNAL_ERROR', 'Alibaba 开发者前置状态转换失败');
        }
        task.state = prerequisite;
        await this.#storePrerequisite(prerequisite);
        await this.#showGuide(task.applicationTabId, prerequisite).catch(() => undefined);
      } else if (
        pageState.kind === 'ready' ||
        pageState.kind === 'navigation-ready' ||
        pageState.kind === 'registration-approved'
      ) {
        await openAlibabaApplicationCenterSection(task.applicationTabId);
      }
      return;
    }

    await this.#clearPrerequisite();

    if (task.legacyTabId === null) {
      task.legacyTabId = await findAlibabaLegacyApplicationTab();
      if (task.legacyTabId === null) {
        await this.#requireTopApplication(task);
        return;
      }
    }
    const legacyCandidates = await readAlibabaLegacyApplications(task.legacyTabId).catch(() => []);
    task.legacyDiscoveryAttempts += 1;
    if (legacyCandidates.length === 0) {
      if (task.legacyDiscoveryAttempts >= 10) await this.#requireTopApplication(task);
      return;
    }
    // This controller exchanges TOP tokens only. The new application center is
    // not a source of TOP credentials, regardless of AppKey length or app name.
    task.candidates = legacyCandidates.map((candidate, index) => toInternalCandidate(candidate, index + 1));
    const selection = resolveAlibabaCredentialApplication(task.candidates);
    if (selection.kind === 'failed') {
      task.state = failedAcquisitionState(selection.code);
      return;
    }
    if (selection.kind === 'selection-required') {
      task.state = transitionAlibabaCredentialAcquisitionState(task.state, {
        type: 'require-application-selection',
        applications: selection.applications
      });
      return;
    }
    task.selected =
      task.candidates.find((candidate) => candidate.applicationId === selection.application.applicationId) ??
      null;
    if (!task.selected) {
      task.state = failedAcquisitionState('APPLICATION_NOT_FOUND');
      return;
    }
    this.#requireCallbackConfirmation(task);
  }

  async #requireTopApplication(task: ExtensionAcquisitionTask): Promise<void> {
    const state = {
      status: 'failed',
      error: {
        code: 'TOP_APPLICATION_REQUIRED',
        message:
          'No usable legacy TOP application was found. Use the IOP tool or import existing TOP credentials.',
        retryable: false
      }
    } as const;
    task.state = state;
    await this.#showGuide(task.applicationTabId, state).catch(() => undefined);
  }

  #requireCallbackConfirmation(task: ExtensionAcquisitionTask): void {
    const selected = task.selected;
    if (!selected?.callbackUrl) {
      task.state = failedAcquisitionState('CALLBACK_INVALID');
      return;
    }
    const current = parseAlibabaCredentialCallbackUrl(selected.callbackUrl);
    const requested = task.requestedCallbackUrl ?? current;
    task.phase = 'callback-confirmation';
    task.state = {
      status: 'callback-confirmation-required',
      jobId: task.jobId,
      expiresAtUtc: task.expiresAtUtc,
      currentUrl: current.href,
      requestedUrl: requested.href
    };
  }

  async #revealSecretAndOpenOAuth(task: ExtensionAcquisitionTask): Promise<void> {
    const selected = task.selected;
    if (!selected?.callbackUrl) throw acquisitionError('CALLBACK_INVALID', 'Alibaba Callback 缺失');
    if (task.legacyTabId === null || selected.source !== 'legacy-crosstrade') {
      await this.#requireTopApplication(task);
      return;
    }
    const secret = await revealAlibabaLegacyApplicationSecret(task.legacyTabId, selected.appKey);
    if (secret.status !== 'available') return;
    task.appSecret = secret.appSecret;
    task.oauthState = crypto.randomUUID();
    const authorizationUrl = new URL(ALIBABA_OAUTH_AUTHORIZE_ENDPOINT);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('view', 'web');
    authorizationUrl.searchParams.set('sp', 'ICBU');
    authorizationUrl.searchParams.set('client_id', selected.appKey);
    authorizationUrl.searchParams.set('redirect_uri', selected.callbackUrl);
    authorizationUrl.searchParams.set('state', task.oauthState);
    task.oauthTabId = await openAlibabaOAuthTab(authorizationUrl);
    task.phase = 'oauth';
  }

  async #advanceOAuth(task: ExtensionAcquisitionTask): Promise<void> {
    const selected = task.selected;
    const appSecret = task.appSecret;
    const oauthState = task.oauthState;
    const oauthTabId = task.oauthTabId;
    if (!selected?.callbackUrl || !appSecret || !oauthState || oauthTabId === null) {
      task.state = failedAcquisitionState('OAUTH_FAILED');
      return;
    }
    const callback = task.oauthCallbackUrl ?? (await readTabUrl(oauthTabId));
    if (callback && isOAuthCallback(callback, new URL(selected.callbackUrl))) {
      const code = validateAlibabaOAuthCallback(callback, new URL(selected.callbackUrl), oauthState);
      const token = await this.#exchangeAuthorizationCode({
        appKey: selected.appKey,
        appSecret,
        code,
        redirectUri: selected.callbackUrl
      });
      const bundle = createAlibabaOpenApiCredentialBundle({
        capturedAtTimeUtc: Date.now(),
        application: {
          appName: selected.appName,
          appKey: selected.appKey,
          appSecret,
          callbackUrl: selected.callbackUrl,
          status: selected.status,
          permissions: selected.permissions
        },
        token,
        receivedCallbackUrl: callback.href
      });
      task.bundle = bundle;
      task.appSecret = null;
      task.oauthState = null;
      task.oauthCallbackUrl = null;
      task.phase = 'completed';
      task.state = {
        status: 'completed',
        credential: createAlibabaCredentialAcquisitionCompletedSummary(bundle)
      };
      await this.#clearPrerequisite();
      await closeAlibabaTabs([task.applicationTabId, task.legacyTabId, task.oauthTabId]);
      task.applicationTabId = -1;
      task.legacyTabId = null;
      task.oauthTabId = null;
      return;
    }

    const page = await advanceAlibabaOAuthPage(oauthTabId).catch(() => ({ status: 'waiting' as const }));
    if (page.status === 'failed') task.state = failedAcquisitionState('OAUTH_FAILED');
    // 插件模式下由用户直接在标签页处理 CAPTCHA、滑块、MFA 或授权确认，状态保持 running。
  }

  async #exchangeAuthorizationCode(input: {
    appKey: string;
    appSecret: string;
    code: string;
    redirectUri: string;
  }) {
    const body = new URLSearchParams({
      code: input.code,
      grant_type: 'authorization_code',
      client_id: input.appKey,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
      sp: 'icbu'
    });
    const response = await this.#network.request({
      service: 'alibaba',
      url: ALIBABA_TOKEN_ENDPOINT,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      responseType: 'json',
      maxAttempts: 1
    });
    if (!response.ok) {
      throw acquisitionError('TOKEN_EXCHANGE_FAILED', `Alibaba Token 端点返回 HTTP ${response.status}`);
    }
    return parseAlibabaTokenResponse(response.data);
  }

  async #activeTask(jobId: string): Promise<ExtensionAcquisitionTask> {
    const task = this.#task;
    if (task?.jobId !== jobId) {
      throw new GatewayException({
        code: 'ACQUISITION_SESSION_EXPIRED',
        message: 'Alibaba 凭据获取会话不存在或扩展后台已重新启动，请重新开始',
        retryable: false
      });
    }
    if (Date.now() >= task.expiresAtUtc) {
      await this.#discardTask();
      throw new GatewayException({
        code: 'ACQUISITION_EXPIRED',
        message: 'Alibaba 凭据获取任务已超过 10 分钟，请重新开始',
        retryable: false
      });
    }
    return task;
  }

  async #completedTask(): Promise<ExtensionAcquisitionTask & { bundle: AlibabaOpenApiCredentialBundle }> {
    const task = this.#task;
    if (task?.state.status !== 'completed' || !task.bundle) {
      throw new GatewayException({
        code: 'ACQUISITION_NOT_COMPLETED',
        message: 'Alibaba 凭据尚未获取完成',
        retryable: false
      });
    }
    if (Date.now() >= task.expiresAtUtc) {
      await this.#discardTask();
      throw new GatewayException({
        code: 'ACQUISITION_EXPIRED',
        message: 'Alibaba 明文授权包已从内存清除，请重新开始',
        retryable: false
      });
    }
    return task as ExtensionAcquisitionTask & { bundle: AlibabaOpenApiCredentialBundle };
  }

  async #resolvePrerequisiteTabId(): Promise<number | null> {
    if (this.#task?.state.status === 'prerequisite-required') {
      const tab = await browser.tabs.get(this.#task.applicationTabId).catch(() => null);
      if (tab?.id !== undefined) return tab.id;
    }
    const tabs = await browser.tabs
      .query({ url: ['https://i.alibaba.com/*', 'https://openapi-account.alibaba.com/*'] })
      .catch(() => []);
    return tabs.find((tab) => tab.id !== undefined)?.id ?? null;
  }

  async #storePrerequisite(
    state: Extract<AlibabaCredentialAcquisitionState, { status: 'prerequisite-required' }>
  ): Promise<void> {
    await browser.storage.local.set({
      [ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY]: createAlibabaDeveloperOnboardingSnapshot(state)
    });
  }

  async #clearPrerequisite(): Promise<void> {
    await browser.storage.local.remove(ALIBABA_DEVELOPER_ONBOARDING_STORAGE_KEY);
    const tabId = this.#task?.applicationTabId;
    if (tabId !== undefined) await hideAlibabaDeveloperGuide(tabId);
  }

  async #discardTask(): Promise<void> {
    const task = this.#task;
    this.#task = null;
    if (!task) return;
    task.appSecret = null;
    task.oauthState = null;
    task.oauthCallbackUrl = null;
    task.bundle = null;
    await closeAlibabaTabs([task.applicationTabId, task.oauthTabId]);
  }
}

async function activateAlibabaTab(tabId: number): Promise<number> {
  const tab = await browser.tabs.update(tabId, { active: true });
  if (tab?.id === undefined) throw new Error(`无法打开 ${ALIBABA_APPLICATION_CENTER_URL}`);
  await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return tab.id;
}

function toInternalCandidate(
  candidate: ExtensionAlibabaApplicationCandidate,
  index: number,
  permissions: ExtensionAlibabaApplicationDetails['permissions'] = []
): InternalApplicationCandidate {
  return {
    applicationId: `application-${index}`,
    appName: candidate.appName,
    appKey: candidate.appKey,
    status: candidate.status,
    source: candidate.source,
    callbackUrl: candidate.callbackUrl,
    permissions
  };
}

function failedAcquisitionState(
  code:
    | 'APPLICATION_NOT_FOUND'
    | 'APPLICATION_SELECTION_INVALID'
    | 'CALLBACK_INVALID'
    | 'CALLBACK_UPDATE_FAILED'
    | 'INTERNAL_ERROR'
    | 'NO_APPLICATION'
    | 'OAUTH_FAILED'
): AlibabaCredentialAcquisitionState {
  return { status: 'failed', error: createAlibabaCredentialAcquisitionFailure(code) };
}

function acquisitionError(code: string, message: string): GatewayException {
  return new GatewayException({ code, message, retryable: false });
}

function isTerminalState(state: AlibabaCredentialAcquisitionState): boolean {
  return (
    state.status === 'completed' ||
    state.status === 'failed' ||
    state.status === 'extension-required' ||
    state.status === 'prerequisite-required'
  );
}

function isOAuthCallback(candidate: URL, registered: URL): boolean {
  return (
    candidate.origin === registered.origin &&
    normalizePath(candidate.pathname) === normalizePath(registered.pathname) &&
    (candidate.searchParams.has('code') || candidate.searchParams.has('error'))
  );
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
}

function cloneState(state: AlibabaCredentialAcquisitionState): AlibabaCredentialAcquisitionState {
  return structuredClone(state);
}
