import { browser } from 'wxt/browser';
import { IOP_API_ORIGIN, PUBLIC_AUTH_CALLBACK } from '@one-vegetable/core/alibaba-iop';
import { parseAlibabaOpenApiCredentialBundle } from '@one-vegetable/core/credential-bundle';
import { el, errorText, footer, languageButton, t } from '../../../auth-pages/src/dom';
import type { IopAuthorizationSummary } from '../../lib/iop-authorization';
import '../../../auth-pages/src/style.css';

el('#app').innerHTML =
  `<header><div><small>oneVegetable · IOP</small><h1 data-text="title"></h1><p class="muted" data-text="subtitle"></p></div><button id="language" data-text="language"></button></header><p class="warning" data-text="boundary"></p><p id="notice" role="status"></p><p id="error" role="alert"></p><section><h2 id="status"></h2><dl><dt data-text="appName"></dt><dd id="name">—</dd><dt>App Key</dt><dd id="key">—</dd><dt data-text="expires"></dt><dd id="expires">—</dd><dt data-text="refreshExpires"></dt><dd id="refreshExpires">—</dd></dl><div class="actions"><button id="refresh" data-text="refresh"></button><button id="export" data-text="export"></button><button id="save" data-text="save" hidden></button><button id="lock" data-text="lock"></button><button id="cancel" data-text="cancel" hidden></button><button id="clear" data-text="clear"></button></div></section><section><form id="form"><fieldset id="fields"><div class="grid"><div><label for="appName" data-text="appName"></label><input id="appName" required maxlength="256"></div><div><label for="appKey" data-text="appKey"></label><input id="appKey" required maxlength="256" autocomplete="off"></div></div><label for="appSecret" data-text="appSecret"></label><input id="appSecret" type="password" autocomplete="off" required maxlength="4096" data-feedback-redact><label for="callback" data-text="callback"></label><input id="callback" type="url" required><label for="passphrase" data-text="passphrase"></label><input id="passphrase" type="password" autocomplete="off" minlength="6" maxlength="256" required data-feedback-redact><label><input id="registered" type="checkbox" required><span data-text="registered"></span></label><div class="actions"><button type="submit" id="start" class="primary" data-text="start"></button><button type="button" id="unlock" data-text="unlock"></button><label class="button"><span data-text="import"></span><input id="file" type="file" accept="application/json,.json" hidden></label></div></fieldset></form><div id="manual" hidden><label for="callbackPaste" data-text="paste"></label><input id="callbackPaste" type="password" autocomplete="off" data-feedback-redact><button id="receive" data-text="receive"></button></div></section>${footer}`;
