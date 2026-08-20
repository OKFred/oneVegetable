import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { BrowserContext, Frame, Locator, Page, Request } from '@playwright/test';

import { callbackMatches } from './config';
import { OpenApiAuthError } from './storage';
import type { AlibabaOpenApiPermission } from './types';

export interface OpenApiApplication {
  appName: string;
  appKey: string;
  callbackUrl: URL;
  status: string;
  permissions: AlibabaOpenApiPermission[];
  source: 'application-center' | 'legacy-crosstrade';
}

interface ApplicationCandidate {
  appKey: string;
  appName: string;
  callbackUrl: string | null;
  source: OpenApiApplication['source'];
}

export interface RevealedApplicationSecret {
  appKey: string | null;
  appSecret: string;
}

export async function ensureAlibabaLogin(
  page: Page,
  targetUrl: URL,
  credentials: { account: string | null; password: string | null },
  options: { timeoutMilliseconds: number; manualFallback: boolean; manualTimeoutMilliseconds: number }
): Promise<void> {
  await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: options.timeoutMilliseconds });
  if (await hasPlatformConfiguration(page)) return;

  const loginForm = await findLoginForm(page);
  if (loginForm && credentials.account && credentials.password) {
    await loginForm.account.fill(credentials.account);
    await loginForm.password.fill(credentials.password);
    await loginForm.submit.click();
    if (await waitForPlatformConfiguration(page, targetUrl, options.timeoutMilliseconds)) return;
  }

  if (!options.manualFallback) {
    throw new OpenApiAuthError('LOGIN_REQUIRED', '自动登录未完成，且未启用人工验证兜底');
  }

  process.stdout.write('Alibaba 登录或安全验证需要人工完成；完成后脚本会自动继续。\n');
  if (!(await waitForPlatformConfiguration(page, targetUrl, options.manualTimeoutMilliseconds))) {
    throw new OpenApiAuthError('MANUAL_LOGIN_TIMEOUT', '等待人工登录或安全验证超时');
  }
}

export async function openApplicationCenter(page: Page, timeoutMilliseconds: number): Promise<Frame> {
  const applicationCenter = page.getByText('Application center', { exact: true });
  await applicationCenter.waitFor({ state: 'visible', timeout: timeoutMilliseconds });
  await applicationCenter.click();

  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const frame = page.frames().find((item) => item.url().includes('openapi.alibaba.com/app/index.htm'));
    if (frame) {
      const body = frame.locator('body');
      if (await body.isVisible().catch(() => false)) return frame;
    }
    await page.waitForTimeout(200);
  }
  throw new OpenApiAuthError('APPLICATION_CENTER_TIMEOUT', '应用中心未在预期时间内就绪');
}

export async function selectApplication(
  frame: Frame,
  selector: { appKey: string | null; appName: string | null },
  timeoutMilliseconds: number
): Promise<OpenApiApplication> {
  await waitForApplicationDetails(frame, timeoutMilliseconds);
  const current = await readApplication(frame);
  const applicationCenterCandidates = (await readApplicationCandidates(frame)).map((item) => ({
    ...item,
    callbackUrl: null,
    source: 'application-center' as const
  }));
  const legacyCandidates = await readLegacyApplicationCandidates(frame.page().context());
  const candidates = uniqueApplicationCandidates([
    {
      appKey: current.appKey,
      appName: current.appName,
      callbackUrl: current.callbackUrl.href,
      source: 'application-center'
    },
    ...applicationCenterCandidates,
    ...legacyCandidates
  ]);
  process.stdout.write(
    `应用候选：${candidates.length}；旧平台候选：${legacyCandidates.length}；AppKey 长度：${candidates.map((item) => item.appKey.length).join(',') || '无'}\n`
  );
  if (candidates.length > 1 && !selector.appKey && !selector.appName && legacyCandidates.length !== 1) {
    throw new OpenApiAuthError(
      'APPLICATION_SELECTION_REQUIRED',
      '检测到多个应用，请设置 OPEN_API_APP_KEY 或 OPEN_API_APP_NAME'
    );
  }

  const expected = chooseApplicationCandidate(candidates, legacyCandidates, current, selector);
  if (expected?.source === 'legacy-crosstrade') {
    if (!expected.callbackUrl) {
      throw new OpenApiAuthError('LEGACY_CALLBACK_UNAVAILABLE', '旧平台应用未返回 Callback URL');
    }
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(expected.callbackUrl);
    } catch {
      throw new OpenApiAuthError('APPLICATION_CALLBACK_INVALID', '旧平台应用 Callback URL 无效');
    }
    return {
      appName: expected.appName,
      appKey: expected.appKey,
      callbackUrl,
      status: 'Legacy Online',
      permissions: [],
      source: 'legacy-crosstrade'
    };
  }

  let selected = current;
  if (expected && current.appKey !== expected.appKey) {
    if (
      current.appName === expected.appName &&
      (expected.appKey.includes(current.appKey) || current.appKey.includes(expected.appKey))
    ) {
      selected = { ...current, appKey: expected.appKey };
    } else {
      const label = expected.appName || expected.appKey;
      const visibleChoice = frame.getByText(label, { exact: true });
      if ((await visibleChoice.count()) === 0) {
        throw new OpenApiAuthError('APPLICATION_NOT_VISIBLE', '目标应用不在当前应用中心可选择列表中');
      }
      await visibleChoice.first().click();
      await waitForApplication(frame, expected.appKey, timeoutMilliseconds);
      selected = await readApplication(frame);
    }
  }

  if (selector.appKey && selected.appKey !== selector.appKey) {
    throw new OpenApiAuthError('APPLICATION_NOT_FOUND', '未找到 OPEN_API_APP_KEY 指定的应用');
  }
  if (selector.appName && selected.appName !== selector.appName) {
    throw new OpenApiAuthError('APPLICATION_NOT_FOUND', '未找到 OPEN_API_APP_NAME 指定的应用');
  }
  return selected;
}

