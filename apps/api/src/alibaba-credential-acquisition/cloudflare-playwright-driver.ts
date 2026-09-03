import { acquire, connect, limits } from '@cloudflare/playwright';

import {
  createAlibabaOpenApiCredentialBundle,
  inspectAlibabaDeveloperPrerequisiteDocument,
  NetworkManager,
  parseAlibabaTokenResponse,
  resolveAlibabaCredentialApplication,
  selectAlibabaDeveloperPrerequisite,
  toAlibabaCredentialApplicationSummary,
  validateAlibabaOAuthCallback
} from '@one-vegetable/core';

import type {
  AlibabaCredentialAcquisitionContinueCommand,
  AlibabaCredentialAcquisitionExtensionFallbackReason,
  AlibabaCredentialAcquisitionPrerequisiteReason,
  AlibabaCredentialApplicationCandidate,
  AlibabaOpenApiPermission
} from '@one-vegetable/core';
import type {
  Browser,
  BrowserContext,
  BrowserWorker,
  Frame,
  Locator,
  Page,
  Request
} from '@cloudflare/playwright';
import type { AlibabaCredentialAcquisitionDriver, AlibabaCredentialAcquisitionDriverResult } from './service';
import type { AlibabaCredentialAcquisitionJob } from './repository';
import {
  classifyAlibabaChallenge,
  findApplicationRecords,
  findLegacyApplicationRecords
} from './browser-page-model';

const TARGET_URL = 'https://i.alibaba.com/explore/open-api';
const LEGACY_APP_LIST_URL = 'https://crosstrade.alibaba.com/ecology/ajax/listApp.json';
const LEGACY_APP_SECRET_URL = 'https://crosstrade.alibaba.com/ecology/ajax/getAppSecret.json';
const TOKEN_ENDPOINT = 'https://oauth.alibaba.com/token';
const AUTHORIZE_ENDPOINT = 'https://oauth.alibaba.com/authorize';
const BROWSER_KEEP_ALIVE_MILLISECONDS = 10 * 60 * 1_000;
const STEP_TIMEOUT_MILLISECONDS = 30_000;
const SHORT_WAIT_MILLISECONDS = 5_000;

interface CloudApplication extends AlibabaCredentialApplicationCandidate {
  callbackUrl: string | null;
  permissions: AlibabaOpenApiPermission[];
}

interface ConnectedBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

class DriverFallbackError extends Error {
  constructor(public readonly reasonCode: AlibabaCredentialAcquisitionExtensionFallbackReason) {
    super(reasonCode);
    this.name = 'DriverFallbackError';
  }
}

class DriverPrerequisiteError extends Error {
  constructor(public readonly reasonCode: AlibabaCredentialAcquisitionPrerequisiteReason) {
    super(reasonCode);
    this.name = 'DriverPrerequisiteError';
  }
}

export class CloudflareAlibabaCredentialAcquisitionDriver implements AlibabaCredentialAcquisitionDriver {
  readonly #network: NetworkManager;

