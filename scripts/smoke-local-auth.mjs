const baseUrl = globalThis.process.env.SMOKE_BASE_URL ?? 'http://localhost:8787';
const bootstrapToken = globalThis.process.env.SMOKE_BOOTSTRAP_TOKEN;
if (!bootstrapToken) throw new Error('SMOKE_BOOTSTRAP_TOKEN 未配置');

const ready = await globalThis.fetch(new globalThis.URL('/api/v1/readyz', baseUrl), {
  redirect: 'error'
});
const readyBody = await ready.json();
assertCorrelated(ready, readyBody);
if (!ready.ok || readyBody.status !== 'ok') throw new Error('readyz 未就绪');

const bootstrap = await post('/api/v1/auth/bootstrap', {
  bootstrapToken,
  username: 'smoke-admin',
  password: 'smoke-password-value'
});
if (!bootstrap.response.ok || !bootstrap.body.ok) throw new Error('bootstrap 失败');
const cookies = bootstrap.response.headers
  .getSetCookie()
  .map((value) => value.split(';', 1)[0])
  .join('; ');
if (!cookies.includes('ov_session=') || !cookies.includes('ov_csrf=')) {
  throw new Error('认证 Cookie 缺失');
}

const session = await post('/api/v1/auth/session/get', {}, { Cookie: cookies });
if (!session.response.ok || session.body.data?.principal?.role !== 'admin') {
  throw new Error('管理员会话恢复失败');
}

const system = await post('/api/v1/admin/system/get', {}, { Cookie: cookies });
if (!system.response.ok || system.body.data?.gatewayMode !== 'mock') {
  throw new Error('管理员系统接口失败');
}

const denied = await post(
  '/api/v1/operations/call',
  { operation: 'clearDiagnostics', payload: {} },
  { Cookie: cookies, Origin: baseUrl }
);
if (denied.response.status !== 403 || denied.body.error?.code !== 'CSRF_INVALID') {
  throw new Error('mutation 未被 CSRF 拒绝');
}

globalThis.process.stdout.write(
  `local auth smoke passed runtime=${system.body.data.runtime} requestId=${system.body.requestId}\n`
);

async function post(path, body, headers = {}) {
  const requestId = globalThis.crypto.randomUUID();
  const response = await globalThis.fetch(new globalThis.URL(path, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId, ...headers },
    body: JSON.stringify({ requestId, ...body }),
    redirect: 'error'
  });
  const responseBody = await response.json();
  assertCorrelated(response, responseBody, requestId);
  return { response, body: responseBody };
}

function assertCorrelated(response, body, expectedRequestId = body.requestId) {
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof body.requestId !== 'string' ||
    response.headers.get('X-Request-ID') !== body.requestId ||
    body.requestId !== expectedRequestId
  ) {
    throw new Error('requestId 关联失败');
  }
}