async function waitForApplicationDetails(frame: Frame, timeoutMilliseconds: number): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (
      await readApplication(frame)
        .then(() => true)
        .catch(() => false)
    )
      return;
    await frame.page().waitForTimeout(200);
  }
  throw new OpenApiAuthError('APPLICATION_DETAILS_TIMEOUT', '等待应用详情加载超时');
}

export async function updateCallbackUrl(
  frame: Frame,
  expected: URL,
  timeoutMilliseconds: number
): Promise<OpenApiApplication> {
  const current = await readApplication(frame);
  if (callbackMatches(expected, current.callbackUrl) && expected.search === current.callbackUrl.search) {
    return current;
  }

  await frame.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = frame.locator('input[placeholder*="callback" i]');
  await input.waitFor({ state: 'visible', timeout: timeoutMilliseconds });
  await input.fill(expected.href);
  await frame.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForCallback(frame, expected, timeoutMilliseconds);
  return await readApplication(frame);
}

export async function revealAppSecret(
  frame: Frame,
  application: OpenApiApplication,
  timeoutMilliseconds: number
): Promise<RevealedApplicationSecret> {
  if (application.source === 'legacy-crosstrade') {
    return {
      appKey: application.appKey,
      appSecret: await readLegacyApplicationSecret(frame.page().context(), application.appKey)
    };
  }

  const form = formForLabel(frame, 'App Secret');
  const view = form.getByText('View', { exact: true });
  let appKey: string | null = null;
  const requestListener = (request: Request): void => {
    const candidate = extractApplicationKeyFromRequest(request.url(), request.postData());
    if (candidate) appKey = candidate;
  };
  frame.page().on('request', requestListener);
  try {
    if ((await view.count()) > 0 && (await view.first().isVisible())) await view.first().click();

    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const text = await form
        .locator('.form-item')
        .innerText()
        .catch(() => '');
      const candidate = text
        .split(/\s+/)
        .map((item) => item.trim())
        .find((item) => item !== '' && !/^(view|reset|hide)$/i.test(item));
      if (candidate) return { appKey, appSecret: candidate };
      await frame.page().waitForTimeout(200);
    }
  } finally {
    frame.page().off('request', requestListener);
  }
  throw new OpenApiAuthError('APP_SECRET_UNAVAILABLE', 'App Secret 未显示或安全验证未完成');
}

export function extractApplicationKeyFromRequest(urlValue: string, postData: string | null): string | null {
  const fromUrl = findApplicationKeyInSearchParams(new URL(urlValue).searchParams);
  if (fromUrl) return fromUrl;
  if (!postData) return null;

  try {
    const parsed = JSON.parse(postData) as unknown;
    const key = findApplicationKey(parsed);
    if (key) return key;
  } catch {
    // application/x-www-form-urlencoded 不是 JSON，继续按表单解析。
  }
  const form = new URLSearchParams(postData);
  const direct = findApplicationKeyInSearchParams(form);
  if (direct) return direct;
  for (const value of form.values()) {
    try {
      const nested = findApplicationKey(JSON.parse(value) as unknown);
      if (nested) return nested;
    } catch {
      // 普通表单字段不是 JSON，跳过。
    }
  }
  return null;
}