  constructor(private readonly binding: BrowserWorker) {
    this.#network = new NetworkManager({
      policies: {
        alibaba: {
          allowedOrigins: [new URL(TOKEN_ENDPOINT).origin],
          timeoutMilliseconds: STEP_TIMEOUT_MILLISECONDS,
          maxRequestBytes: 16 * 1024,
          maxResponseBytes: 64 * 1024,
          redirect: 'error'
        },
        bff: { allowedOrigins: [] },
        'external-photo': { allowedOrigins: [] }
      }
    });
  }

  async start(input: {
    requestId: string;
    jobId: string;
    account: string;
    password: string;
    requestedCallbackUrl: string | null;
    onSessionAcquired: (sessionId: string) => Promise<void>;
  }): Promise<AlibabaCredentialAcquisitionDriverResult> {
    let sessionId: string | null = null;
    let connected: ConnectedBrowser | null = null;
    try {
      const quota = await limits(this.binding);
      if (quota.allowedBrowserAcquisitions < 1) {
        return { kind: 'extension-required', reasonCode: 'browser-quota-exhausted' };
      }
      const acquired = await acquire(this.binding, {
        keep_alive: BROWSER_KEEP_ALIVE_MILLISECONDS,
        recording: false,
        guardrails: {
          allowedDomains: [
            'alibaba.com',
            '*.alibaba.com',
            'alicdn.com',
            '*.alicdn.com',
            'taobao.com',
            '*.taobao.com',
            'tbcdn.cn',
            '*.tbcdn.cn'
          ],
          allowedDomainSets: ['common-cdns']
        }
      });
      sessionId = acquired.sessionId;
      await input.onSessionAcquired(sessionId);
      connected = await this.#connect(sessionId);
      await this.#login(connected.page, input.account, input.password);
      return await this.#advance(connected, input.requestId, input.requestedCallbackUrl, null, null);
    } catch (error: unknown) {
      await this.#clearSensitivePageFields(connected?.page ?? null);
      const result = mapDriverError(error);
      if (sessionId) await this.cancel(sessionId);
      return result;
    } finally {
      await connected?.browser.close().catch(() => undefined);
    }
  }

  async continue(input: {
    requestId: string;
    job: AlibabaCredentialAcquisitionJob;
    command: AlibabaCredentialAcquisitionContinueCommand;
  }): Promise<AlibabaCredentialAcquisitionDriverResult> {
    const sessionId = input.job.browserSessionId;
    if (!sessionId) return { kind: 'extension-required', reasonCode: 'session-expired' };
    let connected: ConnectedBrowser | null = null;
    try {
      connected = await this.#connect(sessionId);
      return await this.#advance(
        connected,
        input.requestId,
        input.job.requestedCallbackUrl,
        input.command.type === 'select-application'
          ? input.command.applicationId
          : input.job.selectedApplicationId,
        input.command.type === 'confirm-callback-change' ? input.command.confirmed : null
      );
    } catch (error: unknown) {
      const result = mapDriverError(error);
      if (result.kind === 'extension-required') await this.cancel(sessionId);
      return result;
    } finally {
      await connected?.browser.close().catch(() => undefined);
    }
  }

  async cancel(browserSessionId: string): Promise<void> {
    const connected = await this.#connect(browserSessionId).catch(() => null);
    if (!connected) return;
    try {
      await this.#clearSensitivePageFields(connected.page);
      await connected.context.clearCookies().catch(() => undefined);
      await connected.context.close().catch(() => undefined);
    } finally {
      await connected.browser.close().catch(() => undefined);
    }
  }

  async #connect(sessionId: string): Promise<ConnectedBrowser> {
    let browser: Browser;
    try {
      browser = await connect(this.binding, sessionId);
    } catch {
      throw new DriverFallbackError('session-expired');
    }
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return { browser, context, page };
  }

  async #login(page: Page, account: string, password: string): Promise<void> {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MILLISECONDS });
    if (await hasApplicationCenter(page)) return;
    const challenge = await detectChallenge(page);
    if (challenge) throw new DriverFallbackError(challenge);
    const prerequisite = await detectDeveloperPrerequisite(page);
    if (prerequisite) throw new DriverPrerequisiteError(prerequisite);
    const form = await findLoginForm(page);
    if (!form) throw new DriverFallbackError('automation-layout-unsupported');
    await form.account.fill(account);
    await form.password.fill(password);
    await form.submit.click();
    const deadline = Date.now() + STEP_TIMEOUT_MILLISECONDS;
    while (Date.now() < deadline) {
      const detected = await detectChallenge(page);
      if (detected) throw new DriverFallbackError(detected);
      const currentPrerequisite = await detectDeveloperPrerequisite(page);
      if (currentPrerequisite) throw new DriverPrerequisiteError(currentPrerequisite);
      if (await hasApplicationCenter(page)) return;
      await page.waitForTimeout(250);
    }
    throw new DriverFallbackError('bot-rejected');
  }

  async #advance(
    connected: ConnectedBrowser,
    requestId: string,
    requestedCallbackUrl: string | null,
    selectedApplicationId: string | null,
    callbackConfirmed: boolean | null
  ): Promise<AlibabaCredentialAcquisitionDriverResult> {
    const challenge = await detectChallenge(connected.page);
    if (challenge) throw new DriverFallbackError(challenge);
    const prerequisite = await detectDeveloperPrerequisite(connected.page);
    if (prerequisite) throw new DriverPrerequisiteError(prerequisite);
    const frame = await openApplicationCenter(connected.page);
    const applications = await readApplications(frame, connected.context);
    if (applications.length === 0) {
      return { kind: 'prerequisite-required', reasonCode: 'application-required' };
    }

    let selected: CloudApplication;
    if (selectedApplicationId) {
      const candidate = applications.find(
        (application) => application.applicationId === selectedApplicationId
      );
      if (!candidate) return { kind: 'failed', code: 'APPLICATION_SELECTION_INVALID' };
      selected = await selectApplication(frame, candidate);
    } else {
      const selection = resolveAlibabaCredentialApplication(applications);
      if (selection.kind === 'selection-required') {
        return { kind: 'selection-required', applications: selection.applications };
      }
      if (selection.kind === 'failed') return { kind: 'failed', code: selection.code };
      const candidate = applications.find(
        (application) => application.applicationId === selection.application.applicationId
      );
      if (!candidate) return { kind: 'failed', code: 'APPLICATION_NOT_FOUND' };
      selected = await selectApplication(frame, candidate);
    }

    if (isApplicationNotReady(selected.status)) {
      return { kind: 'prerequisite-required', reasonCode: 'application-not-ready' };
    }

    if (!selected.callbackUrl) return { kind: 'failed', code: 'CALLBACK_INVALID' };
    if (requestedCallbackUrl && requestedCallbackUrl !== selected.callbackUrl && callbackConfirmed === null) {
      return {
        kind: 'callback-confirmation-required',
        selectedApplicationId: selected.applicationId,
        currentUrl: selected.callbackUrl,
        requestedUrl: requestedCallbackUrl
      };
    }
    if (requestedCallbackUrl && requestedCallbackUrl !== selected.callbackUrl && callbackConfirmed === true) {
      if (selected.source === 'legacy-crosstrade') {
        return { kind: 'failed', code: 'CALLBACK_UPDATE_FAILED' };
      }
      const updated = await updateCallback(frame, requestedCallbackUrl);
      if (!updated) return { kind: 'failed', code: 'CALLBACK_UPDATE_FAILED' };
      selected = { ...selected, callbackUrl: requestedCallbackUrl };
    }

    const appSecret =
      selected.source === 'legacy-crosstrade'
        ? await readLegacySecret(connected.context, selected.appKey)
        : await revealSecret(frame);
    if (!appSecret) throw new DriverFallbackError('secret-verification');
    const effectiveCallbackUrl = selected.callbackUrl;
    if (!effectiveCallbackUrl) return { kind: 'failed', code: 'CALLBACK_INVALID' };
    const callbackUrl = new URL(effectiveCallbackUrl);
    const state = crypto.randomUUID();
    const callback = await authorize(connected.page, selected.appKey, callbackUrl, state);
    const code = validateAlibabaOAuthCallback(callback, callbackUrl, state);
    const token = await this.#exchangeToken({
      requestId,
      appKey: selected.appKey,
      appSecret,
      code,
      redirectUri: callbackUrl.href
    });
    const bundle = createAlibabaOpenApiCredentialBundle({
      capturedAtTimeUtc: Date.now(),
      application: {
        appName: selected.appName,
        appKey: selected.appKey,
        appSecret,
        callbackUrl: callbackUrl.href,
        status: selected.status,
        permissions: selected.permissions
      },
      token,
      receivedCallbackUrl: callback.href
    });
    await this.#clearSensitivePageFields(connected.page);
    await connected.context.clearCookies().catch(() => undefined);
    return { kind: 'completed', bundle };
  }

  async #exchangeToken(input: {
    requestId: string;
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
      url: TOKEN_ENDPOINT,
      requestId: input.requestId,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      responseType: 'json',
      maxAttempts: 1
    });
    if (!response.ok) throw new Error('TOKEN_EXCHANGE_FAILED');
    return parseAlibabaTokenResponse(response.data);
  }

  async #clearSensitivePageFields(page: Page | null): Promise<void> {
    if (!page) return;
    for (const frame of page.frames()) {
      await frame
        .locator(
          'input[type="password"], input[name*="account" i], input[name*="login" i], input[name*="secret" i], input[name*="token" i], input[autocomplete="username"]'
        )
        .fill('')
        .catch(() => undefined);
    }
  }
}

