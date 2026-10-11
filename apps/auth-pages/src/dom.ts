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
