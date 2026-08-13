const baseUrl = globalThis.process.env.STAGING_BASE_URL;
const clientId = globalThis.process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = globalThis.process.env.CF_ACCESS_CLIENT_SECRET;
if (!baseUrl || !clientId || !clientSecret) throw new Error('staging smoke 环境变量不完整');

const response = await globalThis.fetch(new globalThis.URL('/api/v1/readyz', baseUrl), {
  headers: {
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret
  },
  redirect: 'error'
});
const body = await response.json();
if (!response.ok || body.status !== 'ok' || response.headers.get('X-Request-ID') !== body.requestId) {
  throw new Error(`staging smoke 失败：HTTP ${response.status}`);
}
globalThis.process.stdout.write(`staging ready requestId=${body.requestId}\n`);