async function hasApplicationCenter(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (
      await frame
        .getByText('Application center', { exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      return true;
    }
  }
  return false;
}

async function findLoginForm(page: Page): Promise<{
  account: Locator;
  password: Locator;
  submit: Locator;
} | null> {
  for (const frame of page.frames()) {
    const account = await firstExisting(frame, [
      'input[name="account"]',
      'input[name="loginId"]',
      'input[autocomplete="username"]',
      'input[type="email"]'
    ]);
    const password = await firstExisting(frame, [
      'input[name="password"]',
      'input[autocomplete="current-password"]',
      'input[type="password"]'
    ]);
    if (!account || !password) continue;
    const submit = frame.getByRole('button', { name: /sign in|login|log in|登录/iu });
    if ((await submit.count()) > 0) return { account, password, submit: submit.first() };
  }
  return null;
}

async function firstExisting(frame: Frame, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = frame.locator(selector);
    if ((await locator.count()) > 0) return locator.first();
  }
  return null;
}

async function detectChallenge(
  page: Page
): Promise<AlibabaCredentialAcquisitionExtensionFallbackReason | null> {
  const text = (
    await Promise.all(
      page.frames().map((frame) =>
        frame
          .locator('body')
          .innerText({ timeout: 1_000 })
          .catch(() => '')
      )
    )
  ).join('\n');
  return classifyAlibabaChallenge(text);
}