export async function authorizeApplication(
  page: Page,
  application: OpenApiApplication,
  state: string,
  options: { timeoutMilliseconds: number; manualFallback: boolean; manualTimeoutMilliseconds: number }
): Promise<URL> {
  const authorizationUrl = buildAuthorizationUrl(application, state);
  return await waitForAuthorizationResult(page, application, authorizationUrl, options);
}

export function buildAuthorizationUrl(application: OpenApiApplication, state: string): URL {
  const authorizationUrl = new URL('https://oauth.alibaba.com/authorize');
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('view', 'web');
  authorizationUrl.searchParams.set('sp', 'ICBU');
  authorizationUrl.searchParams.set('client_id', application.appKey);
  authorizationUrl.searchParams.set('redirect_uri', application.callbackUrl.href);
  authorizationUrl.searchParams.set('state', state);
  return authorizationUrl;
}

async function waitForAuthorizationResult(
  page: Page,
  application: OpenApiApplication,
  authorizationUrl: URL,
  options: { timeoutMilliseconds: number; manualFallback: boolean; manualTimeoutMilliseconds: number }
): Promise<URL> {
  let capturedCallback: URL | null = null;
  const navigationListener = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return;
    try {
      const candidate = new URL(frame.url());
      if (callbackMatches(application.callbackUrl, candidate) && isOAuthCallbackCandidate(candidate)) {
        capturedCallback = candidate;
      }
    } catch {
      // 导航中的临时 URL 不是有效绝对地址时忽略。
    }
  };
  page.on('framenavigated', navigationListener);
  try {
    await page.goto(authorizationUrl.href, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMilliseconds
    });
    await throwForAuthorizationPageError(page);
    capturedCallback = callbackFromPage(page, application.callbackUrl) ?? capturedCallback;
    if (!capturedCallback) await clickConsentIfPresent(page);
    capturedCallback =
      (await waitForAuthorizedCallback(page, application.callbackUrl, options.timeoutMilliseconds)) ??
      capturedCallback;

    if (!capturedCallback && options.manualFallback) {
      process.stdout.write('Alibaba OAuth 授权页需要人工确认；完成后脚本会自动继续。\n');
      capturedCallback = await waitForAuthorizedCallback(
        page,
        application.callbackUrl,
        options.manualTimeoutMilliseconds
      );
    }
  } finally {
    page.off('framenavigated', navigationListener);
  }

  if (!capturedCallback) {
    throw new OpenApiAuthError('CALLBACK_NOT_RECEIVED', '未收到匹配的 OAuth Callback');
  }
  return capturedCallback;
}

export async function captureSafeScreenshot(page: Page, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: false });
}

export async function closeContext(context: BrowserContext): Promise<void> {
  await context.close().catch(() => undefined);
}

async function hasPlatformConfiguration(page: Page): Promise<boolean> {
  return await page
    .getByText('Application center', { exact: true })
    .isVisible()
    .catch(() => false);
}

