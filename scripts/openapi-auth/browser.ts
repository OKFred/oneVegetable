import type { BrowserContext, Frame, Locator, Page } from '@playwright/test';

import { callbackMatches } from './config';
import { OpenApiAuthError } from './storage';
import type { AlibabaOpenApiPermission } from './types';

export interface OpenApiApplication {
  appName: string;
  appKey: string;
  callbackUrl: URL;
  status: string;
  permissions: AlibabaOpenApiPermission[];
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
    if (await waitForPlatformConfiguration(page, options.timeoutMilliseconds)) return;
  }

  if (!options.manualFallback) {
    throw new OpenApiAuthError('LOGIN_REQUIRED', '自动登录未完成，且未启用人工验证兜底');
  }

  process.stdout.write('Alibaba 登录或安全验证需要人工完成；完成后脚本会自动继续。\n');
  if (!(await waitForPlatformConfiguration(page, options.manualTimeoutMilliseconds))) {
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
  const candidates = await readApplicationCandidates(frame);
  if (candidates.length > 1 && !selector.appKey && !selector.appName) {
    throw new OpenApiAuthError(
      'APPLICATION_SELECTION_REQUIRED',
      '检测到多个应用，请设置 OPEN_API_APP_KEY 或 OPEN_API_APP_NAME'
    );
  }

  const expected = chooseCandidate(candidates, selector);
  let current = await readApplication(frame);
  if (expected && current.appKey !== expected.appKey) {
    const label = expected.appName || expected.appKey;
    const visibleChoice = frame.getByText(label, { exact: true });
    if ((await visibleChoice.count()) === 0) {
      throw new OpenApiAuthError('APPLICATION_NOT_VISIBLE', '目标应用不在当前应用中心可选择列表中');
    }
    await visibleChoice.first().click();
    await waitForApplication(frame, expected.appKey, timeoutMilliseconds);
    current = await readApplication(frame);
  }

  if (selector.appKey && current.appKey !== selector.appKey) {
    throw new OpenApiAuthError('APPLICATION_NOT_FOUND', '未找到 OPEN_API_APP_KEY 指定的应用');
  }
  if (selector.appName && current.appName !== selector.appName) {
    throw new OpenApiAuthError('APPLICATION_NOT_FOUND', '未找到 OPEN_API_APP_NAME 指定的应用');
  }
  return current;
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

export async function revealAppSecret(frame: Frame, timeoutMilliseconds: number): Promise<string> {
  const form = formForLabel(frame, 'App Secret');
  const view = form.getByText('View', { exact: true });
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
    if (candidate) return candidate;
    await frame.page().waitForTimeout(200);
  }
  throw new OpenApiAuthError('APP_SECRET_UNAVAILABLE', 'App Secret 未显示或安全验证未完成');
}

export async function authorizeApplication(
  page: Page,
  application: OpenApiApplication,
  state: string,
  options: { timeoutMilliseconds: number; manualFallback: boolean; manualTimeoutMilliseconds: number }
): Promise<URL> {
  const authorizationUrl = new URL('https://oauth.alibaba.com/authorize');
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('view', 'web');
  authorizationUrl.searchParams.set('sp', 'ICBU');
  authorizationUrl.searchParams.set('client_id', application.appKey);
  authorizationUrl.searchParams.set('state', state);

  let capturedCallback: URL | null = null;
  const navigationListener = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return;
    try {
      const candidate = new URL(frame.url());
      if (callbackMatches(application.callbackUrl, candidate)) capturedCallback = candidate;
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

async function waitForPlatformConfiguration(page: Page, timeoutMilliseconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await hasPlatformConfiguration(page)) return true;
    await page.waitForTimeout(300);
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
  return { appName, appKey, callbackUrl, status: field('App Status'), permissions };
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
    const appKey = stringField(record, ['appkey', 'appKey']);
    const appName = stringField(record, ['name', 'appName']);
    if (appKey && appName) candidates.push({ appKey, appName });
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(value, 0);
  return uniqueCandidates(candidates);
}

function chooseCandidate(
  candidates: { appKey: string; appName: string }[],
  selector: { appKey: string | null; appName: string | null }
): { appKey: string; appName: string } | null {
  if (!selector.appKey && !selector.appName) return candidates[0] ?? null;
  const candidate = candidates.find(
    (item) =>
      (!selector.appKey || item.appKey === selector.appKey) &&
      (!selector.appName || item.appName === selector.appName)
  );
  if (!candidate) throw new OpenApiAuthError('APPLICATION_NOT_FOUND', '指定应用不在应用列表中');
  return candidate;
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
    return callbackMatches(expected, candidate) ? candidate : null;
  } catch {
    return null;
  }
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
