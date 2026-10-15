import { browser } from 'wxt/browser';
import { IOP_API_ORIGIN, PUBLIC_AUTH_CALLBACK } from '@one-vegetable/core/alibaba-iop';
import { parseAlibabaOpenApiCredentialBundle } from '@one-vegetable/core/credential-bundle';
import {
  confirmAction,
  requestAuthorizationPassphrase,
  transientMessage,
  el,
  errorText,
  footer,
  languageButton,
  t
} from '../../../auth-pages/src/dom';
import type { IopAuthorizationSummary } from '../../lib/iop-authorization';
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

type Protocol = 'top' | 'iop';
let protocol: Protocol = new URL(location.href).searchParams.get('protocol') === 'top' ? 'top' : 'iop';
el('#app').innerHTML =
  `<header><div><small id="protocolBadge"></small><h1 id="title"></h1><p class="muted" data-text="toolGuide"></p></div><button id="language" data-text="language"></button></header>
<section><h2 data-text="protocolChoice"></h2><div class="protocol-choices"><button id="protocolIop" data-text="protocolIop"></button><button id="protocolTop" data-text="protocolTop"></button></div><p class="muted" data-text="dualGuide"></p><p id="protocolHelp"></p><a id="center" class="button" href="https://i.alibaba.com/explore/open-api" target="_blank" rel="noopener noreferrer" data-text="center"></a><a id="back" class="button" data-text="returnSettings"></a></section>
<p class="warning" id="boundary"></p><div class="actions"><button id="discover" data-text="discoverApplication"></button></div><p id="notice" role="status"></p><p id="error" role="alert"></p>
<section><h2 id="status"></h2><dl><dt data-text="appName"></dt><dd id="name">—</dd><dt>App Key</dt><dd id="key">—</dd><dt data-text="expires"></dt><dd id="expires">—</dd><dt data-text="refreshExpires"></dt><dd id="refreshExpires">—</dd></dl><div class="actions"><button id="reauthorize" data-text="reauthorize"></button><button id="refresh" data-text="refresh"></button><button id="export" data-text="export"></button><button id="save" data-text="save" hidden></button><button id="lock" data-text="lock"></button><button id="cancel" data-text="cancel" hidden></button><button id="clear"></button></div></section>
<section><form id="form"><fieldset id="fields"><div class="grid"><div><label for="appName" data-text="appName"></label><input id="appName" required maxlength="256"></div><div><label for="appKey" data-text="appKey"></label><input id="appKey" required maxlength="256" autocomplete="off"></div></div><label for="appSecret" data-text="appSecret"></label><input id="appSecret" type="password" autocomplete="off" required maxlength="4096" data-feedback-redact><label for="callback" data-text="callback"></label><input id="callback" type="url" required><label for="passphrase" data-text="passphrase"></label><input id="passphrase" type="password" autocomplete="off" minlength="6" maxlength="256" required data-feedback-redact><label><input id="registered" type="checkbox" required><span data-text="registered"></span></label><div class="actions"><button type="submit" id="start" class="primary" data-text="start"></button><button type="button" id="unlock" data-text="unlock"></button><button type="button" id="chooseFile"></button><input id="file" type="file" accept="application/json,.json" hidden></div></fieldset></form><div id="manual" hidden><label for="callbackPaste" data-text="paste"></label><input id="callbackPaste" type="password" autocomplete="off" data-feedback-redact><button id="receive" data-text="receive"></button></div></section>${footer}`;
el('footer').insertAdjacentHTML(
  'beforebegin',
  `<section><details id="advancedJson"><summary data-text="advancedJson"></summary><p class="muted" data-text="jsonHelp"></p><label for="credentialJson" data-text="jsonLabel"></label><div class="authorization-json-editor" data-feedback-redact><pre aria-hidden="true"><code id="jsonHighlight"></code></pre><textarea id="credentialJson" maxlength="65536" spellcheck="false" autocomplete="off" autocapitalize="off" data-feedback-redact></textarea></div><div class="actions"><button type="button" id="importJson" data-text="importJson"></button></div></details></section>`
);
el<HTMLAnchorElement>('#back').href = browser.runtime.getURL('/options.html#/settings');
el<HTMLInputElement>('#callback').value = protocol === 'iop' ? PUBLIC_AUTH_CALLBACK : '';
languageButton();
let busy = false;
let summary: IopAuthorizationSummary | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const value = (id: string): string => el<HTMLInputElement>(`#${id}`).value;
const tokenOrigin = (): string => (protocol === 'iop' ? IOP_API_ORIGIN : 'https://oauth.alibaba.com');
let jsonExample = '';
function resetJsonEditor(): void {
  jsonExample = authorizationJsonExample(protocol);
  el<HTMLTextAreaElement>('#credentialJson').value = jsonExample;
  highlightAuthorizationJson(el('#jsonHighlight'), jsonExample);
}
function showError(error: unknown): void {
  transientMessage(errorText(error instanceof Error ? error.message : 'AUTH_ACTION_FAILED'), true);
}
async function request(action: string, payload: unknown = {}, selected = protocol): Promise<unknown> {
  const result: unknown = await browser.runtime.sendMessage({
    kind: 'iop-authorization-request',
    requestId: crypto.randomUUID(),
    protocol: selected,
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
  for (const close of document.querySelectorAll('.authorization-toast-close'))
    close.setAttribute('aria-label', t('dismissNotification'));
  el('#protocolBadge').textContent = `oneVegetable · ${protocol.toUpperCase()}`;
  el('#title').textContent = t(protocol === 'top' ? 'toolTitleTop' : 'toolTitleIop');
  el('#protocolHelp').textContent = t(protocol === 'top' ? 'topGuide' : 'step1Text');
  el('#boundary').textContent = t(protocol === 'top' ? 'boundaryTop' : 'boundary');
  el('#center').hidden = protocol === 'top';
  el<HTMLButtonElement>('#discover').disabled =
    busy || summary?.state === 'waiting' || summary?.state === 'busy';
  el('#chooseFile').textContent = t(protocol === 'top' ? 'importTop' : 'import');
  el('#clear').textContent = t(protocol === 'top' ? 'clearTop' : 'clear');
  const waiting = summary?.state === 'waiting' || summary?.state === 'busy';
  for (const selected of ['top', 'iop'] as const) {
    const button = el<HTMLButtonElement>(selected === 'top' ? '#protocolTop' : '#protocolIop');
    button.setAttribute('aria-pressed', String(selected === protocol));
    button.disabled = busy || waiting;
  }
  if (!summary) return;
  el('#status').textContent = t(busy ? 'busy' : summary.state);
  el('#name').textContent = summary.appName ?? '—';
  el('#key').textContent = summary.appKeySuffix ? `…${summary.appKeySuffix}` : '—';
  const date = (text: string | null): string =>
    text ? new Date(text).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : t('unknownDate');
  el('#expires').textContent = date(summary.expiresAtUtc);
  el('#refreshExpires').textContent = date(summary.refreshExpiresAtUtc);
  el<HTMLButtonElement>('#refresh').disabled = busy || !summary.canRefresh;
  el<HTMLButtonElement>('#reauthorize').disabled = busy || !summary.canReauthorize;
  el<HTMLButtonElement>('#export').disabled = busy || summary.state !== 'ready';
  el<HTMLButtonElement>('#lock').disabled = busy || !['ready', 'unknown'].includes(summary.state);
  el<HTMLButtonElement>('#clear').disabled = busy || waiting;
  el<HTMLFieldSetElement>('#fields').disabled = busy || waiting;
  el<HTMLTextAreaElement>('#credentialJson').disabled = busy || waiting;
  el<HTMLButtonElement>('#importJson').disabled = busy || waiting;
  el('#manual').hidden = summary.state !== 'waiting';
  el('#cancel').hidden = summary.state !== 'waiting';
  el('#save').hidden = !summary.canSave;
}
async function update(): Promise<void> {
  const selected = protocol;
  const data = await request('status', {}, selected);
  if (selected !== protocol) return;
  if (
    !isRecord(data) ||
    typeof data.state !== 'string' ||
    !['empty', 'locked', 'ready', 'waiting', 'busy', 'unknown'].includes(data.state)
  )
    throw new Error('AUTH_ACTION_FAILED');
  const previousError = summary?.errorCode;
  summary = data as unknown as IopAuthorizationSummary;
  if (summary.errorCode && summary.errorCode !== previousError) showError(new Error(summary.errorCode));
  render();
  clearTimeout(timer);
  if (summary.state === 'waiting' || summary.state === 'busy')
    timer = setTimeout(() => {
      void update().catch(showError);
    }, 5000);
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
    if (!['start', 'reauthorize', 'callback', 'cancel', 'lock', 'clear'].includes(action))
      transientMessage(t('saved'));
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    await update().catch(showError);
  }
  return succeeded;
}
function withHostPermission(
  action: 'start' | 'refresh' | 'reauthorize',
  payload: unknown = {},
  callbackUrl?: string
): void {
  let origins: string[];
  const selected = protocol;
  try {
    const origin = callbackUrl ? new URL(callbackUrl).origin : null;
    origins = [`${tokenOrigin()}/*`, ...(origin ? [`${origin}/*`] : [])];
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
      await run(action, payload);
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
  if (busy || summary?.state === 'waiting' || summary?.state === 'busy') return;
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
    if (summary?.canReauthorize) startDiscoveredApplication();
    else requestAuthorizationPassphrase(startDiscoveredApplication);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    render();
  }
}

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
    appName: value('appName'),
    appKey: value('appKey'),
    appSecret: value('appSecret'),
    callbackUrl: value('callback'),
    passphrase: value('passphrase')
  };
  el<HTMLInputElement>('#appSecret').value = '';
  el<HTMLInputElement>('#passphrase').value = '';
  withHostPermission('start', payload, payload.callbackUrl);
};
el('#unlock').onclick = () => {
  const passphrase = value('passphrase');
  el<HTMLInputElement>('#passphrase').value = '';
  void run('unlock', { passphrase });
};
el('#receive').onclick = () => {
  const url = value('callbackPaste');
  el<HTMLInputElement>('#callbackPaste').value = '';
  void run('callback', { url });
};
for (const action of ['lock', 'cancel', 'save'])
  el(`#${action}`).onclick = () => {
    void run(action);
  };