async function openApplicationCenter(page: Page): Promise<Frame> {
  const button = page.getByText('Application center', { exact: true });
  if ((await button.count()) > 0) await button.first().click();
  const deadline = Date.now() + STEP_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (
        frame.url().includes('openapi.alibaba.com/app/index.htm') ||
        (await frame.locator('.cloud-form .form-label').count()) > 0
      ) {
        return frame;
      }
    }
    const challenge = await detectChallenge(page);
    if (challenge) throw new DriverFallbackError(challenge);
    const prerequisite = await detectDeveloperPrerequisite(page);
    if (prerequisite) throw new DriverPrerequisiteError(prerequisite);
    await page.waitForTimeout(250);
  }
  throw new DriverFallbackError('automation-layout-unsupported');
}

async function detectDeveloperPrerequisite(
  page: Page
): Promise<AlibabaCredentialAcquisitionPrerequisiteReason | null> {
  return selectAlibabaDeveloperPrerequisite(
    await Promise.all(
      page.frames().map((frame) =>
        frame
          .locator('body')
          .evaluate(inspectAlibabaDeveloperPrerequisiteDocument)
          .catch(() => null)
      )
    )
  );
}

function isApplicationNotReady(status: string): boolean {
  return /under review|pending|offline|disabled|rejected|审核|待处理|未上线|已停用|已驳回/iu.test(status);
}

async function readApplications(frame: Frame, context: BrowserContext): Promise<CloudApplication[]> {
  const current = await readCurrentApplication(frame).catch(() => null);
  const fromCenter = await readApplicationCenterCandidates(frame);
  const legacy = await readLegacyApplications(context);
  const combined: Omit<CloudApplication, 'applicationId'>[] = [];
  if (current) combined.push(current);
  combined.push(...fromCenter, ...legacy);
  const unique = [...new Map(combined.map((item) => [`${item.source}:${item.appKey}`, item])).values()];
  return unique.map((application, index) => ({
    ...application,
    applicationId: `${application.source}:${index + 1}`
  }));
}

async function readCurrentApplication(frame: Frame): Promise<Omit<CloudApplication, 'applicationId'>> {
  const fields = await frame.locator('.cloud-form').evaluateAll((elements) =>
    elements.map((element) => ({
      label: element.querySelector('.form-label')?.textContent.trim() ?? '',
      value: element.querySelector('.form-item')?.textContent.trim() ?? ''
    }))
  );
  const field = (label: string): string => fields.find((item) => item.label === label)?.value ?? '';
  const appName = field('App Name');
  const appKey = field('AppKey');
  const callbackUrl = field('Callback URL');
  if (!appName || !appKey || !callbackUrl) throw new Error('APPLICATION_DETAILS_INCOMPLETE');
  const rows = await frame
    .locator('table tbody tr')
    .evaluateAll((elements) =>
      elements.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()))
    );
  return {
    appName,
    appKey,
    callbackUrl,
    status: field('App Status'),
    permissions: rows
      .filter((row) => (row[0] ?? '') !== '' && (row[2] ?? '') !== '')
      .map((row) => ({ name: row[0] ?? '', status: row[2] ?? '' })),
    source: 'application-center'
  };
}

