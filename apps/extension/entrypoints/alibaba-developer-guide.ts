import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  authorizationDiscoveryReason,
  type AuthorizationDiscoveryReason
} from '../lib/authorization-discovery-reason';

import type {
  AlibabaCredentialAcquisitionState,
  AlibabaCredentialPrerequisiteState,
  ExtensionAlibabaCredentialAcquisitionOperation,
  ExtensionAlibabaCredentialAcquisitionRequest,
  ExtensionAlibabaCredentialAcquisitionResponse,
  UiLocale
} from '@one-vegetable/core';

const HOST_ID = 'one-vegetable-alibaba-developer-guide';
const guideScope = globalThis as typeof globalThis & {
  __oneVegetableDeveloperGuide?: { host: HTMLElement; dispose: () => void };
};

interface GuideUpdateMessage {
  kind: 'one-vegetable-alibaba-developer-guide-update';
  state?: AlibabaCredentialAcquisitionState;
  authorization?: {
    protocol: 'top' | 'iop';
    phase: 'opening' | 'application' | 'secret' | 'ready' | 'blocked';
    reasonCode?: AuthorizationDiscoveryReason;
  };
  uiLocale?: UiLocale;
}

interface GuideCopy {
  product: string;
  collapse: string;
  expand: string;
  progress: string;
  steps: readonly string[];
  titles: Record<AlibabaCredentialPrerequisiteState['reasonCode'], string>;
  descriptions: Record<AlibabaCredentialPrerequisiteState['reasonCode'], string>;
  registrationItems: readonly string[];
  applicationItems: readonly string[];
  checkedAt: string;
  privacy: string;
  locate: string;
  recheck: string;
  back: string;
  checking: string;
  focused: string;
  noField: string;
  ready: string;
  error: string;
  protocolTitle: string;
  protocolDescription: string;
  iopApplication: string;
  topUnavailable: string;
  openIop: string;
  reading: Record<'opening' | 'application' | 'secret' | 'ready' | 'blocked', string>;
  readingPrivacy: string;
  readingErrors: Record<AuthorizationDiscoveryReason, string>;
}

