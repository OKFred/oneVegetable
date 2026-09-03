import { browser } from 'wxt/browser';

import type {
  AlibabaCredentialAcquisitionState,
  AlibabaCredentialPrerequisiteState,
  ExtensionAlibabaCredentialAcquisitionOperation,
  ExtensionAlibabaCredentialAcquisitionRequest,
  ExtensionAlibabaCredentialAcquisitionResponse,
  UiLocale
} from '@one-vegetable/core';

const HOST_ID = 'one-vegetable-alibaba-developer-guide';
const PREFERENCES_STORAGE_KEY = 'one-vegetable:preferences:v2';

interface GuideUpdateMessage {
  kind: 'one-vegetable-alibaba-developer-guide-update';
  state: AlibabaCredentialAcquisitionState;
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
    error: '检查失败，请稍后重试。'
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
    error: 'The check failed. Try again later.'
  }
};

export default defineUnlistedScript(() => {
  void mountGuide();
});

async function mountGuide(): Promise<void> {
  if (document.getElementById(HOST_ID)) return;

  const stored = await browser.storage.local.get(PREFERENCES_STORAGE_KEY);
  const preference = isRecord(stored[PREFERENCES_STORAGE_KEY])
    ? stored[PREFERENCES_STORAGE_KEY].uiLocale
    : null;
  const locale: UiLocale =
    preference === 'zh-CN' || preference === 'en-US'
      ? preference
      : navigator.language.toLowerCase().includes('zh')
        ? 'zh-CN'
        : 'en-US';
  const copy = COPY[locale];
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;';
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
  const checklist = element('ul', 'checklist');
  const checkedAt = element('p', 'checked-at');
  const privacy = element('p', 'privacy', copy.privacy);
  const feedback = element('p', 'feedback');
  feedback.hidden = true;
  const actions = element('div', 'actions');
  const locate = button(copy.locate, 'secondary');
  const recheck = button(copy.recheck, 'primary');
  const back = button(copy.back, 'secondary');
  actions.append(locate, recheck, back);
  body.append(progress, steps, title, description, checklist, checkedAt, privacy, feedback, actions);
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
  back.addEventListener('click', () => void browser.runtime.openOptionsPage());

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isRecord(message)) return;
    if (message.kind === 'one-vegetable-alibaba-developer-guide-remove') {
      host.remove();
      return;
    }
    if (message.kind !== 'one-vegetable-alibaba-developer-guide-update') return;
    const update = message as unknown as GuideUpdateMessage;
    render(update.state);
  });

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
      let next = asAcquisitionState(await requestAcquisition('start', { callbackUrl: null }));
      render(next);
      for (let attempt = 0; next.status === 'running' && attempt < 30; attempt += 1) {
        await delay(1_000);
        next = asAcquisitionState(await requestAcquisition('status', { jobId: next.jobId }));
        render(next);
      }
      showFeedback(next.status === 'prerequisite-required' ? copy.descriptions[next.reasonCode] : copy.ready);
    } catch {
      showFeedback(copy.error, true);
    } finally {
      setBusy(false);
    }
  }

  function render(state: AlibabaCredentialAcquisitionState): void {
    if (state.status !== 'prerequisite-required') {
      title.textContent = copy.ready;
      description.textContent = '';
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

const guideStyles = `
  :host { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  .panel { width: min(390px, calc(100vw - 32px)); overflow: hidden; border: 1px solid #d7dde7; border-radius: 14px; background: #fff; color: #172033; box-shadow: 0 18px 56px rgba(15, 23, 42, .22); }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #e7eaf0; background: #f7f9fc; }
  .product { font-size: 13px; line-height: 20px; }
  .body { display: grid; gap: 12px; padding: 14px; }
  .eyebrow { margin: 0; color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .steps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
  .steps li { border-radius: 7px; background: #f1f5f9; padding: 6px 8px; color: #64748b; font-size: 11px; line-height: 16px; }
  .steps li.active { background: #e0ecff; color: #16488f; font-weight: 700; }
  .steps li.done { background: #dcfce7; color: #166534; }
  .title { margin: 0; font-size: 17px; line-height: 24px; }
  .description, .checked-at, .privacy, .feedback { margin: 0; font-size: 12px; line-height: 19px; }
  .description, .checked-at { color: #526174; }
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