async function waitForPlatformConfiguration(
  page: Page,
  targetUrl: URL,
  timeoutMilliseconds: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  let nextTargetNavigation = 0;
  while (Date.now() < deadline) {
    if (await hasPlatformConfiguration(page)) return true;
    if (Date.now() >= nextTargetNavigation && (await canReturnToTarget(page))) {
      await page
        .goto(targetUrl.href, {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(30_000, timeoutMilliseconds)
        })
        .catch(() => undefined);
      nextTargetNavigation = Date.now() + 5_000;
      if (await hasPlatformConfiguration(page)) return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function canReturnToTarget(page: Page): Promise<boolean> {
  let current: URL;
  try {
    current = new URL(page.url());
  } catch {
    return false;
  }
  if (current.hostname === 'login.alibaba.com') return false;
  for (const frame of page.frames()) {
    const passwords = frame.locator('input[type="password"]');
    if (
      (await passwords.count()) > 0 &&
      (await passwords
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      return false;
    }
  }
  return current.hostname === 'i.alibaba.com' || current.hostname.endsWith('.alibaba.com');
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
    const submit = frame.getByRole('button', { name: /sign in|login|log in|登录/i });
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

async function readApplication(frame: Frame): Promise<OpenApiApplication> {
  const fields = await frame.locator('.cloud-form').evaluateAll((elements) =>
    elements.map((element) => ({
      label: element.querySelector('.form-label')?.textContent.trim() ?? '',
      value: element.querySelector('.form-item')?.textContent.trim() ?? ''
    }))
  );
  const field = (label: string): string => fields.find((item) => item.label === label)?.value ?? '';
  const appName = field('App Name');
  const appKey = field('AppKey');
  const callbackValue = field('Callback URL');
  if (!appName || !appKey || !callbackValue) {
    throw new OpenApiAuthError('APPLICATION_DETAILS_INCOMPLETE', '应用名称、AppKey 或 Callback URL 缺失');
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callbackValue);
  } catch {
    throw new OpenApiAuthError('APPLICATION_CALLBACK_INVALID', '应用现有 Callback URL 无效');
  }

  const rows = await frame
    .locator('table tbody tr')
    .evaluateAll((elements) =>
      elements.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()))
    );
  const permissions = rows
    .filter((row) => (row[0] ?? '') !== '' && (row[2] ?? '') !== '')
    .map((row) => ({ name: row[0] ?? '', status: row[2] ?? '' }));
  return {
    appName,
    appKey,
    callbackUrl,
    status: field('App Status'),
    permissions,
    source: 'application-center'
  };
}

async function readApplicationCandidates(frame: Frame): Promise<{ appKey: string; appName: string }[]> {
  const response = await frame
    .evaluate(async () => {
      const result = await window.fetch('/handler/share/app/getAppList.json', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!result.ok) return null;
      return (await result.json()) as unknown;
    })
    .catch(() => null);
  return uniqueCandidates(findApplicationCandidates(response));
}

export function findApplicationCandidates(value: unknown): { appKey: string; appName: string }[] {
  const candidates: { appKey: string; appName: string }[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const record = current as Record<string, unknown>;
    const appKey = stringField(record, ['appkey', 'appKey', 'app_key']);
    const appName = stringField(record, ['name', 'appName', 'appname']);
    if (appKey && appName) candidates.push({ appKey, appName });
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(value, 0);
  return uniqueCandidates(candidates);
}

function chooseApplicationCandidate(
  candidates: ApplicationCandidate[],
  legacyCandidates: ApplicationCandidate[],
  current: OpenApiApplication,
  selector: { appKey: string | null; appName: string | null }
): ApplicationCandidate | null {
  if (selector.appKey || selector.appName) {
    const candidate = candidates.find(
      (item) =>
        (!selector.appKey || item.appKey === selector.appKey) &&
        (!selector.appName || item.appName === selector.appName)
    );
    if (!candidate) throw new OpenApiAuthError('APPLICATION_NOT_FOUND', '指定应用不在应用列表中');
    return candidate;
  }
  if (legacyCandidates.length === 1 && current.appKey.length < 8) return legacyCandidates[0] ?? null;
  if (candidates.length === 1) return candidates[0] ?? null;
  return null;
}

async function readLegacyApplicationCandidates(context: BrowserContext): Promise<ApplicationCandidate[]> {
  const token = await readAlibabaTokenCookie(context);
  if (!token) return [];
  const response = await context.request
    .get('https://crosstrade.alibaba.com/ecology/ajax/listApp.json', {
      params: { _tb_token_: token },
      timeout: 30_000
    })
    .catch(() => null);
  if (!response?.ok()) return [];
  const body = (await response.json().catch(() => null)) as unknown;
  return uniqueApplicationCandidates(findLegacyApplicationCandidates(body));
}

export function findLegacyApplicationCandidates(value: unknown): ApplicationCandidate[] {
  const candidates: ApplicationCandidate[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const record = current as Record<string, unknown>;
    const appKey = stringField(record, ['appKey', 'appkey', 'app_key']);
    if (appKey) {
      candidates.push({
        appKey,
        appName: stringField(record, ['appName', 'appname', 'name', 'isvName']) ?? 'Legacy ICBU application',
        callbackUrl: stringField(record, ['callbackUrl', 'callbackURL', 'callback_url']),
        source: 'legacy-crosstrade'
      });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(value, 0);
  return uniqueApplicationCandidates(candidates);
}

async function readLegacyApplicationSecret(context: BrowserContext, appKey: string): Promise<string> {
  const token = await readAlibabaTokenCookie(context);
  if (!token) throw new OpenApiAuthError('LEGACY_SESSION_UNAVAILABLE', '旧平台登录 Token 不可用');
  const response = await context.request.get(
    'https://crosstrade.alibaba.com/ecology/ajax/getAppSecret.json',
    {
      params: { _tb_token_: token, appKey },
      timeout: 30_000
    }
  );
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok()) {
    throw new OpenApiAuthError('APP_SECRET_UNAVAILABLE', '旧平台 App Secret 请求失败');
  }
  const secret = findLegacySecret(body);
  if (!secret) throw new OpenApiAuthError('APP_SECRET_UNAVAILABLE', '旧平台未返回 App Secret');
  return secret;
}

async function readAlibabaTokenCookie(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies(['https://i.alibaba.com', 'https://crosstrade.alibaba.com']);
  return cookies.find((cookie) => cookie.name === '_tb_token_')?.value ?? null;
}

function findLegacySecret(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.isSuccess !== true) return null;
  return typeof record.data === 'string' && record.data.trim() !== '' ? record.data.trim() : null;
}

function uniqueApplicationCandidates(candidates: ApplicationCandidate[]): ApplicationCandidate[] {
  return [...new Map(candidates.map((item) => [item.appKey, item])).values()];
}

function uniqueCandidates(
  candidates: { appKey: string; appName: string }[]
): { appKey: string; appName: string }[] {
  return [...new Map(candidates.map((item) => [item.appKey, item])).values()];
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function findApplicationKeyInSearchParams(searchParams: URLSearchParams): string | null {
  for (const key of ['appkey', 'appKey', 'app_key']) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

function findApplicationKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findApplicationKey(item, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = stringField(record, ['appkey', 'appKey', 'app_key']);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const candidate = findApplicationKey(child, depth + 1);
    if (candidate) return candidate;
  }
  return null;
}

function formForLabel(frame: Frame, label: string): Locator {
  return frame.locator('.cloud-form').filter({ has: frame.getByText(label, { exact: true }) });
}

async function waitForApplication(frame: Frame, appKey: string, timeoutMilliseconds: number): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const application = await readApplication(frame).catch(() => null);
    if (application?.appKey === appKey) return;
    await frame.page().waitForTimeout(200);
  }
  throw new OpenApiAuthError('APPLICATION_SELECTION_TIMEOUT', '等待目标应用详情超时');
}

async function waitForCallback(frame: Frame, expected: URL, timeoutMilliseconds: number): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const application = await readApplication(frame).catch(() => null);
    if (
      application &&
      callbackMatches(expected, application.callbackUrl) &&
      expected.search === application.callbackUrl.search
    ) {
      return;
    }
    await frame.page().waitForTimeout(200);
  }
  throw new OpenApiAuthError('CALLBACK_UPDATE_TIMEOUT', 'Callback URL 保存后未通过回读确认');
}

