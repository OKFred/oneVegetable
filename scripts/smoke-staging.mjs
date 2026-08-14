const baseUrl = globalThis.process.env.STAGING_BASE_URL;
const clientId = globalThis.process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = globalThis.process.env.CF_ACCESS_CLIENT_SECRET;
const apiPrefix = globalThis.process.env.STAGING_API_PREFIX ?? '/api/v1';
const expectedGatewayMode = globalThis.process.env.STAGING_EXPECTED_GATEWAY_MODE ?? 'replay';
const allowHttp = globalThis.process.env.STAGING_SMOKE_ALLOW_HTTP === 'true';
const skipAccessDenialCheck = globalThis.process.env.STAGING_SMOKE_SKIP_ACCESS_DENIAL_CHECK === 'true';
if (!baseUrl || !clientId || !clientSecret) throw new Error('staging smoke 环境变量不完整');

const origin = new globalThis.URL(baseUrl);
if ((!allowHttp && origin.protocol !== 'https:') || origin.href !== `${origin.origin}/`) {
  throw new Error('STAGING_BASE_URL 必须是 HTTPS Origin');
}

if (!skipAccessDenialCheck) {
  const unprotected = await globalThis.fetch(new globalThis.URL(`${apiPrefix}/healthz`, origin), {
    redirect: 'manual'
  });
  if (unprotected.ok) throw new Error('staging 未被 Cloudflare Access 保护');
}

const health = await authenticatedFetch(`${apiPrefix}/healthz`);
const healthBody = await readJson(health, 'healthz');
assertProbe(health, healthBody, 'healthz');

let readyResponse;
let readyBody;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  readyResponse = await authenticatedFetch(`${apiPrefix}/readyz`);
  readyBody = await readJson(readyResponse, 'readyz');
  if (readyResponse.ok && readyBody.status === 'ok') break;
  if (attempt < 5) await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
}
assertProbe(readyResponse, readyBody, 'readyz');

const requestId = globalThis.crypto.randomUUID();
const metadata = await authenticatedFetch(`${apiPrefix}/meta/get`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
  body: JSON.stringify({ requestId })
});
const metadataBody = await readJson(metadata, 'meta/get');
if (
  !metadata.ok ||
  metadataBody.requestId !== requestId ||
  metadata.headers.get('X-Request-ID') !== requestId ||
  metadataBody.ok !== true ||
  metadataBody.data?.runtime !== 'cloudflare' ||
  metadataBody.data?.database !== 'd1' ||
  metadataBody.data?.environment !== 'staging' ||
  metadataBody.data?.gatewayMode !== expectedGatewayMode ||
  metadataBody.data?.apiPrefix !== apiPrefix
) {
  throw new Error(`staging metadata 不符合预期：HTTP ${metadata.status}`);
}

globalThis.process.stdout.write(
  `staging smoke passed readyRequestId=${readyBody.requestId} metadataRequestId=${requestId} gateway=${expectedGatewayMode}\n`
);

function authenticatedFetch(path, init = {}) {
  return globalThis.fetch(new globalThis.URL(path, origin), {
    ...init,
    headers: {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
      ...init.headers
    },
    redirect: 'error'
  });
}

async function readJson(response, operation) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} 未返回 JSON：HTTP ${response.status}`);
  }
}

function assertProbe(response, body, operation) {
  if (
    !response?.ok ||
    body?.status !== 'ok' ||
    !isRequestId(body.requestId) ||
    response.headers.get('X-Request-ID') !== body.requestId
  ) {
    throw new Error(`${operation} 失败：HTTP ${response?.status ?? 0}`);
  }
}

function isRequestId(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
