import { browser } from 'wxt/browser';
import { IOP_API_ORIGIN, PUBLIC_AUTH_CALLBACK } from '@one-vegetable/core/alibaba-iop';
import {
  confirmAction,
  transientMessage,
  el,
  errorText,
  footer,
  languageButton,
  t
} from '../../../auth-pages/src/dom';
import type { IopAuthorizationSummary } from '../../lib/iop-authorization';
import { IOP_VAULT_KEY, TOP_VAULT_KEY } from '../../lib/iop-authorization-storage';
import { authorizationStatusPollDelay } from '../../lib/authorization-status';
import { parseTopApplicationBackup } from '../../lib/top-application-backup';
import {
  IOP_APPLICATION_READER_ORIGINS,
  TOP_APPLICATION_READER_ORIGINS
} from '../../lib/iop-authorization-storage';
import {
  authorizationJsonExample,
  parseAuthorizationJson,
  highlightAuthorizationJson
} from '../../lib/authorization-json-editor';
import '../../../auth-pages/src/style.css';
import './style.css';
import { setupAuthorizationLayout, updateAuthorizationLayout } from './layout';

type Protocol = 'top' | 'iop';
let protocol: Protocol = new URL(location.href).searchParams.get('protocol') === 'top' ? 'top' : 'iop';
el('#app').innerHTML =
  `<header><div><small id="protocolBadge"></small><h1 id="title"></h1><p class="muted" data-text="toolGuide"></p></div><button id="language" data-text="language"></button></header>
<ol class="connection-steps" aria-label="${t('connectionSteps')}"><li id="connectStep" data-text="connectStep"></li><li id="approveStep" data-text="approveStep"></li><li id="useStep" data-text="useStep"></li></ol>
<section aria-labelledby="status"><h2 id="status" role="status" data-text="busy"></h2><p id="nextStep" class="muted"></p>
<form id="unlockForm" hidden><label for="unlockPassphrase" data-text="passphrase"></label><input id="unlockPassphrase" type="password" autocomplete="current-password" required maxlength="256" data-feedback-redact><div class="actions"><button id="unlock" type="submit" class="primary" data-text="unlock"></button></div></form>
<div class="actions"><button id="retryStatus" data-text="retryStatus" hidden></button><button id="discover" class="primary" data-text="discoverApplication" disabled></button><button id="applyWorkbench" class="primary" data-text="applyWorkbench" hidden></button><button id="save" class="primary" data-text="save" hidden></button><button id="cancel" data-text="cancel" hidden></button><a id="back" class="button" data-text="returnSettings"></a></div>
<details id="manual" hidden><summary data-text="callbackFallback"></summary><label for="callbackPaste" data-text="paste"></label><input id="callbackPaste" type="password" autocomplete="off" data-feedback-redact><button id="receive" data-text="receive"></button></details>
</section><p id="notice" role="status"></p><p id="error" role="alert"></p>
<section id="alternatives"><h2 data-text="otherWays"></h2><div class="actions"><button id="manualEntry" data-text="manualAuthorization" disabled></button><button type="button" id="chooseFile" disabled></button><input id="file" type="file" accept="application/json,.json" hidden></div></section>
<section id="manualSection" hidden><form id="form"><fieldset id="fields"><div class="grid"><div><label for="appName" data-text="appName"></label><input id="appName" required maxlength="256"></div><div><label for="appKey" data-text="appKey"></label><input id="appKey" required maxlength="256" autocomplete="off"></div></div><label for="appSecret" data-text="appSecret"></label><input id="appSecret" type="password" autocomplete="off" required maxlength="4096" data-feedback-redact><label for="callback" data-text="callback"></label><input id="callback" type="url" required><input id="passphrase" type="hidden" value=""><label><input id="registered" type="checkbox" required><span data-text="registered"></span></label><div class="actions"><button type="submit" id="start" class="primary" data-text="start"></button></div></fieldset></form></section>
<section id="authorization-summary-panel"><h2 data-text="authorizationDetails"></h2><dl><dt data-text="appName"></dt><dd id="name">—</dd><dt>App Key</dt><dd id="key">—</dd><dt data-text="expires"></dt><dd id="expires">—</dd><dt data-text="refreshExpires"></dt><dd id="refreshExpires">—</dd></dl><p id="boundary" class="muted"></p></section>${footer}`;
el('.connection-steps').insertAdjacentHTML(
  'beforebegin',
  '<section id="protectionSection" hidden><h2 data-text="localProtection"></h2><p class="muted" data-text="optionalProtectionHelp"></p><form id="protectionForm"><label for="sharedPassphrase" id="sharedPassphraseLabel"></label><input id="sharedPassphrase" type="password" autocomplete="current-password" maxlength="256" data-feedback-redact><div class="actions"><button type="submit" class="primary" data-text="continueAuthorization"></button></div></form></section>'
);
el('footer').insertAdjacentHTML(
  'beforebegin',
  `<section><details id="advancedJson"><summary data-text="advancedJson"></summary><p class="muted" data-text="jsonHelp"></p><label for="credentialJson" data-text="jsonLabel"></label><div class="authorization-json-editor" data-feedback-redact><pre aria-hidden="true"><code id="jsonHighlight"></code></pre><textarea id="credentialJson" maxlength="65536" spellcheck="false" autocomplete="off" autocapitalize="off" data-feedback-redact></textarea></div><div class="actions"><button type="button" id="importJson" data-text="importJson"></button></div></details></section>`
);
el('#alternatives').insertAdjacentHTML(
  'beforebegin',
  '<section id="topEntries" hidden><div class="actions"><button id="topReauthorize" class="primary" data-text="reauthorize"></button><button id="topImport" data-text="useExistingAuthorization"></button></div><p class="muted" data-text="topEntryHelp"></p></section>'
);
el('#form').insertAdjacentHTML(
  'beforebegin',
  `<h2 data-text="manualApplication"></h2><div id="topApplicationBackup" hidden><div class="actions"><button id="chooseApplicationFile" type="button" class="primary" data-text="readApplicationBackup"></button><input id="applicationFile" type="file" accept="application/json,.json" hidden></div><p class="muted" data-text="topApplicationHelp"></p></div><details id="topManualGuide" class="authorization-manual-guide" hidden><summary data-text="topManualTitle"></summary><ol><li data-text="topManualExisting"></li><li data-text="topManualPrepare"></li><li data-text="topManualApprove"></li><li data-text="topManualFinish"></li></ol><p class="warning" data-text="topManualUnavailable"></p><a href="https://developer.alibaba.com/docs/doc.htm?articleId=118846&amp;docType=1&amp;treeId=456" target="_blank" rel="noopener noreferrer" data-text="topManualDocumentation"></a></details>`
);
el('#nextStep').insertAdjacentHTML(
  'afterend',
  '<div id="workbenchStep" class="workbench-next-action" hidden><h3 data-text="workbenchNextTitle"></h3><p class="muted" data-text="workbenchNextHelp"></p><div class="actions" id="workbenchAction"><div id="authorization-ready-actions"><button id="authorizeOtherProtocol" type="button" class="authorization-secondary" hidden></button></div></div></div>'
);
el('#authorization-ready-actions').prepend(el('#applyWorkbench'));
el('#workbenchStep').insertAdjacentHTML(
  'beforeend',
  '<button id="restartConnection" type="button" class="authorization-back" data-text="reauthorize" hidden></button>'
);
setupAuthorizationLayout();
el<HTMLAnchorElement>('#back').href = browser.runtime.getURL('/options.html#/settings');
el<HTMLInputElement>('#callback').value = protocol === 'iop' ? PUBLIC_AUTH_CALLBACK : '';
languageButton();
let busy = false;
let summary: IopAuthorizationSummary | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let statusSequence = 0;
let pageClosed = false;
let importGeneration = 0;
const value = (id: string): string => el<HTMLInputElement>(`#${id}`).value;
const tokenOrigin = (): string => (protocol === 'iop' ? IOP_API_ORIGIN : 'https://oauth.alibaba.com');
let jsonExample = '';
let statusUnavailable = false;
let protectionState = '';
let deviceProtected = false;
let protectionReady = false;
let discoverAfterProtection = false;
let topFlow: 'reauthorize' | 'import' | null = null;
let alternativeRequested = false;
function collapseEntryPanels(): void {
  alternativeRequested = false;
  topFlow = null;
  el('#manualSection').hidden = true;
  el<HTMLDetailsElement>('#advancedJson').open = false;
  el<HTMLDetailsElement>('#authorization-other-methods').open = false;
  el('#authorization-return-choices').hidden = true;
  document.body.dataset.authorizationEditing = '';
}
function showManualApplication(): void {
  el('#manualSection').hidden = false;
  el('#authorization-return-choices').hidden = false;
  el<HTMLDetailsElement>('#authorization-other-methods').open = false;
  document.body.dataset.authorizationEditing = 'manual';
}
function resetJsonEditor(): void {
  jsonExample = authorizationJsonExample(protocol);
  el<HTMLTextAreaElement>('#credentialJson').value = jsonExample;
  highlightAuthorizationJson(el('#jsonHighlight'), jsonExample);
}
function showError(error: unknown): void {
  transientMessage(errorText(error instanceof Error ? error.message : 'AUTH_ACTION_FAILED'), true);
  if (!summary) {
    statusUnavailable = true;
    render();
  }
}
async function request(action: string, payload: unknown = {}, selected = protocol): Promise<unknown> {
  const toolTab =
    action === 'start' || action === 'reauthorize'
      ? await browser.tabs.getCurrent().catch(() => undefined)
      : undefined;
  const result: unknown = await browser.runtime.sendMessage({
    kind: 'iop-authorization-request',
    requestId: crypto.randomUUID(),
    protocol: selected,
    ...(toolTab?.id !== undefined ? { toolTabId: toolTab.id } : {}),
    action,
    payload
  });
  if (!isRecord(result) || result.ok !== true)
    throw new Error(
      isRecord(result) && isRecord(result.error) && typeof result.error.code === 'string'
        ? result.error.code
        : 'AUTH_ACTION_FAILED'
    );
  return result.data;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function render(): void {
  el('#protectionSection').hidden = protectionReady || protectionState === '';
  el('#sharedPassphraseLabel').textContent = t(
    protectionState === 'locked' && !deviceProtected ? 'passphrase' : 'optionalPassphrase'
  );
  const protectionInput = el<HTMLInputElement>('#sharedPassphrase');
  protectionInput.hidden = protectionState === 'locked' && deviceProtected;
  protectionInput.required = protectionState === 'locked' && !deviceProtected;
  protectionInput.minLength = 6;
  protectionInput.disabled = busy;
  for (const close of document.querySelectorAll('.authorization-toast-close'))
    close.setAttribute('aria-label', t('dismissNotification'));
  el('#protocolBadge').textContent = `oneVegetable · ${protocol.toUpperCase()}`;
  el('.connection-steps').setAttribute('aria-label', t('connectionSteps'));
  el('#title').textContent = t(protocol === 'top' ? 'toolTitleTop' : 'toolTitleIop');
  document.title = t(protocol === 'top' ? 'toolTitleTop' : 'toolTitleIop');
  el('#boundary').textContent = t('authorizationSecretPrivacy');
  if (protocol === 'top') el('#discover').hidden = true;
  el('#topManualGuide').hidden = protocol !== 'top';
  el('#topApplicationBackup').hidden = protocol !== 'top';
  el<HTMLInputElement>('#appName').required = protocol !== 'top';
  el<HTMLButtonElement>('#discover').disabled =
    !protectionReady || busy || summary?.state === 'waiting' || summary?.state === 'busy';
  el<HTMLButtonElement>('#manualEntry').disabled = el<HTMLButtonElement>('#discover').disabled;
  el<HTMLButtonElement>('#chooseFile').disabled = !summary || el<HTMLButtonElement>('#discover').disabled;
  el('#chooseFile').textContent = t(protocol === 'top' ? 'importTop' : 'import');
  const waiting = summary?.state === 'waiting' || summary?.state === 'busy';
  const top = protocol === 'top';
  const ready = summary?.state === 'ready';
  updateAuthorizationLayout(
    protocol,
    ready,
    waiting,
    alternativeRequested,
    !protectionReady && protectionState !== ''
  );
  el('#workbenchStep').hidden = !ready;
  el('#restartConnection').hidden = !ready;
  el<HTMLButtonElement>('#restartConnection').disabled = busy || !protectionReady || !summary?.canReauthorize;
  el('#nextStep').hidden = ready;
  el('#authorizeOtherProtocol').hidden = !ready || !protectionReady;
  el('#authorizeOtherProtocol').textContent = t(top ? 'authorizeOtherIop' : 'authorizeOtherTop');
  el<HTMLButtonElement>('#authorizeOtherProtocol').disabled =
    busy || !protectionReady || !ready || !!summary?.canSave;
  el('#topEntries').hidden = !top || !protectionReady || !summary || waiting || ready;
  for (const id of ['topReauthorize', 'topImport', 'chooseApplicationFile'])
    el<HTMLButtonElement>(`#${id}`).disabled = busy || !protectionReady || !summary || waiting;
  el('#manualEntry').hidden = top;
  el('#alternatives').hidden = waiting || (ready && !alternativeRequested) || (top && topFlow !== 'import');
  const jsonSection = el('#advancedJson').parentElement;
  if (jsonSection)
    jsonSection.hidden = waiting || (ready && !alternativeRequested) || (top && topFlow !== 'import');
  el('#alternatives h2').textContent = t(top ? 'useExistingAuthorization' : 'otherWays');
  if (top && topFlow !== 'reauthorize') el('#manualSection').hidden = true;
  el('#retryStatus').hidden = !statusUnavailable;
  el<HTMLFieldSetElement>('#fields').disabled = !protectionReady || !summary || busy || waiting;
  el<HTMLTextAreaElement>('#credentialJson').disabled = !summary || busy || waiting;
  el<HTMLButtonElement>('#importJson').disabled = !protectionReady || !summary || busy || waiting;
  if (!summary) {
    el('#status').textContent = t(statusUnavailable ? 'statusUnavailable' : 'busy');
    el('#nextStep').textContent = '';
    for (const id of ['applyWorkbench', 'save', 'unlock']) el<HTMLButtonElement>(`#${id}`).disabled = true;
    for (const id of ['applyWorkbench', 'save', 'unlockForm', 'manual', 'cancel']) el(`#${id}`).hidden = true;
    el<HTMLButtonElement>('#discover').disabled = true;
    el<HTMLButtonElement>('#manualEntry').disabled = true;
    return;
  }
  el('#status').textContent = t(busy ? 'busy' : summary.state);
  el('#nextStep').textContent = t(
    summary.state === 'ready'
      ? 'nextReady'
      : summary.state === 'locked'
        ? 'nextLocked'
        : summary.state === 'waiting' || summary.state === 'busy'
          ? 'nextWaiting'
          : summary.state === 'unknown'
            ? 'nextUnknown'
            : protocol === 'top'
              ? 'nextEmptyTop'
              : 'nextEmptyIop'
  );
  const step = summary.state === 'ready' ? 'useStep' : waiting ? 'approveStep' : 'connectStep';
  for (const id of ['connectStep', 'approveStep', 'useStep']) {
    if (id === step) el(`#${id}`).setAttribute('aria-current', 'step');
    else el(`#${id}`).removeAttribute('aria-current');
  }
  el('#discover').hidden = top || !['empty', 'unknown'].includes(summary.state);
  el('#unlockForm').hidden = summary.state !== 'locked';
  el<HTMLInputElement>('#unlockPassphrase').hidden = deviceProtected;
  el<HTMLInputElement>('#unlockPassphrase').required = !deviceProtected;
  el<HTMLButtonElement>('#unlock').disabled = busy;
  el<HTMLInputElement>('#unlockPassphrase').disabled = busy;
  el('#applyWorkbench').hidden = summary.state !== 'ready';
  el('#name').textContent = summary.appName ?? '—';
  el('#key').textContent = summary.appKeySuffix ? `…${summary.appKeySuffix}` : '—';
  const date = (text: string | null): string =>
    text ? new Date(text).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : t('unknownDate');
  el('#expires').textContent = date(summary.expiresAtUtc);
  el('#refreshExpires').textContent = date(summary.refreshExpiresAtUtc);
  el<HTMLButtonElement>('#applyWorkbench').disabled =
    busy || !protectionReady || summary.state !== 'ready' || summary.canSave;
  el<HTMLButtonElement>('#save').disabled = busy;
  el('#manual').hidden = summary.state !== 'waiting';
  if (waiting || summary.state === 'locked') {
    el('#manualSection').hidden = true;
    el('#authorization-return-choices').hidden = true;
    document.body.dataset.authorizationEditing = '';
  }
  el('#cancel').hidden = summary.state !== 'waiting';
  el('#save').hidden = !summary.canSave;
}
async function update(): Promise<void> {
  const sequence = ++statusSequence;
  clearTimeout(timer);
  const selected = protocol;
  const protection = await request('protection-status', {}, selected);
  if (selected !== protocol || sequence !== statusSequence || pageClosed) return;
  if (!isRecord(protection) || typeof protection.state !== 'string') throw new Error('AUTH_ACTION_FAILED');
  protectionState = protection.state;
  deviceProtected = protection.deviceProtected === true;
  protectionReady = protection.state === 'unlocked';
  const data = await request('status', {}, selected);
  // pagehide also advances statusSequence, invalidating this second awaited read.
  if (selected !== protocol || sequence !== statusSequence) return;
  if (
    !isRecord(data) ||
    typeof data.state !== 'string' ||
    !['empty', 'locked', 'ready', 'waiting', 'busy', 'unknown'].includes(data.state)
  )
    throw new Error('AUTH_ACTION_FAILED');
  const previousError = summary?.errorCode;
  const wasWaiting = summary?.state === 'waiting' || summary?.state === 'busy';
  if (data.state === 'empty' && summary?.state !== 'empty') {
    importGeneration += 1;
    collapseEntryPanels();
    for (const id of ['appName', 'appKey', 'appSecret', 'passphrase', 'unlockPassphrase', 'callbackPaste'])
      el<HTMLInputElement>(`#${id}`).value = '';
    el<HTMLInputElement>('#callback').value = protocol === 'iop' ? PUBLIC_AUTH_CALLBACK : '';
    el<HTMLInputElement>('#registered').checked = false;
    resetJsonEditor();
  }
  statusUnavailable = false;
  if (data.state === 'ready' && summary?.state !== 'ready') {
    collapseEntryPanels();
  }
  summary = data as unknown as IopAuthorizationSummary;
  if (summary.errorCode && summary.errorCode !== previousError) showError(new Error(summary.errorCode));
  else if (wasWaiting && summary.state === 'ready') transientMessage(t('saved'));
  render();
  scheduleStatusUpdate();
}
function scheduleStatusUpdate(): void {
  clearTimeout(timer);
  const delay = authorizationStatusPollDelay(summary?.state, document.visibilityState === 'visible');
  if (!pageClosed && delay !== null)
    timer = setTimeout(() => {
      void update().catch(showError);
    }, delay);
}
async function run(action: string, payload: unknown = {}): Promise<boolean> {
  if (busy) return false;
  let succeeded = false;
  busy = true;
  transientMessage('', true);
  transientMessage('');
  render();
  try {
    await request(action, payload);
    succeeded = true;
    if (action === 'import') collapseEntryPanels();
    if (!['start', 'reauthorize', 'callback', 'cancel'].includes(action))
      transientMessage(t(action === 'apply-to-workbench' ? 'workbenchApplied' : 'saved'));
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    await update().catch(showError);
  }
  return succeeded;
}
function withHostPermission(
  action: 'start' | 'reauthorize' | 'apply-to-workbench',
  payload: unknown = {},
  callbackUrl?: string
): void {
  let origins: string[];
  const selected = protocol;
  try {
    const origin = callbackUrl ? new URL(callbackUrl).origin : null;
    origins =
      action === 'apply-to-workbench'
        ? [`${protocol === 'iop' ? IOP_API_ORIGIN : 'https://eco.taobao.com'}/*`]
        : [`${tokenOrigin()}/*`, ...(origin ? [`${origin}/*`] : [])];
  } catch {
    showError(new Error('CALLBACK_INVALID'));
    return;
  }
  void browser.permissions
    .request({ origins })
    .then(async (allowed) => {
      if (selected !== protocol) {
        showError(new Error('AUTH_PROTOCOL_CHANGED'));
        return;
      }
      if (!allowed) {
        showError(new Error('AUTH_PERMISSION_REQUIRED'));
        return;
      }
      const completed = await run(action, payload);
      if (completed && action === 'apply-to-workbench' && selected === protocol)
        location.assign(browser.runtime.getURL('/options.html#/dashboard'));
    })
    .catch(showError);
}

function startDiscoveredApplication(passphrase = ''): void {
  const selected = protocol;
  const payload = {
    appName: value('appName'),
    appKey: value('appKey'),
    appSecret: value('appSecret'),
    callbackUrl: value('callback'),
    passphrase
  };
  const origins = [`${tokenOrigin()}/*`, `${new URL(payload.callbackUrl).origin}/*`];
  const start = (): void => {
    if (selected !== protocol) {
      showError(new Error('AUTH_PROTOCOL_CHANGED'));
      return;
    }
    el<HTMLInputElement>('#appSecret').value = '';
    el<HTMLInputElement>('#passphrase').value = '';
    withHostPermission('start', payload, payload.callbackUrl);
  };
  if (passphrase)
    start(); // The passphrase modal's final click is a user gesture.
  else
    void browser.permissions
      .contains({ origins })
      .then(async (allowed) => {
        if (selected !== protocol) {
          showError(new Error('AUTH_PROTOCOL_CHANGED'));
          return;
        }
        if (allowed) {
          el<HTMLInputElement>('#appSecret').value = '';
          await run('start', payload);
        } else confirmAction(t('allowCallbackPermission'), start);
      })
      .catch(showError);
}

async function discoverApplication(): Promise<void> {
  if (!protectionReady || busy || summary?.state === 'waiting' || summary?.state === 'busy') return;
  busy = true;
  transientMessage('', true);
  transientMessage(t('discoveringApplication'));
  render();
  try {
    const data = await request('discover-application');
    if (
      !isRecord(data) ||
      !['appName', 'appKey', 'appSecret', 'callbackUrl'].every(
        (key) => typeof data[key] === 'string' && data[key] !== ''
      )
    )
      throw new Error('IOP_APP_READ_FAILED');
    for (const [id, key] of [
      ['appName', 'appName'],
      ['appKey', 'appKey'],
      ['appSecret', 'appSecret'],
      ['callback', 'callbackUrl']
    ] as const)
      el<HTMLInputElement>(`#${id}`).value = data[key] as string;
    // Return to the tool without closing/navigating the merchant's Alibaba tab.
    const tab = await browser.tabs.getCurrent();
    if (tab?.id !== undefined) await browser.tabs.update(tab.id, { active: true });
    transientMessage(t('applicationRead'));
    busy = false;
    await update();
    startDiscoveredApplication();
  } catch (error) {
    if (protocol === 'top') el<HTMLDetailsElement>('#topManualGuide').open = true;
    showError(error);
  } finally {
    busy = false;
    render();
  }
}

el<HTMLFormElement>('#protectionForm').onsubmit = (event) => {
  event.preventDefault();
  const input = el<HTMLInputElement>('#sharedPassphrase');
  const passphrase = input.value;
  input.value = '';
  void run('prepare-protection', { passphrase }).then((saved) => {
    if (saved && protectionReady && discoverAfterProtection) {
      discoverAfterProtection = false;
      void discoverApplication();
    }
  });
};
el('#manualEntry').onclick = () => {
  alternativeRequested = true;
  showManualApplication();
  if (protocol === 'top') el<HTMLDetailsElement>('#topManualGuide').open = true;
  el('#form').scrollIntoView({ block: 'center' });
  el('#appName').focus({ preventScroll: true });
};
el('#topReauthorize').onclick = () => {
  if (busy || !protectionReady || !summary) return;
  importGeneration += 1;
  topFlow = 'reauthorize';
  render();
  if (summary.canReauthorize) {
    restartConnection();
    return;
  }
  showManualApplication();
  el('#form').scrollIntoView({ block: 'center' });
  el('#appKey').focus({ preventScroll: true });
};
el('#topImport').onclick = () => {
  if (busy || !protectionReady) return;
  importGeneration += 1;
  topFlow = 'import';
  alternativeRequested = true;
  render();
  el<HTMLDetailsElement>('#authorization-other-methods').open = true;
  el<HTMLDetailsElement>('#advancedJson').open = true;
  el('#alternatives').scrollIntoView({ block: 'start' });
};
el('#authorization-return-choices').onclick = () => {
  collapseEntryPanels();
  render();
};
el('#chooseApplicationFile').onclick = () => {
  el<HTMLInputElement>('#applicationFile').click();
};
el<HTMLInputElement>('#applicationFile').onchange = (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || busy || !protectionReady || protocol !== 'top' || topFlow !== 'reauthorize') return;
  const generation = ++importGeneration;
  if (file.size > 65_536) {
    showError(new Error('AUTH_INPUT_INVALID'));
    return;
  }
  void file
    .text()
    .then((text) => {
      if (generation !== importGeneration || protocol !== 'top' || pageClosed) return;
      const application = parseTopApplicationBackup(text);
      for (const [id, key] of [
        ['appName', 'appName'],
        ['appKey', 'appKey'],
        ['appSecret', 'appSecret'],
        ['callback', 'callbackUrl']
      ] as const)
        el<HTMLInputElement>(`#${id}`).value = application[key];
      // App metadata only: never import or reuse the backup's access/refresh token.
      transientMessage(t('applicationBackupRead'));
    })
    .catch(showError);
};
el('#retryStatus').onclick = () => {
  statusUnavailable = false;
  render();
  void update().catch(showError);
};
el('#discover').onclick = () => {
  const selected = protocol;
  void browser.permissions
    .request({
      origins: [...(protocol === 'iop' ? IOP_APPLICATION_READER_ORIGINS : TOP_APPLICATION_READER_ORIGINS)]
    })
    .then((allowed) => {
      if (selected !== protocol) {
        showError(new Error('AUTH_PROTOCOL_CHANGED'));
        return;
      }
      if (allowed) void discoverApplication();
      else showError(new Error('AUTH_PERMISSION_REQUIRED'));
    })
    .catch(showError);
};
el<HTMLFormElement>('#form').onsubmit = (event) => {
  event.preventDefault();
  const payload = {
    appName: value('appName').trim() || (protocol === 'top' ? 'TOP application' : ''),
    appKey: value('appKey'),
    appSecret: value('appSecret'),
    callbackUrl: value('callback'),
    passphrase: value('passphrase')
  };
  el<HTMLInputElement>('#appSecret').value = '';
  el<HTMLInputElement>('#passphrase').value = '';
  withHostPermission('start', payload, payload.callbackUrl);
};
el<HTMLFormElement>('#unlockForm').onsubmit = (event) => {
  event.preventDefault();
  const passphrase = value('unlockPassphrase');
  el<HTMLInputElement>('#unlockPassphrase').value = '';
  void run('unlock', { passphrase });
};
el('#receive').onclick = () => {
  const url = value('callbackPaste');
  el<HTMLInputElement>('#callbackPaste').value = '';
  void run('callback', { url });
};
el('#applyWorkbench').onclick = () => {
  if (!busy && protectionReady && summary?.state === 'ready') {
    const selected = protocol;
    confirmAction(t('confirmApplyWorkbench'), () => {
      if (selected !== protocol || busy) return;
      // Keep the host-permission request in the confirmation click's user gesture.
      withHostPermission('apply-to-workbench');
    });
  }
};
for (const action of ['cancel', 'save'])
  el(`#${action}`).onclick = () => {
    void run(action);
  };
