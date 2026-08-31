import { browser } from 'wxt/browser';

import type { AlibabaCredentialApplicationSource, AlibabaOpenApiPermission } from '@one-vegetable/core';

export const ALIBABA_APPLICATION_CENTER_URL = 'https://i.alibaba.com/explore/open-api';
const ALIBABA_LEGACY_APPLICATION_URL = 'https://crosstrade.alibaba.com/ecology/index.htm';

export const ALIBABA_CREDENTIAL_ACQUISITION_ORIGINS = [
  'https://i.alibaba.com/*',
  'https://openapi.alibaba.com/*',
  'https://crosstrade.alibaba.com/*',
  'https://oauth.alibaba.com/*'
] as const;

export interface ExtensionAlibabaApplicationDetails {
  appName: string;
  appKey: string;
  callbackUrl: string;
  status: string;
  permissions: AlibabaOpenApiPermission[];
  source: AlibabaCredentialApplicationSource;
}

export interface ExtensionAlibabaApplicationCandidate {
  appName: string;
  appKey: string;
  callbackUrl: string | null;
  status: string;
  source: AlibabaCredentialApplicationSource;
}

export type ExtensionAlibabaSecretResult =
  | { status: 'available'; appSecret: string }
  | { status: 'waiting'; reason: 'reveal' | 'security-verification' | 'layout' };

export type ExtensionAlibabaOAuthPageResult =
  | { status: 'waiting' | 'clicked' | 'manual' }
  | { status: 'challenge'; reason: 'captcha' | 'slider' | 'mfa' | 'secret-verification' }
  | { status: 'failed'; errorCode: string | null };

export type ExtensionAlibabaPageState =
  'ready' | 'login-required' | 'challenge' | 'no-application' | 'waiting';

export async function openAlibabaApplicationCenterTab(): Promise<number> {
  const tab = await browser.tabs.create({ url: ALIBABA_APPLICATION_CENTER_URL, active: true });
  if (tab.id === undefined) throw new Error('无法创建 Alibaba 应用中心标签页');
  return tab.id;
}

export async function openAlibabaLegacyApplicationTab(): Promise<number> {
  const tab = await browser.tabs.create({ url: ALIBABA_LEGACY_APPLICATION_URL, active: false });
  if (tab.id === undefined) throw new Error('无法创建 Alibaba 旧应用标签页');
  return tab.id;
}

export async function openAlibabaOAuthTab(url: URL): Promise<number> {
  const tab = await browser.tabs.create({ url: url.href, active: true });
  if (tab.id === undefined) throw new Error('无法创建 Alibaba OAuth 标签页');
  return tab.id;
}

export async function readTabUrl(tabId: number): Promise<URL | null> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return null;
  try {
    return new URL(tab.url);
  } catch {
    return null;
  }
}

export async function closeAlibabaTabs(tabIds: readonly (number | null | undefined)[]): Promise<void> {
  const unique = [...new Set(tabIds.filter((value): value is number => typeof value === 'number'))];
  if (unique.length === 0) return;
  await browser.tabs.remove(unique).catch(() => undefined);
}

export async function inspectAlibabaApplicationCenter(tabId: number): Promise<{
  application: ExtensionAlibabaApplicationDetails | null;
  candidates: ExtensionAlibabaApplicationCandidate[];
}> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: inspectApplicationCenterFrame
  });
  for (const result of results) {
    const snapshot = parseApplicationCenterSnapshot(result.result);
    if (snapshot) return snapshot;
  }
  return { application: null, candidates: [] };
}

export async function inspectAlibabaApplicationPageState(tabId: number): Promise<ExtensionAlibabaPageState> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: inspectApplicationPageStateInFrame
  });
  const states = results.map((result) => result.result).filter(isPageState);
  if (states.includes('ready')) return 'ready';
  if (states.includes('challenge')) return 'challenge';
  if (states.includes('login-required')) return 'login-required';
  if (states.includes('no-application')) return 'no-application';
  return 'waiting';
}

export async function revealAlibabaApplicationSecret(tabId: number): Promise<ExtensionAlibabaSecretResult> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: revealApplicationSecretInFrame
  });
  for (const result of results) {
    const parsed = parseSecretResult(result.result);
    if (parsed) return parsed;
  }
  return { status: 'waiting', reason: 'layout' };
}

export async function readAlibabaLegacyApplications(
  tabId: number
): Promise<ExtensionAlibabaApplicationCandidate[]> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: readLegacyApplicationsInPage
  });
  return parseApplicationCandidates(results[0]?.result, 'legacy-crosstrade');
}