const COPY: Record<UiLocale, GuideCopy> = {
  'zh-CN': {
    product: 'oneVegetable 开放平台向导',
    collapse: '收起向导',
    expand: '展开向导',
    progress: '当前进度',
    steps: ['开发者注册', '平台审核', '创建应用', 'OAuth 授权'],
    titles: {
      'developer-registration-required': '请完成开发者注册',
      'developer-registration-under-review': '注册资料正在审核',
      'developer-registration-rejected': '注册资料已被退回',
      'application-required': '请创建开放平台应用',
      'application-not-ready': '应用尚未准备完成'
    },
    descriptions: {
      'developer-registration-required': '请在当前页面逐项填写，并由你本人确认协议和提交。',
      'developer-registration-under-review': '平台当前提示约需 2–5 个工作日，请以页面最新状态为准。',
      'developer-registration-rejected': '请根据平台退回原因修正资料并重新提交。',
      'application-required': '开发者身份可用后，还需要创建并配置一个应用。',
      'application-not-ready': '请检查应用基础信息、Callback、权限和 Online 状态。'
    },
    registrationItems: ['国家/地区与法定公司名称', '注册号与完整注册地址', '证明材料', '三份平台协议'],
    applicationItems: ['应用基础信息', '公共 HTTPS Callback', '所需 API 权限', '可授权的应用状态'],
    checkedAt: '最后检查',
    privacy: '插件只检查是否完成，不读取、保存或提交注册资料。',
    locate: '定位下一项',
    recheck: '重新检查',
    back: '返回 oneVegetable',
    checking: '正在重新检查…',
    focused: '已定位下一项。',
    noField: '未找到可定位字段，请查看页面提示。',
    ready: '前置状态已变化，请返回 oneVegetable 继续。',
    error: '检查失败，请稍后重试。',
    protocolTitle: 'TOP 与 IOP 是两套独立授权',
    protocolDescription:
      '此应用中心展示新版 IOP 应用，旧 TOP 应用不是这里的另一个页签。已有两类应用时建议分别授权；两份配置齐全后默认按能力选路，请确保属于同一商家。没有 TOP 应用不强制补齐。AppKey、Secret 和 Token 不可跨协议混用。',
    iopApplication: '请使用新版 IOP 授权工具',
    topUnavailable:
      '旧版 TOP 向导未发现可用旧应用，不会再自动打开已失效的 crosstrade 页面。新版 IOP 请使用下方工具；已有 TOP 凭据请返回设置导入或手动填写。',
    openIop: '打开 IOP 授权工具',
    reading: {
      opening: '正在检查开放平台，准备进入应用中心…',
      application: '正在读取当前应用与已登记 Callback…',
      secret: '正在读取 App Secret；需要安全验证时请手工完成。',
      ready: '应用信息已填入授权工具，请返回工具继续。',
      blocked: '自动读取已停止，请查看授权工具中的原因并检查当前页面。'
    },
    readingPrivacy: '仅在本次主动授权时读取应用信息，不修改应用、不重置密钥、不自动接受协议。',
    readingErrors: {
      IOP_APP_READ_FAILED:
        '应用详情未能完整加载。请打开“应用中心”，确认 App Name、AppKey 和 Callback 均已显示，再重新读取。',
      IOP_APP_CENTER_UNAVAILABLE: '未能自动打开应用中心。请手动点击“应用中心”，待详情显示后重新读取。',
      IOP_APP_PAGE_UNAVAILABLE:
        '应用页面正在跳转或无法访问。请等待页面加载完成，并检查插件是否获准访问此站点，再重新读取。',
      IOP_APP_SECRET_CONTROL_UNAVAILABLE:
        '已找到应用，但未能点击查看密钥。请手动点击 App Secret 旁的 View 后重新读取。',
      IOP_APP_SECRET_UNAVAILABLE: '已点击 View，但尚未读到密钥。请检查页面上的提示，完成验证后重新读取。',
      IOP_APP_SECURITY_CHECK: 'Alibaba 要求安全验证。请在当前页面手工完成验证码或密钥验证，再重新读取。',
      IOP_APP_LOGIN_REQUIRED: '请先在 Alibaba 页面完成登录，再返回授权工具重新读取。',
      IOP_APP_PREREQUISITE_REQUIRED: '请先完成开发者审核，并确认应用已上线和登记 Callback，再重新读取。',
      IOP_APP_SELECTION_REQUIRED: '打开了多个应用中心。请保留需要授权的那个，再重新读取。',
      IOP_APP_CHANGED: '读取时应用或 Callback 发生变化。请确认目标应用后重新读取。',
      CALLBACK_INVALID: '登记的 Callback 不完整或格式不支持。请检查它是否是无参数、无片段的公共 HTTPS 地址。',
      TOP_APP_NOT_AVAILABLE: '未能读取旧版 TOP 应用。请返回授权工具，导入已有 TOP 授权包或填写旧应用信息。',
      TOP_APP_SELECTION_REQUIRED: '发现多个旧版 TOP 应用。请在授权工具中指定目标应用信息。'
    }
  },
  'en-US': {
    product: 'oneVegetable Open Platform guide',
    collapse: 'Collapse guide',
    expand: 'Expand guide',
    progress: 'Current progress',
    steps: ['Developer registration', 'Platform review', 'Create application', 'OAuth authorization'],
    titles: {
      'developer-registration-required': 'Complete developer registration',
      'developer-registration-under-review': 'Registration is under review',
      'developer-registration-rejected': 'Registration was returned',
      'application-required': 'Create an Open Platform application',
      'application-not-ready': 'The application is not ready'
    },
    descriptions: {
      'developer-registration-required':
        'Complete each item here, then personally accept and submit the agreements.',
      'developer-registration-under-review':
        'Alibaba currently indicates 2–5 business days; follow the latest page status.',
      'developer-registration-rejected':
        'Correct the information according to Alibaba’s return reason and resubmit.',
      'application-required': 'After developer approval, create and configure an application.',
      'application-not-ready': 'Check application details, Callback, permissions, and Online status.'
    },
    registrationItems: [
      'Country/region and legal company name',
      'Registration number and full address',
      'Supporting document',
      'Three platform agreements'
    ],
    applicationItems: [
      'Application details',
      'Public HTTPS Callback',
      'Required API permissions',
      'OAuth-ready status'
    ],
    checkedAt: 'Last checked',
    privacy: 'The extension checks completion only. It never reads, stores, or submits registration data.',
    locate: 'Locate next item',
    recheck: 'Check again',
    back: 'Return to oneVegetable',
    checking: 'Checking again…',
    focused: 'The next item is focused.',
    noField: 'No field could be focused. Review the page message.',
    ready: 'The prerequisite changed. Return to oneVegetable to continue.',
    error: 'The check failed. Try again later.',
    protocolTitle: 'TOP and IOP are separate authorizations',
    protocolDescription:
      'This console shows the new IOP app, not a second tab for legacy TOP. Authorize both if available: capability routing starts automatically once both are configured. Ensure they belong to the same merchant. TOP is optional. Never mix AppKeys, secrets, or tokens across protocols.',
    iopApplication: 'Use the new IOP authorization tool',
    topUnavailable:
      'The TOP assistant found no usable legacy app and will not open the retired crosstrade page. Use the IOP tool below for the new app, or return to Settings to import or enter existing TOP credentials.',
    openIop: 'Open IOP authorization tool',
    reading: {
      opening: 'Checking Open Platform and preparing to enter Application center…',
      application: 'Reading the current app and registered Callback…',
      secret: 'Reading App Secret. Complete any security verification yourself.',
      ready: 'App details are filled in. Return to the authorization tool to continue.',
      blocked: 'Automatic reading stopped. Check the reason in the authorization tool and review this page.'
    },
    readingPrivacy:
      'Reads app details only for this initiated flow. No app changes, secret reset or automatic agreement acceptance.',
    readingErrors: {
      IOP_APP_READ_FAILED:
        'App details did not finish loading. Open Application center and check App Name, AppKey and Callback, then read again.',
      IOP_APP_CENTER_UNAVAILABLE:
        'Application center could not be opened automatically. Open it yourself, wait for the details, then read again.',
      IOP_APP_PAGE_UNAVAILABLE:
        'The app page is navigating or inaccessible. Wait for it to load and check the extension’s site access, then read again.',
      IOP_APP_SECRET_CONTROL_UNAVAILABLE:
        'The app was found, but View secret could not be clicked. Click View beside App Secret, then read again.',
      IOP_APP_SECRET_UNAVAILABLE:
        'View was clicked, but the secret is not available yet. Check this page, complete any verification, then read again.',
      IOP_APP_SECURITY_CHECK:
        'Alibaba requires a security check. Complete the CAPTCHA or secret verification here, then read again.',
      IOP_APP_LOGIN_REQUIRED: 'Sign in on Alibaba, then return to the authorization tool and read again.',
      IOP_APP_PREREQUISITE_REQUIRED:
        'Complete developer review and check that the app is Online with a registered Callback, then read again.',
      IOP_APP_SELECTION_REQUIRED:
        'Multiple Application center tabs are open. Keep the intended one and read again.',
      IOP_APP_CHANGED:
        'The app or Callback changed during reading. Confirm the intended app, then read again.',
      CALLBACK_INVALID:
        'The registered Callback is missing or unsupported. Check that it is a public HTTPS address without a query or fragment.',
      TOP_APP_NOT_AVAILABLE:
        'The legacy TOP app could not be read. Return to the tool to import an existing TOP bundle or enter the legacy app details.',
      TOP_APP_SELECTION_REQUIRED:
        'Multiple legacy TOP apps were found. Specify the intended app in the authorization tool.'
    }
  }
};