async function readApplicationCenterCandidates(
  frame: Frame
): Promise<Omit<CloudApplication, 'applicationId'>[]> {
  const endpoint = new URL('/handler/share/app/getAppList.json', frame.url());
  const response = await frame
    .page()
    .context()
    .request.get(endpoint.href, {
      headers: { Accept: 'application/json' },
      timeout: STEP_TIMEOUT_MILLISECONDS
    })
    .catch(() => null);
  if (!response?.ok()) return [];
  const value = (await response.json().catch(() => null)) as unknown;
  return findApplicationRecords(value).map((candidate) => ({
    ...candidate,
    callbackUrl: null,
    status: '',
    permissions: [],
    source: 'application-center'
  }));
}

async function readLegacyApplications(
  context: BrowserContext
): Promise<Omit<CloudApplication, 'applicationId'>[]> {
  const token = await readAlibabaTokenCookie(context);
  if (!token) return [];
  const response = await context.request
    .get(LEGACY_APP_LIST_URL, {
      params: { _tb_token_: token },
      timeout: STEP_TIMEOUT_MILLISECONDS
    })
    .catch(() => null);
  if (!response?.ok()) return [];
  const value = (await response.json().catch(() => null)) as unknown;
  return findLegacyApplicationRecords(value).map((application) => ({
    ...application,
    permissions: [],
    source: 'legacy-crosstrade'
  }));
}

async function selectApplication(frame: Frame, candidate: CloudApplication): Promise<CloudApplication> {
  if (candidate.source === 'legacy-crosstrade') return candidate;
  const current = await readCurrentApplication(frame).catch(() => null);
  if (current?.appKey === candidate.appKey) return { ...candidate, ...current };
  const choice = frame.getByText(candidate.appName, { exact: true });
  if ((await choice.count()) === 0) throw new DriverFallbackError('automation-layout-unsupported');
  await choice.first().click();
  const deadline = Date.now() + STEP_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    const selected = await readCurrentApplication(frame).catch(() => null);
    if (
      selected &&
      (selected.appKey === candidate.appKey ||
        selected.appKey.includes(candidate.appKey) ||
        candidate.appKey.includes(selected.appKey))
    ) {
      return { ...candidate, ...selected };
    }
    await frame.page().waitForTimeout(250);
  }
  throw new DriverFallbackError('automation-layout-unsupported');
}

async function updateCallback(frame: Frame, callbackUrl: string): Promise<boolean> {
  const edit = frame.getByRole('button', { name: 'Edit', exact: true });
  if ((await edit.count()) === 0) return false;
  await edit.first().click();
  const input = frame.locator('input[placeholder*="callback" i]');
  await input
    .first()
    .waitFor({ state: 'visible', timeout: SHORT_WAIT_MILLISECONDS })
    .catch(() => undefined);
  if ((await input.count()) === 0) return false;
  await input.first().fill(callbackUrl);
  const save = frame.getByRole('button', { name: 'Save', exact: true });
  if ((await save.count()) === 0) return false;
  await save.first().click();
  const deadline = Date.now() + STEP_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    const current = await readCurrentApplication(frame).catch(() => null);
    if (current?.callbackUrl === callbackUrl) return true;
    await frame.page().waitForTimeout(250);
  }
  return false;
}

async function revealSecret(frame: Frame): Promise<string | null> {
  const form = frame.locator('.cloud-form').filter({ has: frame.getByText('App Secret', { exact: true }) });
  if ((await form.count()) === 0) throw new DriverFallbackError('automation-layout-unsupported');
  const view = form.getByText('View', { exact: true });
  if ((await view.count()) > 0 && (await view.first().isVisible())) await view.first().click();
  const deadline = Date.now() + SHORT_WAIT_MILLISECONDS;
  while (Date.now() < deadline) {
    const challenge = classifyAlibabaChallenge(
      await frame
        .locator('body')
        .innerText()
        .catch(() => '')
    );
    if (challenge) throw new DriverFallbackError(challenge);
    const text = await form
      .locator('.form-item')
      .innerText()
      .catch(() => '');
    const secret = text
      .split(/\s+/u)
      .map((value) => value.trim())
      .find((value) => value !== '' && !/^(view|reset|hide)$/iu.test(value));
    if (secret) return secret;
    await frame.page().waitForTimeout(200);
  }
  return null;
}

