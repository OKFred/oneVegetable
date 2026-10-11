document.querySelector('#approve').onclick = () => {
  const query = new URLSearchParams(location.search);
  const callback = new URL(query.get('redirect_uri'));
  callback.search = new URLSearchParams({
    state: query.get('state'),
    code: 'fixture-authorized-code'
  }).toString();
  location.assign(callback.href);
};
