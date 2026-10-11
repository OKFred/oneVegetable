import { bridge, isSuccessful } from './bridge';
import { el, footer, languageButton, t } from './dom';
import './style.css';
// Remove the authorization code before any asynchronous work or user navigation.
const query = new URLSearchParams(location.search);
history.replaceState(null, '', location.pathname);
el('#app').innerHTML =
  `<header><h1 data-text="title"></h1><button id="language" data-text="language"></button></header><section><p id="notice" role="status"></p></section>${footer}`;
languageButton();
const state = query.get('state');
const code = query.get('code');
if (
  !state ||
  query.getAll('state').length !== 1 ||
  (!query.has('error') && (!code || query.getAll('code').length !== 1))
) {
  el('#notice').textContent = t('invalidCallback');
} else {
  const payload = query.has('error') ? { state, error: 'provider-error' } : { state, code: code ?? '' };
  void bridge('callback', payload).then(
    (value) => {
      el('#notice').textContent = t(isSuccessful(value) ? 'received' : 'invalidCallback');
    },
    () => {
      el('#notice').textContent = t('missing');
    }
  );
}