async function readLegacySecret(context: BrowserContext, appKey: string): Promise<string | null> {
  const token = await readAlibabaTokenCookie(context);
  if (!token) return null;
  const response = await context.request
    .get(LEGACY_APP_SECRET_URL, {
      params: { _tb_token_: token, appKey },
      timeout: STEP_TIMEOUT_MILLISECONDS
    })
    .catch(() => null);
  if (!response?.ok()) return null;
  const value = (await response.json().catch(() => null)) as unknown;
  const record = asRecord(value);
  return record?.isSuccess === true ? safeString(record.data) : null;
}

async function readAlibabaTokenCookie(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies(['https://i.alibaba.com', 'https://crosstrade.alibaba.com']);
  return cookies.find((cookie) => cookie.name === '_tb_token_')?.value ?? null;
}

async function authorize(page: Page, appKey: string, callback: URL, state: string): Promise<URL> {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('view', 'web');
  url.searchParams.set('sp', 'ICBU');
  url.searchParams.set('client_id', appKey);
  url.searchParams.set('redirect_uri', callback.href);
  url.searchParams.set('state', state);
  const capture = new OAuthCallbackCapture();
  const listener = (request: Request): void => {
    try {
      const candidate = new URL(request.url());
      if (
        candidate.origin === callback.origin &&
        normalizePath(candidate.pathname) === normalizePath(callback.pathname) &&
        (candidate.searchParams.has('code') || candidate.searchParams.has('error'))
      ) {
        capture.accept(candidate);
      }
    } catch {
      // 忽略浏览器内部临时 URL。
    }
  };
  page.on('request', listener);
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MILLISECONDS });
    const deadline = Date.now() + STEP_TIMEOUT_MILLISECONDS;
    while (Date.now() < deadline) {
      const captured = capture.read();
      if (captured) return captured;
      const challenge = await detectChallenge(page);
      if (challenge) throw new DriverFallbackError(challenge);
      const body = await page
        .locator('body')
        .innerText({ timeout: 1_000 })
        .catch(() => '');
      if (/authorization failed|授权失败|param-appkey\.not\.exists/iu.test(body)) {
        throw new Error('OAUTH_FAILED');
      }
      const unchecked = await hasUncheckedAgreement(page);
      if (unchecked) throw new DriverFallbackError('automation-layout-unsupported');
      const button = page.getByRole('button', { name: /^(authorize|confirm|授权|确认)$/iu });
      if ((await button.count()) > 0 && (await button.first().isVisible())) {
        await button.first().click();
      } else {
        const legacy = page.locator('input[name="event_submit_do_auth"]');
        if ((await legacy.count()) > 0 && (await legacy.first().isVisible())) await legacy.first().click();
      }
      await page.waitForTimeout(250);
    }
  } finally {
    page.off('request', listener);
  }
  throw new DriverFallbackError('automation-layout-unsupported');
}

async function hasUncheckedAgreement(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const checkboxes = frame.locator('input[type="checkbox"]');
    for (let index = 0; index < (await checkboxes.count()); index += 1) {
      const checkbox = checkboxes.nth(index);
      if ((await checkbox.isEnabled()) && !(await checkbox.isChecked())) return true;
    }
  }
  return false;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
}

class OAuthCallbackCapture {
  #value: URL | null = null;

  accept(value: URL): void {
    this.#value = value;
  }

  read(): URL | null {
    return this.#value;
  }
}

function mapDriverError(error: unknown): AlibabaCredentialAcquisitionDriverResult {
  if (error instanceof DriverPrerequisiteError) {
    return { kind: 'prerequisite-required', reasonCode: error.reasonCode };
  }
  if (error instanceof DriverFallbackError) {
    return { kind: 'extension-required', reasonCode: error.reasonCode };
  }
  if (error instanceof Error && error.message === 'TOKEN_EXCHANGE_FAILED') {
    return { kind: 'failed', code: 'TOKEN_EXCHANGE_FAILED' };
  }
  if (error instanceof Error && error.message === 'OAUTH_FAILED') {
    return { kind: 'failed', code: 'OAUTH_FAILED' };
  }
  return { kind: 'extension-required', reasonCode: 'browser-unavailable' };
}

export function summarizeCloudApplications(
  applications: readonly CloudApplication[]
): ReturnType<typeof toAlibabaCredentialApplicationSummary>[] {
  return applications.map(toAlibabaCredentialApplicationSummary);
}