el('#clear').onclick = () => {
  if (!busy)
    confirmAction(t(protocol === 'top' ? 'confirmClearTop' : 'confirmClear'), () => {
      void run('clear');
    });
};
el('#refresh').onclick = () => {
  if (!busy)
    confirmAction(t('confirmRefresh'), () => {
      withHostPermission('refresh');
    });
};
el('#reauthorize').onclick = () => {
  if (!busy)
    confirmAction(t('confirmReauthorize'), () => {
      withHostPermission('reauthorize', {}, summary?.callbackUrl ?? undefined);
    });
};
el('#export').onclick = () => {
  if (busy) return;
  confirmAction(t('confirmExport'), () => {
    busy = true;
    render();
    void request('export')
      .then((data) => {
        const bundle = parseAlibabaOpenApiCredentialBundle(data);
        if ((bundle.protocol ?? 'top') !== protocol)
          throw new Error(protocol === 'top' ? 'TOP_REQUIRED' : 'IOP_REQUIRED');
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'credentialInfo.json';
        anchor.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
        transientMessage(t('downloaded'));
      })
      .catch(showError)
      .finally(() => {
        busy = false;
        render();
      });
  });
};
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
el('#importJson').onclick = () => {
  if (busy) return;
  const selected = protocol;
  let bundle;
  try {
    bundle = parseAuthorizationJson(jsonInput.value, protocol);
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
    if (passphrase) perform(passphrase);
    else requestAuthorizationPassphrase(perform, t('importPassphraseHelp'));
  });
};
el<HTMLInputElement>('#file').onchange = (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  el<HTMLInputElement>('#file').value = '';
  if (!file || busy) return;
  if (file.size > 65_536) {
    showError(new Error('AUTH_INPUT_INVALID'));
    return;
  }
  confirmAction(t('importConfirm'), () => {
    const passphrase = value('passphrase');
    el<HTMLInputElement>('#passphrase').value = '';
    void file
      .text()
      .then(async (text) => {
        await run('import', { bundle: JSON.parse(text) as unknown, passphrase });
      })
      .catch(() => {
        showError(new Error('AUTH_INPUT_INVALID'));
      });
  });
};
function switchProtocol(selected: Protocol): void {
  if (selected === protocol || busy || summary?.state === 'waiting' || summary?.state === 'busy') return;
  const apply = (): void => {
    clearTimeout(timer);
    protocol = selected;
    history.replaceState(null, '', location.pathname + (selected === 'top' ? '?protocol=top' : ''));
    summary = null;
    for (const id of ['appName', 'appKey', 'appSecret', 'passphrase', 'callbackPaste'])
      el<HTMLInputElement>(`#${id}`).value = '';
    el<HTMLInputElement>('#registered').checked = false;
    el<HTMLInputElement>('#callback').value = selected === 'iop' ? PUBLIC_AUTH_CALLBACK : '';
    resetJsonEditor();
    transientMessage('', true);
    transientMessage('');
    render();
    void update().catch(showError);
  };
  if (
    ['appName', 'appKey', 'appSecret', 'passphrase'].some((id) => value(id) !== '') ||
    (jsonInput.value.trim() !== '' && jsonInput.value !== jsonExample)
  )
    confirmAction(t('switchProtocolConfirm'), apply);
  else apply();
}
el('#protocolIop').onclick = () => {
  switchProtocol('iop');
};
el('#protocolTop').onclick = () => {
  switchProtocol('top');
};
el('#language').addEventListener('click', render);
window.addEventListener('pagehide', () => {
  clearTimeout(timer);
  jsonInput.value = '';
  highlightAuthorizationJson(el('#jsonHighlight'), '');
  for (const id of ['appSecret', 'passphrase', 'callbackPaste']) el<HTMLInputElement>(`#${id}`).value = '';
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
  void browser.permissions
    .contains({
      origins: [...(protocol === 'iop' ? IOP_APPLICATION_READER_ORIGINS : TOP_APPLICATION_READER_ORIGINS)]
    })
    .then(async (allowed) => {
      if (selected !== protocol) return;
      if (allowed) await discoverApplication();
      else transientMessage(t('discoverPermission'));
    })
    .catch(showError);
}
