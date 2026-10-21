import { createVNode, render, type Component } from 'vue';
import { ArrowLeft, Check, Monitor, Moon, Sun } from '@lucide/vue';
import { browser } from 'wxt/browser';
import {
  APP_PREFERENCES_STORAGE_KEY,
  parseAppPreferences,
  type AppTheme
} from '@one-vegetable/core/preferences';
import { el, t } from '../../../auth-pages/src/dom';

function icon(target: HTMLElement, component: Component): void {
  render(createVNode(component, { 'aria-hidden': 'true', size: 20, strokeWidth: 1.8 }), target);
}

/** Reorganize existing controls without changing their event handlers or credential ownership. */
export function setupAuthorizationLayout(): void {
  document.body.classList.add('authorization-page');
  const oldHeader = el('#app > header');
  const title = el('#title');
  const language = el('#language');
  const statusPanel = el('#status').closest('section');
  const summaryPanel = el('#connectionDetails').closest('section');
  const protocolPanel = el('#protocolSettings').closest('section');
  const jsonPanel = el('#advancedJson').closest('section');
  if (!statusPanel || !summaryPanel || !protocolPanel || !jsonPanel) throw new Error('AUTH_INPUT_INVALID');
  statusPanel.id = 'authorization-status-panel';
  summaryPanel.id = 'authorization-summary-panel';
  const header = document.createElement('header');
  header.className = 'authorization-header';
  header.innerHTML = `<a class="authorization-brand" href="${browser.runtime.getURL('/options.html#/dashboard')}"><img src="${browser.runtime.getURL('/icon.png')}" alt="" width="48" height="48"><span><span data-text="authorizationBrandName"></span><small>ONEVEGETABLE</small></span></a><div class="authorization-header-actions"><button id="authorization-theme" type="button"><span></span></button></div>`;
  el('#app').prepend(header);
  el('.authorization-header-actions').append(language);
  el('#status').before(title);
  statusPanel.prepend(el('#protocolBadge'));
  const introduction = oldHeader.querySelector('[data-text="toolGuide"]');
  if (introduction) statusPanel.prepend(introduction);
  oldHeader.remove();
  const layout = document.createElement('div');
  layout.className = 'authorization-layout';
  layout.innerHTML =
    '<nav class="authorization-steps"></nav><div class="authorization-content"></div><aside class="authorization-summary" aria-labelledby="authorization-summary-title"></aside>';
  header.after(layout);
  el('.authorization-steps').append(el('.connection-steps'));
  for (const [index, step] of [...document.querySelectorAll('.connection-steps li')].entries()) {
    const badge = document.createElement('span');
    badge.className = 'authorization-step-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = String(index + 1);
    const label = document.createElement('span');
    step.append(badge, label);
    step.id = ['connectStep', 'approveStep', 'useStep'][index] ?? '';
    label.dataset.text = ['connectStep', 'approveStep', 'useStep'][index];
    step.removeAttribute('data-text');
  }
  el('.authorization-content').append(
    el('#protectionSection'),
    statusPanel,
    el('#topEntries'),
    el('#alternatives'),
    el('#manualSection'),
    jsonPanel
  );
  el('.authorization-summary').append(summaryPanel, protocolPanel);
  managementToggle(protocolPanel);
  const summaryTitle = summaryPanel.querySelector('h2');
  if (summaryTitle) summaryTitle.id = 'authorization-summary-title';
  el('#workbenchStep h3').classList.add('authorization-sr-only');
  const readyTitle = document.createElement('div');
  readyTitle.id = 'authorization-ready-heading';
  readyTitle.hidden = true;
  readyTitle.innerHTML =
    '<span class="authorization-success-icon"></span><h1 data-text="authorizationComplete"></h1>';
  el('#workbenchStep').before(readyTitle);
  icon(el('.authorization-success-icon'), Check);
  el('#workbenchAction').append(el('#back'));
  el('#back').className = 'authorization-back';
  el('#workbenchStep').insertAdjacentHTML(
    'beforeend',
    '<p class="authorization-profile-isolation" id="authorization-profile-isolation"></p>'
  );
  summaryPanel
    .querySelector('dl')
    ?.insertAdjacentHTML(
      'afterbegin',
      '<dt data-text="authorizationProtocol"></dt><dd id="authorization-protocol-value"></dd>'
    );
  el('#name').previousElementSibling?.setAttribute('data-text', 'applicationName');
  el('#expires').previousElementSibling?.setAttribute('data-text', 'authorizationExpiry');
  el('#boundary').setAttribute('data-text', 'authorizationSecretPrivacy');
  const refreshLabel = el('#refreshExpires').previousElementSibling;
  if (refreshLabel) {
    const dates = document.createElement('dl');
    dates.append(refreshLabel, el('#refreshExpires'));
    el('#connectionDetails').prepend(dates);
  }
  el('#protocolBadge').classList.add('authorization-sr-only');
  el('.authorization-steps').insertAdjacentHTML(
    'beforeend',
    '<a id="authorization-header-back" class="authorization-back"><span></span><span data-text="returnSettings"></span></a>'
  );
  el<HTMLAnchorElement>('#authorization-header-back').href =
    browser.runtime.getURL('/options.html#/settings');
  icon(el('#authorization-header-back > span'), ArrowLeft);
  setupTheme();
}

