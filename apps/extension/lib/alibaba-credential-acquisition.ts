import { browser } from 'wxt/browser';

import {
  GatewayException,
  NetworkManager,
  createAlibabaCredentialAcquisitionCompletedSummary,
  createAlibabaCredentialAcquisitionFailure,
  createAlibabaCredentialAcquisitionState,
  createAlibabaOpenApiCredentialBundle,
  optionalAlibabaCredentialCallbackUrl,
  parseAlibabaCredentialCallbackUrl,
  parseAlibabaTokenResponse,
  resolveAlibabaCredentialApplication,
  transitionAlibabaCredentialAcquisitionState,
  validateAlibabaOAuthCallback,
  type AlibabaCredentialAcquisitionContinueCommand,
  type AlibabaCredentialAcquisitionState,
  type AlibabaCredentialApplicationCandidate,
  type AlibabaOpenApiCredentialBundle
} from '@one-vegetable/core';

import {
  advanceAlibabaOAuthPage,
  closeAlibabaTabs,
  inspectAlibabaApplicationCenter,
  inspectAlibabaApplicationPageState,
  openAlibabaApplicationCenterSection,
  openAlibabaApplicationCenterTab,
  openAlibabaLegacyApplicationTab,
  openAlibabaOAuthTab,
  readAlibabaLegacyApplications,
  readTabUrl,
  revealAlibabaApplicationSecret,
  revealAlibabaLegacyApplicationSecret,
  selectAlibabaApplicationInPage,
  updateAlibabaCallbackInPage,
  type ExtensionAlibabaApplicationCandidate,
  type ExtensionAlibabaApplicationDetails
} from './alibaba-credential-page-driver';

const ALIBABA_TOKEN_ENDPOINT = 'https://oauth.alibaba.com/token';
const ALIBABA_OAUTH_AUTHORIZE_ENDPOINT = 'https://oauth.alibaba.com/authorize';