export async function revealAlibabaLegacyApplicationSecret(
  tabId: number,
  appKey: string
): Promise<ExtensionAlibabaSecretResult> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: readLegacySecretInPage,
    args: [appKey]
  });
  return parseSecretResult(results[0]?.result) ?? { status: 'waiting', reason: 'layout' };
}

export async function openAlibabaApplicationCenterSection(tabId: number): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: clickApplicationCenterInFrame
  });
  return results.some((result) => result.result === true);
}

export async function selectAlibabaApplicationInPage(
  tabId: number,
  application: Pick<ExtensionAlibabaApplicationCandidate, 'appKey' | 'appName'>
): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: selectApplicationInFrame,
    args: [application.appName, application.appKey]
  });
  return results.some((result) => result.result === true);
}

export async function updateAlibabaCallbackInPage(tabId: number, callbackUrl: URL): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: updateCallbackInFrame,
    args: [callbackUrl.href]
  });
  return results.some((result) => result.result === true);
}

export async function advanceAlibabaOAuthPage(tabId: number): Promise<ExtensionAlibabaOAuthPageResult> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: advanceOAuthInFrame
  });
  for (const result of results) {
    const parsed = parseOAuthPageResult(result.result);
    if (parsed && parsed.status !== 'waiting') return parsed;
  }
  return { status: 'waiting' };
}

function parseApplicationCenterSnapshot(value: unknown): {
  application: ExtensionAlibabaApplicationDetails;
  candidates: ExtensionAlibabaApplicationCandidate[];
} | null {
  const record = asRecord(value);
  if (record?.kind !== 'application-center') return null;
  const applicationRecord = asRecord(record.application);
  if (!applicationRecord) return null;
  const appName = safeString(applicationRecord.appName);
  const appKey = safeString(applicationRecord.appKey);
  const callbackUrl = safeString(applicationRecord.callbackUrl);
  if (!appName || !appKey || !callbackUrl) return null;
  const permissions = Array.isArray(applicationRecord.permissions)
    ? applicationRecord.permissions.flatMap((item) => {
        const permission = asRecord(item);
        const name = safeString(permission?.name);
        const status = safeString(permission?.status, true);
        return name && status !== null ? [{ name, status }] : [];
      })
    : [];
  const application: ExtensionAlibabaApplicationDetails = {
    appName,
    appKey,
    callbackUrl,
    status: safeString(applicationRecord.status, true) ?? '',
    permissions,
    source: 'application-center'
  };
  return {
    application,
    candidates: parseApplicationCandidates(record.candidates, 'application-center')
  };
}

function parseApplicationCandidates(
  value: unknown,
  source: AlibabaCredentialApplicationSource
): ExtensionAlibabaApplicationCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const appName = safeString(record?.appName);
    const appKey = safeString(record?.appKey);
    if (!appName || !appKey) return [];
    const callbackUrl = safeString(record?.callbackUrl);
    return [
      {
        appName,
        appKey,
        callbackUrl,
        status: safeString(record?.status, true) ?? (source === 'legacy-crosstrade' ? 'Legacy Online' : ''),
        source
      }
    ];
  });
}

function parseSecretResult(value: unknown): ExtensionAlibabaSecretResult | null {
  const record = asRecord(value);
  if (record?.status === 'available') {
    const appSecret = safeString(record.appSecret);
    return appSecret ? { status: 'available', appSecret } : null;
  }
  if (
    record?.status === 'waiting' &&
    (record.reason === 'reveal' || record.reason === 'security-verification' || record.reason === 'layout')
  ) {
    return { status: 'waiting', reason: record.reason };
  }
  return null;
}