function callbackFromPage(page: Page, expected: URL): URL | null {
  try {
    const candidate = new URL(page.url());
    return callbackMatches(expected, candidate) && isOAuthCallbackCandidate(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function isOAuthCallbackCandidate(url: URL): boolean {
  return url.searchParams.has('code') || url.searchParams.has('error');
}

async function clickConsentIfPresent(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const button = frame.getByRole('button', { name: /authorize|agree|confirm|授权|同意|确认/i });
    if ((await button.count()) > 0 && (await button.first().isVisible())) {
      await button.first().click();
      return;
    }
    const legacySubmit = frame.locator('input[name="event_submit_do_auth"]');
    if ((await legacySubmit.count()) > 0 && (await legacySubmit.first().isVisible())) {
      await legacySubmit.first().click();
      return;
    }
  }
}

async function throwForAuthorizationPageError(page: Page): Promise<void> {
  const body = await page
    .locator('body')
    .innerText({ timeout: 5_000 })
    .catch(() => '');
  const errorCode = /Error\s*Code\s*:\s*([^\s]+)/i.exec(body)?.[1];
  if (!errorCode && !/authorization failed|授权失败/i.test(body)) return;
  throw new OpenApiAuthError(
    'OAUTH_AUTHORIZATION_FAILED',
    errorCode ? `Alibaba OAuth 授权页返回错误：${errorCode}` : 'Alibaba OAuth 授权页拒绝了当前应用'
  );
}

async function waitForAuthorizedCallback(
  page: Page,
  expected: URL,
  timeoutMilliseconds: number
): Promise<URL | null> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const callback = callbackFromPage(page, expected);
    if (callback) return callback;
    await page.waitForTimeout(200);
  }
  return null;
}
