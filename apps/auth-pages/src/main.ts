import { PUBLIC_AUTH_CALLBACK, STORE_EXTENSION_ID } from '@one-vegetable/core/alibaba-iop';
import { bridge, isSuccessful } from './bridge';
import { el, footer, languageButton, t } from './dom';
import './style.css';
el('#app').innerHTML =
  `<header><div><small>oneVegetable · IOP</small><h1 data-text="title"></h1><p class="muted" data-text="subtitle"></p></div><button id="language" class="language" data-text="language"></button></header><p data-text="intro"></p><section><h2 data-text="step1"></h2><p data-text="step1Text"></p><a class="button" href="https://i.alibaba.com/explore/open-api" target="_blank" rel="noopener noreferrer" data-text="center"></a></section><section><h2 data-text="step2"></h2><p data-text="step2Text"></p><p><code id="callback"></code></p><button id="copy" data-text="copy"></button></section><section><h2 data-text="step3"></h2><p data-text="step3Text"></p><nav><button id="open" class="primary" data-text="open"></button><a id="install" class="button" target="_blank" rel="noopener noreferrer" data-text="install"></a></nav><p id="notice" role="status"></p></section><p class="warning" data-text="boundary"></p>${footer}`;
el('#callback').textContent = PUBLIC_AUTH_CALLBACK;
el<HTMLAnchorElement>('#install').href = `https://chromewebstore.google.com/detail/${STORE_EXTENSION_ID}`;
el('#copy').onclick = () => {
  void navigator.clipboard.writeText(PUBLIC_AUTH_CALLBACK).then(
    () => {
      el('#notice').textContent = t('copied');
    },
    () => {
      el('#notice').textContent = t('clipboardError');
    }
  );
};
el('#open').onclick = () => {
  void bridge('open').then(
    (result) => {
      el('#notice').textContent = t(isSuccessful(result) ? 'detected' : 'missing');
    },
    () => {
      el('#notice').textContent = t('missing');
    }
  );
};
languageButton();
void bridge('probe').then(
  (result) => {
    el('#notice').textContent = t(isSuccessful(result) ? 'detected' : 'missing');
  },
  () => {
    el('#notice').textContent = t('missing');
  }
);