function restartConnection(): void {
  if (busy || !protectionReady || !summary?.canReauthorize) return;
  const selected = protocol;
  confirmAction(t('confirmReauthorize'), () => {
    if (selected !== protocol || busy || !protectionReady || !summary?.canReauthorize) return;
    withHostPermission('reauthorize', {}, summary.callbackUrl ?? undefined);
  });
}
el('#restartConnection').onclick = restartConnection;
el('#chooseFile').onclick = () => {
  el<HTMLInputElement>('#file').click();
};
const jsonInput = el<HTMLTextAreaElement>('#credentialJson');
jsonInput.oninput = () => {
  highlightAuthorizationJson(el('#jsonHighlight'), jsonInput.value);
};
jsonInput.onscroll = () => {
  const preview = el('#jsonHighlight').parentElement;
  if (preview) {
    preview.scrollTop = jsonInput.scrollTop;
    preview.scrollLeft = jsonInput.scrollLeft;
  }
};
jsonInput.onfocus = () => {
  if (jsonInput.value === jsonExample) jsonInput.select();
};
jsonInput.onpointerup = () => {
  if (jsonInput.value === jsonExample) jsonInput.select();
};
el<HTMLDetailsElement>('#advancedJson').ontoggle = () => {
  if (el<HTMLDetailsElement>('#advancedJson').open && jsonInput.value === jsonExample) {
    jsonInput.focus();
    jsonInput.select();
  }
};
function importBundleText(text: string, selected = protocol): void {
  if (busy) return;
  if (selected !== protocol) {
    showError(new Error('AUTH_PROTOCOL_CHANGED'));
    return;
  }
  let bundle;
  try {
    bundle = parseAuthorizationJson(text, selected);
  } catch (error) {
    showError(error);
    return;
  }
  confirmAction(t('importConfirm'), () => {
    const perform = (passphrase: string): void => {
      if (selected !== protocol) {
        showError(new Error('AUTH_PROTOCOL_CHANGED'));
        return;
      }
      el<HTMLInputElement>('#passphrase').value = '';
      void run('import', { bundle, passphrase }).then((saved) => {
        // Never retain real credential JSON in the editor after an import attempt.
        if (saved) resetJsonEditor();
      });
    };
    const passphrase = value('passphrase');
    perform(passphrase);
  });
}
el('#importJson').onclick = () => {
  importGeneration += 1;
  importBundleText(jsonInput.value);
};
el<HTMLInputElement>('#file').onchange = (event) => {
  const generation = ++importGeneration;
  const file = (event.target as HTMLInputElement).files?.[0];
  el<HTMLInputElement>('#file').value = '';
  if (!file || busy) return;
  if (file.size > 65_536) {
    showError(new Error('AUTH_INPUT_INVALID'));
    return;
  }
  const selected = protocol;
  void file
    .text()
    .then((text) => {
      if (generation !== importGeneration) return;
      importBundleText(text, selected);
    })
    .catch(() => {
      if (generation !== importGeneration) return;
      showError(new Error('AUTH_INPUT_INVALID'));
    });
};
function switchProtocol(selected: Protocol): void {
  if (selected === protocol || busy || !protectionReady || summary?.state !== 'ready' || summary.canSave)
    return;
  const previousProtocol = protocol;
  const apply = (): void => {
    if (
      protocol !== previousProtocol ||
      busy ||
      !protectionReady ||
      summary?.state !== 'ready' ||
      summary.canSave
    )
      return;
    importGeneration += 1;
    statusSequence += 1;
    clearTimeout(timer);
    protocol = selected;
    history.replaceState(null, '', location.pathname + (selected === 'top' ? '?protocol=top' : ''));
    summary = null;
    statusUnavailable = false;
    discoverAfterProtection = false;
    protectionReady = false;
    protectionState = '';
    deviceProtected = false;
    collapseEntryPanels();
    for (const id of ['appName', 'appKey', 'appSecret', 'passphrase', 'unlockPassphrase', 'callbackPaste'])
      el<HTMLInputElement>(`#${id}`).value = '';
    el<HTMLInputElement>('#registered').checked = false;
    el<HTMLInputElement>('#callback').value = selected === 'iop' ? PUBLIC_AUTH_CALLBACK : '';
    resetJsonEditor();
    transientMessage('', true);
    transientMessage('');
    render();
    // Preparation only: read the other local profile. Never save, discover, request
    // host permissions or launch OAuth here; those require their own user action.
    void update().catch(showError);
  };
  if (
    ['appName', 'appKey', 'appSecret', 'passphrase'].some((id) => value(id) !== '') ||
    (jsonInput.value.trim() !== '' && jsonInput.value !== jsonExample)
  )
    confirmAction(t('switchProtocolConfirm'), apply);
  else apply();
}
el('#authorizeOtherProtocol').onclick = () => {
  switchProtocol(protocol === 'top' ? 'iop' : 'top');
};
el('#language').addEventListener('click', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void update().catch(showError);
  else scheduleStatusUpdate();
});
browser.storage.onChanged.addListener((changes, areaName) => {
  const key = protocol === 'top' ? TOP_VAULT_KEY : IOP_VAULT_KEY;
  if (areaName === 'local' && Object.hasOwn(changes, key) && !pageClosed && !busy)
    void update().catch(showError);
});
window.addEventListener('focus', () => {
  if (!pageClosed && document.visibilityState === 'visible') void update().catch(showError);
});
window.addEventListener('pageshow', () => {
  if (!pageClosed) return;
  pageClosed = false;
  void update().catch(showError);
});
window.addEventListener('pagehide', () => {
  pageClosed = true;
  statusSequence += 1;
  importGeneration += 1;
  clearTimeout(timer);
  jsonInput.value = '';
  highlightAuthorizationJson(el('#jsonHighlight'), '');
  for (const id of ['appSecret', 'passphrase', 'unlockPassphrase', 'sharedPassphrase', 'callbackPaste'])
    el<HTMLInputElement>(`#${id}`).value = '';
});
transientMessage('');
transientMessage('', true);
resetJsonEditor();
render();
void update().catch(showError);
if (new URL(location.href).searchParams.get('discover') === '1') {
  const selected = protocol;
  // Remove the startup action immediately: reloads must not repeat discovery/authorization.
  history.replaceState(null, '', location.pathname + (protocol === 'top' ? '?protocol=top' : ''));
  if (protocol === 'iop')
    void browser.permissions
      .contains({
        origins: [...IOP_APPLICATION_READER_ORIGINS]
      })
      .then(async (allowed) => {
        if (selected !== protocol) return;
        await update();
        if (allowed && protectionReady) await discoverApplication();
        else if (allowed) discoverAfterProtection = true;
        else transientMessage(t('discoverPermission'));
      })
      .catch(showError);
}