export default defineUnlistedScript(() => {
  mountGuide();
});

function mountGuide(): void {
  const existingHost = document.getElementById(HOST_ID);
  const existingInstance = guideScope.__oneVegetableDeveloperGuide;
  if (existingInstance?.host === existingHost && existingHost.isConnected) return;
  existingInstance?.dispose();
  // Reload invalidates the isolated world's listeners, but may leave its DOM behind.
  existingHost?.remove();

  let locale: UiLocale = navigator.language.toLowerCase().includes('zh') ? 'zh-CN' : 'en-US';
  let copy = COPY[locale];
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; width: min(390px, calc(100% - max(16px, env(safe-area-inset-right)) - max(16px, env(safe-area-inset-left)))); right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = guideStyles;
  shadow.append(style);

  const panel = element('aside', 'panel');
  panel.setAttribute('aria-live', 'polite');
  const header = element('header', 'header');
  const product = element('strong', 'product', copy.product);
  const collapse = button(copy.collapse, 'icon-button');
  collapse.textContent = '−';
  header.append(product, collapse);
  const body = element('div', 'body');
  const progress = element('p', 'eyebrow', copy.progress);
  const steps = element('ol', 'steps');
  const title = element('h2', 'title');
  const description = element('p', 'description');
  const protocolTitle = element('strong', 'protocol-title', copy.protocolTitle);
  const protocolDescription = element('p', 'description', copy.protocolDescription);
  const protocols = element('section', 'protocols');
  protocols.append(protocolTitle, protocolDescription);
  const checklist = element('ul', 'checklist');
  const checkedAt = element('p', 'checked-at');
  const privacy = element('p', 'privacy', copy.privacy);
  const feedback = element('p', 'feedback');
  feedback.hidden = true;
  const actions = element('div', 'actions');
  const locate = button(copy.locate, 'secondary');
  const recheck = button(copy.recheck, 'primary');
  const back = button(copy.back, 'secondary');
  const openIop = button(copy.openIop, 'secondary');
  actions.append(locate, recheck, openIop, back);
  body.append(
    progress,
    steps,
    title,
    description,
    protocols,
    checklist,
    checkedAt,
    privacy,
    feedback,
    actions
  );
  panel.append(header, body);
  shadow.append(panel);
  document.documentElement.append(host);

  let collapsed = false;

  collapse.addEventListener('click', () => {
    collapsed = !collapsed;
    body.hidden = collapsed;
    collapse.textContent = collapsed ? '+' : '−';
    collapse.setAttribute('aria-label', collapsed ? copy.expand : copy.collapse);
    collapse.title = collapsed ? copy.expand : copy.collapse;
  });

  locate.addEventListener('click', () => void locateNextField());
  recheck.addEventListener('click', () => void recheckPrerequisite());
  openIop.addEventListener('click', () => {
    void requestAcquisition('open-iop-tool').catch(() => {
      showFeedback(copy.error, true);
    });
  });
  back.addEventListener('click', () => {
    void browser.runtime.openOptionsPage().catch(() => {
      showFeedback(copy.error, true);
    });
  });

  const onMessage = (message: unknown): void => {
    if (!isRecord(message)) return;
    if (message.kind === 'one-vegetable-alibaba-developer-guide-remove') {
      dispose();
      return;
    }
    if (message.kind !== 'one-vegetable-alibaba-developer-guide-update') return;
    const update = message as unknown as GuideUpdateMessage;
    if (update.uiLocale === 'zh-CN' || update.uiLocale === 'en-US') {
      locale = update.uiLocale;
      copy = COPY[locale];
      product.textContent = copy.product;
      progress.textContent = copy.progress;
      privacy.textContent = copy.privacy;
      protocolTitle.textContent = copy.protocolTitle;
      protocolDescription.textContent = copy.protocolDescription;
      for (const [control, label] of [
        [locate, copy.locate],
        [recheck, copy.recheck],
        [openIop, copy.openIop],
        [back, copy.back]
      ] as const) {
        control.textContent = label;
        control.setAttribute('aria-label', label);
        control.title = label;
      }
      collapse.setAttribute('aria-label', collapsed ? copy.expand : copy.collapse);
      collapse.title = collapsed ? copy.expand : copy.collapse;
    }
    const authorization = update.authorization;
    if (
      authorization &&
      ['top', 'iop'].includes(authorization.protocol) &&
      ['opening', 'application', 'secret', 'ready', 'blocked'].includes(authorization.phase)
    ) {
      progress.hidden = false;
      progress.textContent = `${copy.progress} · ${authorization.protocol.toUpperCase()}`;
      steps.hidden = true;
      const reason = authorizationDiscoveryReason(authorization.reasonCode);
      title.textContent =
        authorization.phase === 'blocked' && reason
          ? copy.readingErrors[reason]
          : copy.reading[authorization.phase];
      description.textContent = copy.readingPrivacy;
      privacy.hidden = true;
      checklist.replaceChildren();
      checkedAt.textContent = '';
      locate.hidden = true;
      recheck.hidden = true;
      openIop.hidden = true;
    } else if (update.state) render(update.state);
  };
  const instance = { host, dispose };
  guideScope.__oneVegetableDeveloperGuide = instance;
  browser.runtime.onMessage.addListener(onMessage);

  function dispose(): void {
    host.remove();
    browser.runtime.onMessage.removeListener(onMessage);
    if (guideScope.__oneVegetableDeveloperGuide === instance) {
      delete guideScope.__oneVegetableDeveloperGuide;
    }
  }

  async function locateNextField(): Promise<void> {
    setBusy(true);
    try {
      const fieldId = await requestAcquisition('locate-prerequisite-field');
      showFeedback(typeof fieldId === 'string' && fieldId !== '' ? copy.focused : copy.noField);
    } catch {
      showFeedback(copy.error, true);
    } finally {
      setBusy(false);
    }
  }

  async function recheckPrerequisite(): Promise<void> {
    setBusy(true);
    showFeedback(copy.checking);
    try {
      const value = await requestAcquisition('read-prerequisite');
      const next = value === null ? null : asAcquisitionState(value);
      render(next);
      showFeedback(
        next?.status === 'prerequisite-required' ? copy.descriptions[next.reasonCode] : copy.ready
      );
    } catch {
      showFeedback(copy.error, true);
    } finally {
      setBusy(false);
    }
  }

  function render(state: AlibabaCredentialAcquisitionState | null): void {
    privacy.hidden = false;
    openIop.hidden = false;
    const needsIop = state?.status === 'failed' && state.error.code === 'TOP_APPLICATION_REQUIRED';
    progress.hidden = needsIop;
    steps.hidden = needsIop;
    recheck.hidden = needsIop;
    if (state?.status !== 'prerequisite-required') {
      title.textContent = needsIop ? copy.iopApplication : copy.ready;
      description.textContent = needsIop ? copy.topUnavailable : '';
      checklist.replaceChildren();
      checkedAt.textContent = '';
      locate.hidden = true;
      return;
    }
    title.textContent = copy.titles[state.reasonCode];
    description.textContent = copy.descriptions[state.reasonCode];
    checkedAt.textContent = `${copy.checkedAt}: ${new Date(state.checkedAtUtc).toLocaleString(locale)}`;
    const activeStep = prerequisiteStep(state.reasonCode);
    steps.replaceChildren(
      ...copy.steps.map((label, index) => {
        const item = element('li', index === activeStep ? 'active' : index < activeStep ? 'done' : '');
        item.textContent = `${index + 1}. ${label}`;
        return item;
      })
    );
    const items = activeStep === 0 ? copy.registrationItems : activeStep === 2 ? copy.applicationItems : [];
    checklist.replaceChildren(...items.map((text) => element('li', '', text)));
    locate.hidden = activeStep !== 0;
  }

  function setBusy(busy: boolean): void {
    locate.disabled = busy;
    recheck.disabled = busy;
    openIop.disabled = busy;
    back.disabled = busy;
  }

  function showFeedback(message: string, failed = false): void {
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.dataset.failed = String(failed);
  }
}

