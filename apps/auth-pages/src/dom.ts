import { en, zh, type AuthorizationMessageKey } from '@one-vegetable/core/iop-messages';
let chinese = navigator.languages.some((language) => language.toLowerCase().includes('zh'));
export function t(key: AuthorizationMessageKey): string {
  return (chinese ? zh : en)[key];
}
// Typed DOM lookup mirrors querySelector; callers choose the required control subtype.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error('Missing interface element');
  return element;
}
export function translate(): void {
  document.documentElement.lang = chinese ? 'zh-CN' : 'en-US';
  document.querySelectorAll<HTMLElement>('[data-text]').forEach((element) => {
    const key = element.dataset.text;
    if (key && key in zh) element.textContent = t(key as AuthorizationMessageKey);
  });
}
export function languageButton(): void {
  el('#language').onclick = () => {
    chinese = !chinese;
    translate();
  };
  translate();
}
export function errorText(code: string): string {
  return code in zh ? t(code as AuthorizationMessageKey) : t('AUTH_ACTION_FAILED');
}
export const footer =
  '<footer><p data-text="privacy"></p><a href="https://rulechannel.alibaba.com/icbu" target="_blank" rel="noopener noreferrer" data-text="rules"></a></footer>';

const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Transient, local-only messages; no banners, telemetry or retained history. */
export function transientMessage(message: string, error = false): void {
  const id = error ? 'error' : 'notice';
  const content = el(`#${id}`);
  let card = content.closest<HTMLElement>('.authorization-toast');
  if (!card) {
    let region = document.querySelector<HTMLElement>('.authorization-notifications');
    if (!region) {
      region = document.createElement('div');
      region.className = 'authorization-notifications';
      region.dataset.feedbackIgnore = '';
      document.body.append(region);
    }
    card = document.createElement('div');
    card.className = `authorization-toast${error ? ' authorization-toast-error' : ''}`;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'authorization-toast-close';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', t('dismissNotification'));
    dismiss.onclick = () => {
      transientMessage('', error);
    };
    card.append(content, dismiss);
    region.append(card);
  }
  clearTimeout(notificationTimers.get(id));
  content.textContent = message;
  card.hidden = !message;
  if (message)
    notificationTimers.set(
      id,
      setTimeout(
        () => {
          transientMessage('', error);
        },
        error ? 6000 : 4000
      )
    );
  else notificationTimers.delete(id);
}

let activeConfirmation: HTMLDialogElement | null = null;
/** The approved action runs directly in the final click gesture for host permissions. */
export function confirmAction(message: string, onConfirm: () => void): void {
  if (activeConfirmation) return;
  const trigger = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirmation-dialog';
  dialog.setAttribute('aria-labelledby', 'authorization-confirm-title');
  dialog.setAttribute('aria-describedby', 'authorization-confirm-description');
  const title = document.createElement('h2');
  title.id = 'authorization-confirm-title';
  title.textContent = t('confirmationTitle');
  const description = document.createElement('p');
  description.id = 'authorization-confirm-description';
  description.textContent = message;
  const actions = document.createElement('div');
  actions.className = 'actions confirmation-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('confirmationCancel');
  const proceed = document.createElement('button');
  proceed.type = 'button';
  proceed.className = 'primary';
  proceed.textContent = t('confirmationContinue');
  proceed.dataset.testid = 'authorization-confirm';
  const close = (): void => {
    dialog.close();
    dialog.remove();
    activeConfirmation = null;
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
  };
  cancel.onclick = close;
  proceed.onclick = () => {
    close();
    onConfirm();
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      close();
  });
  actions.append(cancel, proceed);
  dialog.append(title, description, actions);
  document.body.append(dialog);
  activeConfirmation = dialog;
  dialog.showModal();
  cancel.focus();
}

/** Local-only passphrase, never a website password; explicit click retains user activation. */
export function requestAuthorizationPassphrase(
  onConfirm: (passphrase: string) => void,
  help = t('protectBundleHelp')
): void {
  if (activeConfirmation) return;
  const trigger = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirmation-dialog';
  dialog.dataset.feedbackRedact = '';
  const title = document.createElement('h2');
  title.id = 'authorization-passphrase-title';
  title.textContent = t('protectBundle');
  dialog.setAttribute('aria-labelledby', title.id);
  const description = document.createElement('p');
  description.textContent = help;
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'new-password';
  input.required = true;
  input.minLength = 6;
  input.maxLength = 256;
  input.setAttribute('aria-label', t('passphrase'));
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('confirmationCancel');
  const proceed = document.createElement('button');
  proceed.type = 'submit';
  proceed.className = 'primary';
  proceed.textContent = t('start');
  const close = (): void => {
    input.value = '';
    dialog.close();
    dialog.remove();
    activeConfirmation = null;
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
  };
  cancel.onclick = close;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const passphrase = input.value;
    close();
    onConfirm(passphrase);
  };
  actions.append(cancel, proceed);
  form.append(input, actions);
  dialog.append(title, description, form);
  document.body.append(dialog);
  activeConfirmation = dialog;
  dialog.showModal();
  input.focus();
}