let currentStep = -1;
function managementToggle(panel: HTMLElement): void {
  el('#connectionDetails').addEventListener('toggle', () => {
    panel.hidden =
      document.body.dataset.authorizationReady === 'true' &&
      !el<HTMLDetailsElement>('#connectionDetails').open;
  });
}
export function updateAuthorizationLayout(protocol: 'top' | 'iop', ready: boolean, waiting: boolean): void {
  document.body.dataset.authorizationReady = String(ready);
  const protocolPanel = el('#protocolSettings').closest('section');
  if (protocolPanel) protocolPanel.hidden = ready && !el<HTMLDetailsElement>('#connectionDetails').open;
  el('#authorization-ready-heading').hidden = !ready;
  el('#title').hidden = ready;
  el('#status').classList.toggle('authorization-sr-only', ready);
  const introduction = el('#authorization-status-panel > [data-text="toolGuide"]');
  introduction.hidden = ready;
  el('#authorization-protocol-value').textContent = protocol === 'top' ? t('summaryTop') : t('summaryIop');
  el('#authorization-profile-isolation').textContent = t(
    protocol === 'top' ? 'isolationTop' : 'isolationIop'
  );
  el('#back').textContent = t('skipWorkbench');
  updateThemeLabel();
  const selected = ready ? 2 : waiting ? 1 : 0;
  for (const [index, step] of [...document.querySelectorAll<HTMLElement>('.connection-steps li')].entries()) {
    step.dataset.complete = String(index < selected);
    if (currentStep !== selected) {
      const badge = step.querySelector<HTMLElement>('.authorization-step-badge');
      if (!badge) continue;
      if (index < selected) {
        render(null, badge);
        badge.replaceChildren();
        icon(badge, Check);
      } else {
        render(null, badge);
        badge.textContent = String(index + 1);
      }
    }
  }
  currentStep = selected;
}

let theme: AppTheme = 'system';
function readPreferences() {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? 'null') as unknown;
  } catch {
    /* Unavailable or damaged preferences do not block authorization. */
  }
  return parseAppPreferences(
    raw,
    navigator.languages.some((language) => language.toLowerCase().includes('zh')) ? 'zh-CN' : 'en-US'
  );
}
function updateThemeLabel(): void {
  const button = el('#authorization-theme');
  button.setAttribute(
    'aria-label',
    t(theme === 'dark' ? 'themeDark' : theme === 'light' ? 'themeLight' : 'themeSystem')
  );
  button.title = button.getAttribute('aria-label') ?? '';
}
function setupTheme(): void {
  theme = readPreferences().theme;
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
  const apply = (): void => {
    const dark = theme === 'dark' || (theme === 'system' && media?.matches === true);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    icon(el('#authorization-theme > span'), theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor);
    updateThemeLabel();
  };
  el('#authorization-theme').onclick = () => {
    theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    try {
      // Keep the interface language and Alibaba request language unchanged.
      localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...readPreferences(), theme }));
    } catch {
      /* Theme remains usable in memory when storage is unavailable. */
    }
    apply();
  };
  media?.addEventListener('change', apply);
  window.addEventListener('pagehide', () => media?.removeEventListener('change', apply), { once: true });
  apply();
}