async function requestAcquisition(
  operation: ExtensionAlibabaCredentialAcquisitionOperation,
  payload?: unknown
) {
  const request: ExtensionAlibabaCredentialAcquisitionRequest = {
    requestId: crypto.randomUUID(),
    kind: 'alibaba-credential-acquisition-request',
    operation,
    ...(payload === undefined ? {} : { payload })
  };
  const response: ExtensionAlibabaCredentialAcquisitionResponse = await browser.runtime.sendMessage(request);
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

function asAcquisitionState(value: unknown): AlibabaCredentialAcquisitionState {
  if (!isRecord(value) || typeof value.status !== 'string') throw new Error('Invalid acquisition state');
  return value as unknown as AlibabaCredentialAcquisitionState;
}

function prerequisiteStep(reason: AlibabaCredentialPrerequisiteState['reasonCode']): number {
  if (reason === 'developer-registration-under-review') return 1;
  if (reason === 'application-required' || reason === 'application-not-ready') return 2;
  return 0;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, className: string): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const guideStyles = `
  :host { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  .panel { display: flex; flex-direction: column; width: 100%; max-height: calc(100vh - 32px); max-height: calc(100dvh - max(16px, env(safe-area-inset-bottom)) - max(16px, env(safe-area-inset-top))); overflow: hidden; border: 1px solid #d7dde7; border-radius: 14px; background: #fff; color: #172033; font-family: Inter, ui-sans-serif, system-ui, sans-serif; box-shadow: 0 18px 56px rgba(15, 23, 42, .22); }
  .header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #e7eaf0; background: #f7f9fc; }
  .product { font-size: 13px; line-height: 20px; }
  .body { display: grid; min-height: 0; overflow-y: auto; overscroll-behavior: contain; gap: 12px; padding: 14px; }
  .eyebrow { margin: 0; color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .steps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
  .steps li { border-radius: 7px; background: #f1f5f9; padding: 6px 8px; color: #64748b; font-size: 11px; line-height: 16px; }
  .steps li.active { background: #e0ecff; color: #16488f; font-weight: 700; }
  .steps li.done { background: #dcfce7; color: #166534; }
  .title { margin: 0; font-size: 17px; line-height: 24px; }
  .description, .checked-at, .privacy, .feedback { margin: 0; font-size: 12px; line-height: 19px; }
  .description, .checked-at { color: #526174; }
  .protocols { display: grid; gap: 6px; border: 1px solid #d7dde7; border-radius: 8px; padding: 10px; }
  .protocol-title { font-size: 12px; }
  .privacy { border-radius: 8px; background: #fff7ed; padding: 9px 10px; color: #7c2d12; }
  .checklist { display: grid; gap: 5px; margin: 0; padding-left: 19px; font-size: 12px; line-height: 18px; }
  .feedback { border-radius: 7px; background: #ecfdf5; padding: 7px 9px; color: #065f46; }
  .feedback[data-failed='true'] { background: #fef2f2; color: #991b1b; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; padding-top: 2px; }
  button { min-height: 34px; cursor: pointer; border: 1px solid transparent; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12px; font-weight: 650; transition: background-color .15s ease, border-color .15s ease, transform .15s ease; }
  button:hover { transform: translateY(-1px); }
  button:focus-visible { outline: 3px solid rgba(37, 99, 235, .32); outline-offset: 2px; }
  button:disabled { cursor: wait; opacity: .55; transform: none; }
  .primary { background: #2563eb; color: #fff; }
  .primary:hover { background: #1d4ed8; }
  .secondary, .icon-button { border-color: #cbd5e1; background: #fff; color: #1e293b; }
  .secondary:hover, .icon-button:hover { background: #f1f5f9; }
  .icon-button { display: grid; width: 32px; min-height: 32px; place-items: center; padding: 0; font-size: 18px; }
  [hidden] { display: none !important; }
  @media (prefers-color-scheme: dark) {
    .panel { border-color: #334155; background: #111827; color: #f8fafc; box-shadow: 0 18px 56px rgba(0, 0, 0, .5); }
    .header { border-color: #334155; background: #172033; }
    .protocols { border-color: #334155; }
    .eyebrow, .description, .checked-at { color: #a5b4c7; }
    .steps li { background: #1e293b; color: #a5b4c7; }
    .steps li.active { background: #17335f; color: #bfdbfe; }
    .steps li.done { background: #143b2a; color: #bbf7d0; }
    .privacy { background: #422006; color: #fed7aa; }
    .feedback { background: #063b2d; color: #a7f3d0; }
    .feedback[data-failed='true'] { background: #450a0a; color: #fecaca; }
    .secondary, .icon-button { border-color: #475569; background: #172033; color: #f8fafc; }
    .secondary:hover, .icon-button:hover { background: #253248; }
  }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;