function parseOAuthPageResult(value: unknown): ExtensionAlibabaOAuthPageResult | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.status === 'waiting' || record.status === 'clicked' || record.status === 'manual') {
    return { status: record.status };
  }
  if (
    record.status === 'challenge' &&
    (record.reason === 'captcha' ||
      record.reason === 'slider' ||
      record.reason === 'mfa' ||
      record.reason === 'secret-verification')
  ) {
    return { status: 'challenge', reason: record.reason };
  }
  if (record.status === 'failed') {
    return { status: 'failed', errorCode: safeString(record.errorCode) };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeString(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const normalized = value.trim();
  return normalized || (allowEmpty ? '' : null);
}

function isPageState(value: unknown): value is ExtensionAlibabaPageState {
  return (
    value === 'ready' ||
    value === 'login-required' ||
    value === 'challenge' ||
    value === 'no-application' ||
    value === 'waiting'
  );
}

async function inspectApplicationCenterFrame(): Promise<unknown> {
  const forms = [...document.querySelectorAll('.cloud-form')].map((element) => ({
    label: element.querySelector('.form-label')?.textContent.trim() ?? '',
    value: element.querySelector('.form-item')?.textContent.trim() ?? ''
  }));
  const field = (label: string): string => forms.find((item) => item.label === label)?.value ?? '';
  const appName = field('App Name');
  const appKey = field('AppKey');
  const callbackUrl = field('Callback URL');
  if (!appName || !appKey || !callbackUrl) return null;

  const rows = [...document.querySelectorAll('table tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim())
  );
  const permissions = rows
    .filter((row) => (row[0] ?? '') !== '' && (row[2] ?? '') !== '')
    .map((row) => ({ name: row[0] ?? '', status: row[2] ?? '' }));

  let response: unknown = null;
  try {
    const result = await window.fetch('/handler/share/app/getAppList.json', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (result.ok) response = (await result.json()) as unknown;
  } catch {
    response = null;
  }
  const candidates: { appKey: string; appName: string; callbackUrl: null; status: string }[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const record = current as Record<string, unknown>;
    const read = (keys: readonly string[]): string | null => {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      }
      return null;
    };
    const candidateKey = read(['appkey', 'appKey', 'app_key']);
    const candidateName = read(['name', 'appName', 'appname']);
    if (candidateKey && candidateName) {
      candidates.push({ appKey: candidateKey, appName: candidateName, callbackUrl: null, status: '' });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(response, 0);
  return {
    kind: 'application-center',
    application: {
      appName,
      appKey,
      callbackUrl,
      status: field('App Status'),
      permissions
    },
    candidates: [...new Map(candidates.map((candidate) => [candidate.appKey, candidate])).values()]
  };
}

function inspectApplicationPageStateInFrame(): ExtensionAlibabaPageState {
  const body = document.body.innerText;
  if (document.querySelector('.cloud-form .form-label')) return 'ready';
  const password = document.querySelector('input[type="password"], input[autocomplete="current-password"]');
  if (password) return 'login-required';
  if (/captcha|验证码|滑块|slide to verify|security verification|二次验证|安全验证/iu.test(body)) {
    return 'challenge';
  }
  if (/no applications?|you have not created an application|暂无应用|还没有应用/iu.test(body)) {
    return 'no-application';
  }
  if (body.includes('Application center')) return 'ready';
  return 'waiting';
}

function clickApplicationCenterInFrame(): boolean {
  const elements = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
  const target = elements.find((element) => element.textContent.trim() === 'Application center');
  if (!(target instanceof HTMLElement)) return false;
  target.click();
  return true;
}

function selectApplicationInFrame(appName: string, appKey: string): boolean {
  const elements = [...document.querySelectorAll('button, a, li, [role="option"], [role="menuitem"]')];
  const target = elements.find((element) => {
    const text = element.textContent.trim();
    return text === appName || text === appKey;
  });
  if (!(target instanceof HTMLElement)) return false;
  target.click();
  return true;
}

async function updateCallbackInFrame(callbackUrl: string): Promise<boolean> {
  const readCurrent = (): string => {
    for (const element of document.querySelectorAll('.cloud-form')) {
      const label = element.querySelector('.form-label')?.textContent.trim() ?? '';
      if (label === 'Callback URL') return element.querySelector('.form-item')?.textContent.trim() ?? '';
    }
    return '';
  };
  if (!readCurrent()) return false;
  if (readCurrent() === callbackUrl) return true;
  const edit = [...document.querySelectorAll('button, [role="button"]')].find(
    (element) => element.textContent.trim() === 'Edit'
  );
  if (edit instanceof HTMLElement) edit.click();
  const deadline = Date.now() + 10_000;
  let input: HTMLInputElement | null = null;
  while (Date.now() < deadline && !input) {
    input = document.querySelector('input[placeholder*="callback" i]');
    if (!input) await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  if (!input) return false;
  input.value = callbackUrl;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const save = [...document.querySelectorAll('button, [role="button"]')].find(
    (element) => element.textContent.trim() === 'Save'
  );
  if (!(save instanceof HTMLElement)) return false;
  save.click();
  while (Date.now() < deadline) {
    if (readCurrent() === callbackUrl) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return false;
}

function revealApplicationSecretInFrame(): unknown {
  const body = document.body.innerText;
  const challenge = /captcha|verification code|security verification|验证码|滑块|安全验证|二次验证/i.test(
    body
  );
  const forms = [...document.querySelectorAll('.cloud-form')];
  const form = forms.find(
    (element) => element.querySelector('.form-label')?.textContent.trim() === 'App Secret'
  );
  if (!form) return challenge ? { status: 'waiting', reason: 'security-verification' } : null;
  const item = form.querySelector('.form-item');
  const candidate = (item?.textContent ?? '')
    .split(/\s+/u)
    .map((value) => value.trim())
    .find((value) => value !== '' && !/^(view|reset|hide)$/iu.test(value));
  if (candidate) return { status: 'available', appSecret: candidate };
  const view = [...form.querySelectorAll('button, a, [role="button"]')].find(
    (element) => element.textContent.trim() === 'View'
  );
  if (view instanceof HTMLElement) {
    view.click();
    return { status: 'waiting', reason: 'reveal' };
  }
  return {
    status: 'waiting',
    reason: challenge ? 'security-verification' : 'layout'
  };
}

async function readLegacyApplicationsInPage(): Promise<unknown> {
  const token = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('_tb_token_='))
    ?.slice('_tb_token_='.length);
  const url = new URL('/ecology/ajax/listApp.json', location.origin);
  if (token) url.searchParams.set('_tb_token_', token);
  let value: unknown;
  try {
    const response = await window.fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return [];
    value = (await response.json()) as unknown;
  } catch {
    return [];
  }
  const candidates: { appKey: string; appName: string; callbackUrl: string | null; status: string }[] = [];
  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    const record = current as Record<string, unknown>;
    const read = (keys: readonly string[]): string | null => {
      for (const key of keys) {
        const item = record[key];
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (typeof item === 'number' && Number.isFinite(item)) return String(item);
      }
      return null;
    };
    const appKey = read(['appKey', 'appkey', 'app_key']);
    if (appKey) {
      candidates.push({
        appKey,
        appName: read(['appName', 'appname', 'name', 'isvName']) ?? 'Legacy ICBU application',
        callbackUrl: read(['callbackUrl', 'callbackURL', 'callback_url']),
        status: 'Legacy Online'
      });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(value, 0);
  return [...new Map(candidates.map((candidate) => [candidate.appKey, candidate])).values()];
}

async function readLegacySecretInPage(appKey: string): Promise<unknown> {
  const token = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('_tb_token_='))
    ?.slice('_tb_token_='.length);
  const url = new URL('/ecology/ajax/getAppSecret.json', location.origin);
  if (token) url.searchParams.set('_tb_token_', token);
  url.searchParams.set('appKey', appKey);
  try {
    const response = await window.fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return { status: 'waiting', reason: 'layout' };
    const value = (await response.json()) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { status: 'waiting', reason: 'layout' };
    }
    const record = value as Record<string, unknown>;
    return record.isSuccess === true && typeof record.data === 'string' && record.data.trim()
      ? { status: 'available', appSecret: record.data.trim() }
      : { status: 'waiting', reason: 'security-verification' };
  } catch {
    return { status: 'waiting', reason: 'layout' };
  }
}

function advanceOAuthInFrame(): unknown {
  const body = document.body.innerText;
  const errorCode = /Error\s*Code\s*:\s*([^\s]+)/iu.exec(body)?.[1] ?? null;
  if (errorCode || /authorization failed|授权失败/iu.test(body)) {
    return { status: 'failed', errorCode };
  }
  if (/captcha|验证码/iu.test(body)) return { status: 'challenge', reason: 'captcha' };
  if (/slider|slide to verify|滑块|拖动/iu.test(body)) return { status: 'challenge', reason: 'slider' };
  if (/multi-factor|two-factor|verification code|二次验证|双重验证/iu.test(body)) {
    return { status: 'challenge', reason: 'mfa' };
  }
  if (/security verification|安全验证|密钥验证/iu.test(body)) {
    return { status: 'challenge', reason: 'secret-verification' };
  }
  const uncheckedAgreement = [...document.querySelectorAll('input[type="checkbox"]')].some(
    (element) => element instanceof HTMLInputElement && !element.checked && !element.disabled
  );
  if (uncheckedAgreement) return { status: 'manual' };
  const button = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].find(
    (element) => {
      const text = element instanceof HTMLInputElement ? element.value.trim() : element.textContent.trim();
      return /^(authorize|confirm|授权|确认)$/iu.test(text);
    }
  );
  if (button instanceof HTMLElement) {
    button.click();
    return { status: 'clicked' };
  }
  const legacy = document.querySelector('input[name="event_submit_do_auth"]');
  if (legacy instanceof HTMLElement) {
    legacy.click();
    return { status: 'clicked' };
  }
  return { status: 'waiting' };
}
