const mode = new URL(location.href).searchParams.get('mode');
const fixture = await fetch('/fixtures/standalone-authorization.json').then((response) => response.json());
const application = fixture.iop;
for (const [field, value] of [
  ['name', application.appName],
  ['key', application.appKey],
  ['callback', mode === 'missing-callback' ? '' : application.callbackUrl]
])
  document.querySelector(`[data-field="${field}"] .form-item`).textContent = value;

document.querySelector('#view-secret').addEventListener('click', () => {
  document.body.dataset.viewClicks = String(Number(document.body.dataset.viewClicks) + 1);
  document.body.dataset.viewPointer = String(
    Boolean(document.querySelector('[data-one-vegetable-guided-pointer]'))
  );
  if (mode === 'security-check') {
    const warning = document.createElement('p');
    warning.textContent = 'Security verification required';
    document.body.append(warning);
    return;
  }
  document.querySelector('#secret-value').textContent = application.appSecret;
});
document.querySelector('#reset-secret').addEventListener('click', () => {
  document.body.dataset.resetClicks = String(Number(document.body.dataset.resetClicks) + 1);
});

if (mode === 'overlay') {
  const observer = new MutationObserver(() => {
    if (!document.querySelector('[data-one-vegetable-guided-pointer]')) return;
    observer.disconnect();
    const overlay = document.createElement('div');
    overlay.id = 'blocking-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.textContent = 'Read-only fixture overlay: do not click through';
    overlay.style.cssText = 'position:fixed;inset:0;background:#eef2ff;z-index:2147483646';
    document.body.append(overlay);
  });
  observer.observe(document.documentElement, { childList: true });
}
document.body.dataset.fixtureReady = 'true';