el<HTMLInputElement>('#callback').value = PUBLIC_AUTH_CALLBACK;
languageButton();
let busy = false;
let summary: IopAuthorizationSummary | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const value = (id: string): string => el<HTMLInputElement>(`#${id}`).value;
async function request(action: string, payload: unknown = {}): Promise<unknown> {
  const result: unknown = await browser.runtime.sendMessage({
    kind: 'iop-authorization-request',
    requestId: crypto.randomUUID(),
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
  if (!summary) return;
  el('#status').textContent = t(busy ? 'busy' : summary.state);
  el('#name').textContent = summary.appName ?? '—';
  el('#key').textContent = summary.appKeySuffix ? `…${summary.appKeySuffix}` : '—';
  const date = (text: string | null): string =>
    text ? new Date(text).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : t('unknownDate');
  el('#expires').textContent = date(summary.expiresAtUtc);
  el('#refreshExpires').textContent = date(summary.refreshExpiresAtUtc);
  el<HTMLButtonElement>('#refresh').disabled = busy || !summary.canRefresh;
  el<HTMLButtonElement>('#export').disabled = busy || summary.state !== 'ready';
  el<HTMLButtonElement>('#lock').disabled = busy || !['ready', 'unknown'].includes(summary.state);
  el<HTMLButtonElement>('#clear').disabled = busy || summary.state === 'waiting' || summary.state === 'busy';
  el<HTMLFieldSetElement>('#fields').disabled = busy || ['waiting', 'busy'].includes(summary.state);
  el('#manual').hidden = summary.state !== 'waiting';
  el('#cancel').hidden = summary.state !== 'waiting';
  el('#save').hidden = !summary.canSave;
  if (summary.errorCode) el('#error').textContent = errorText(summary.errorCode);
}
async function update(): Promise<void> {
  const data = await request('status');
  if (
    !isRecord(data) ||
    typeof data.state !== 'string' ||
    !['empty', 'locked', 'ready', 'waiting', 'busy', 'unknown'].includes(data.state)
  )
    throw new Error('AUTH_ACTION_FAILED');
  summary = data as unknown as IopAuthorizationSummary;
  render();
  clearTimeout(timer);
  if (summary.state === 'waiting' || summary.state === 'busy')
    timer = setTimeout(() => {
      void update().catch(() => {
        el('#error').textContent = t('AUTH_ACTION_FAILED');
      });
    }, 5000);
}
async function run(action: string, payload: unknown = {}): Promise<void> {
  if (busy) return;
  busy = true;
  el('#error').textContent = '';
  el('#notice').textContent = '';
  render();
  try {
    await request(action, payload);
    if (!['start', 'callback', 'cancel', 'lock', 'clear'].includes(action))
      el('#notice').textContent = t('saved');
  } catch (error) {
    el('#error').textContent = errorText(error instanceof Error ? error.message : 'AUTH_ACTION_FAILED');
  } finally {
    busy = false;
    await update().catch(() => {
      el('#error').textContent = t('AUTH_ACTION_FAILED');
    });
  }
}
el<HTMLFormElement>('#form').onsubmit = (event) => {
  event.preventDefault();
  const payload = {
    appName: value('appName'),
    appKey: value('appKey'),
    appSecret: value('appSecret'),
    callbackUrl: value('callback'),
    passphrase: value('passphrase')
  };
  let origin: string;
  try {
    origin = new URL(payload.callbackUrl).origin;
  } catch {
    el('#error').textContent = t('CALLBACK_INVALID');
    return;
  }
  void browser.permissions
    .request({ origins: [`${IOP_API_ORIGIN}/*`, `${origin}/*`] })
    .then(async (allowed) => {
      if (!allowed) {
        el('#error').textContent = t('AUTH_PERMISSION_REQUIRED');
        return;
      }
      el<HTMLInputElement>('#appSecret').value = '';
      el<HTMLInputElement>('#passphrase').value = '';
      await run('start', payload);
    })
    .catch(() => {
      el('#error').textContent = t('AUTH_ACTION_FAILED');
    });
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
  if (confirm(t('confirmClear'))) void run('clear');
};
el('#refresh').onclick = () => {
  if (!confirm(t('confirmRefresh'))) return;
  void browser.permissions
    .request({ origins: [`${IOP_API_ORIGIN}/*`] })
    .then(async (allowed) => {
      if (allowed) await run('refresh');
      else el('#error').textContent = t('AUTH_PERMISSION_REQUIRED');
    })
    .catch(() => {
      el('#error').textContent = t('AUTH_ACTION_FAILED');
    });
};
el('#export').onclick = () => {
  if (!confirm(t('confirmExport')) || busy) return;
  void request('export')
    .then((data) => {
      const bundle = parseAlibabaOpenApiCredentialBundle(data);
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
      el('#notice').textContent = t('downloaded');
    })
    .catch((error: unknown) => {
      el('#error').textContent = errorText(error instanceof Error ? error.message : 'AUTH_ACTION_FAILED');
    });
};
el<HTMLInputElement>('#file').onchange = (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  el<HTMLInputElement>('#file').value = '';
  if (!file || !confirm(t('importConfirm'))) return;
  const passphrase = value('passphrase');
  el<HTMLInputElement>('#passphrase').value = '';
  void (async () => {
    try {
      if (file.size > 65536) throw new Error('AUTH_INPUT_INVALID');
      await run('import', { bundle: JSON.parse(await file.text()) as unknown, passphrase });
    } catch {
      el('#error').textContent = t('AUTH_INPUT_INVALID');
    }
  })();
};
el('#language').addEventListener('click', render);
window.addEventListener('pagehide', () => {
  clearTimeout(timer);
});
void update().catch(() => {
  el('#error').textContent = t('AUTH_ACTION_FAILED');
});