type AcquisitionPhase = 'discover' | 'selecting' | 'callback-confirmation' | 'secret' | 'oauth' | 'completed';

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
    await this.#discardTask();
    const requestedCallbackUrl = optionalAlibabaCredentialCallbackUrl(callbackUrl);
    const jobId = crypto.randomUUID();
    const state = createAlibabaCredentialAcquisitionState(jobId);
    if (state.status !== 'running') throw acquisitionError('INTERNAL_ERROR', '凭据获取任务初始化失败');
    const applicationTabId = await openAlibabaApplicationCenterTab();
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
      await this.#prepareSelectedApplication(task);
      return cloneState(task.state);
    }

    if (task.state.status !== 'callback-confirmation-required' || !task.selected) {
      throw acquisitionError('CALLBACK_INVALID', '当前任务不在 Callback 确认阶段');
    }
    const current = parseAlibabaCredentialCallbackUrl(task.state.currentUrl);
    const requested = parseAlibabaCredentialCallbackUrl(task.state.requestedUrl);
    const effective = command.confirmed ? requested : current;
    if (command.confirmed && effective.href !== current.href) {
      if (task.selected.source === 'legacy-crosstrade') {
        task.state = failedAcquisitionState('CALLBACK_UPDATE_FAILED');
        return cloneState(task.state);
      }
      const updated = await updateAlibabaCallbackInPage(task.applicationTabId, effective);
      if (!updated) {
        task.state = failedAcquisitionState('CALLBACK_UPDATE_FAILED');
        return cloneState(task.state);
      }
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
      else if (task.phase === 'selecting') await this.#finishApplicationSelection(task);
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
    await closeAlibabaTabs([task.applicationTabId, task.legacyTabId, task.oauthTabId]);
    this.#task = null;
    return cloneState(state);
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
      if (pageState === 'no-application') task.state = failedAcquisitionState('NO_APPLICATION');
      else if (pageState === 'ready') await openAlibabaApplicationCenterSection(task.applicationTabId);
      return;
    }

    if (task.legacyTabId === null) {
      task.legacyTabId = await openAlibabaLegacyApplicationTab();
      return;
    }
    const legacyCandidates = await readAlibabaLegacyApplications(task.legacyTabId).catch(() => []);
    task.legacyDiscoveryAttempts += 1;
    if (
      snapshot.application.appKey.length < 8 &&
      legacyCandidates.length === 0 &&
      task.legacyDiscoveryAttempts < 10
    ) {
      return;
    }
    task.candidates = buildApplicationCandidates(snapshot.application, snapshot.candidates, legacyCandidates);
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
    await this.#prepareSelectedApplication(task);
  }

  async #prepareSelectedApplication(task: ExtensionAcquisitionTask): Promise<void> {
    const selected = task.selected;
    if (!selected) throw acquisitionError('APPLICATION_NOT_FOUND', '没有已选择的 Alibaba 应用');
    if (selected.source === 'application-center' && selected.callbackUrl === null) {
      const clicked = await selectAlibabaApplicationInPage(task.applicationTabId, selected);
      if (!clicked) {
        task.state = failedAcquisitionState('APPLICATION_NOT_FOUND');
        return;
      }
      task.phase = 'selecting';
      return;
    }
    this.#requireCallbackConfirmation(task);
  }

  async #finishApplicationSelection(task: ExtensionAcquisitionTask): Promise<void> {
    const selected = task.selected;
    if (!selected) throw acquisitionError('APPLICATION_NOT_FOUND', '没有已选择的 Alibaba 应用');
    const snapshot = await inspectAlibabaApplicationCenter(task.applicationTabId);
    const current = snapshot.application;
    if (current?.appName !== selected.appName) return;
    task.selected = {
      ...selected,
      appKey: selected.appKey.length >= current.appKey.length ? selected.appKey : current.appKey,
      callbackUrl: current.callbackUrl,
      status: current.status,
      permissions: current.permissions
    };
    this.#requireCallbackConfirmation(task);
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
    const secret =
      selected.source === 'legacy-crosstrade'
        ? task.legacyTabId === null
          ? { status: 'waiting' as const, reason: 'layout' as const }
          : await revealAlibabaLegacyApplicationSecret(task.legacyTabId, selected.appKey)
        : await revealAlibabaApplicationSecret(task.applicationTabId);
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

  async #discardTask(): Promise<void> {
    const task = this.#task;
    this.#task = null;
    if (!task) return;
    task.appSecret = null;
    task.oauthState = null;
    task.oauthCallbackUrl = null;
    task.bundle = null;
    await closeAlibabaTabs([task.applicationTabId, task.legacyTabId, task.oauthTabId]);
  }
}

function buildApplicationCandidates(
  current: ExtensionAlibabaApplicationDetails,
  applicationCenterCandidates: readonly ExtensionAlibabaApplicationCandidate[],
  legacyCandidates: readonly ExtensionAlibabaApplicationCandidate[]
): InternalApplicationCandidate[] {
  if (current.appKey.length < 8 && legacyCandidates.length === 1) {
    const legacy = legacyCandidates[0];
    if (legacy) return [toInternalCandidate(legacy, 1)];
  }
  const fullCurrent = applicationCenterCandidates.find(
    (candidate) =>
      candidate.appName === current.appName &&
      (candidate.appKey.includes(current.appKey) || current.appKey.includes(candidate.appKey))
  );
  const currentCandidate: ExtensionAlibabaApplicationCandidate = {
    appName: current.appName,
    appKey: fullCurrent?.appKey ?? current.appKey,
    callbackUrl: current.callbackUrl,
    status: current.status,
    source: 'application-center'
  };
  const combined = [
    currentCandidate,
    ...applicationCenterCandidates.map((candidate) => ({
      ...candidate,
      callbackUrl:
        candidate.appName === current.appName || candidate.appKey === currentCandidate.appKey
          ? current.callbackUrl
          : candidate.callbackUrl,
      status: candidate.status || current.status
    })),
    ...legacyCandidates
  ];
  const unique = [
    ...new Map(combined.map((candidate) => [`${candidate.source}:${candidate.appKey}`, candidate])).values()
  ];
  return unique.map((candidate, index) =>
    toInternalCandidate(
      candidate,
      index + 1,
      candidate.source === 'application-center' ? current.permissions : []
    )
  );
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
  return state.status === 'completed' || state.status === 'failed' || state.status === 'extension-required';
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
