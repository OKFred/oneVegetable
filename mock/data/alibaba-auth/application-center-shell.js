const center = document.querySelector('#application-center');
if (new URL(location.href).searchParams.get('language') === 'zh') center.textContent = '应用中心';
center.addEventListener('click', () => {
  document.body.dataset.centerClicks = String(Number(document.body.dataset.centerClicks) + 1);
  document.body.dataset.centerPointer = String(
    Boolean(document.querySelector('[data-one-vegetable-guided-pointer]'))
  );
  document.body.dataset.centerGuide = String(
    Boolean(document.getElementById('one-vegetable-alibaba-developer-guide'))
  );
  const frame = new URL('https://openapi.alibaba.com/fixtures/application-center.html');
  frame.search = location.search;
  document.querySelector('#application-frame').src = frame.href;
});
