/** Local-only IOP candidate authorization. Does NOT replace the existing BFF/application configuration. */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { startReconnectServer } from './openapi-auth/reconnect-server';
import { createIopToken } from './openapi-auth/iop-token';
import { atomicWriteJson } from './openapi-auth/storage';
import { GatewayConfigurationError } from '../apps/api/src/gateway/credentials';
import type { AlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';

let origin = '';
const state = randomUUID();
let submitted = false;
const server = createServer((incoming, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  void (async () => {
    if (incoming.headers.host !== new URL(origin).host) {
      response.writeHead(403).end();
      return;
    }
    if (incoming.method === 'GET' && incoming.url === '/') {
      response.end(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>新版 System API 验收</title><h1>新版应用独立授权验收</h1><p>复用已有应用。不会替换当前工作台配置，也不修改权限或 Callback。</p><form method="post" action="/start"><input type="hidden" name="state" value="${state}"><p><label>App Name <input name="appName" required maxlength="256"></label></p><p><label>App Key <input name="appKey" required maxlength="256"></label></p><p><label>App Secret <input name="appSecret" type="password" required autocomplete="off" maxlength="4096"></label></p><p><label>Registered Callback <input name="callbackUrl" type="url" required maxlength="2048"></label></p><button>准备新版授权</button></form></html>`
      );
      return;
    }
    if (
      incoming.method !== 'POST' ||
      incoming.url !== '/start' ||
      incoming.headers.origin !== origin ||
      !incoming.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
    ) {
      response.writeHead(403).end();
      return;
    }
    let body = '';
    for await (const chunk of incoming) {
      body += String(chunk);
      if (Buffer.byteLength(body) > 16_384) {
        response.writeHead(413).end();
        return;
      }
    }
    const form = new URLSearchParams(body);
    if (form.get('state') !== state || submitted) {
      response.writeHead(409).end();
      return;
    }
    const required = (key: string, maximum: number) => {
      const value = form.get(key)?.trim();
      if (!value || value.length > maximum) throw new Error('Invalid configuration');
      return value;
    };
    const callback = new URL(required('callbackUrl', 2048));
    if (
      callback.protocol !== 'https:' ||
      callback.username ||
      callback.password ||
      callback.hash ||
      callback.search
    )
      throw new Error('Invalid registered callback');
    const application: AlibabaOpenApiCredentialBundle['application'] = {
      appName: required('appName', 256),
      appKey: required('appKey', 256),
      appSecret: required('appSecret', 4096),
      callbackUrl: callback.href,
      status: 'Online',
      permissions: []
    };
    submitted = true;
    const reconnect = await startReconnectServer({
      application,
      protocol: 'iop',
      timeoutMilliseconds: 600_000,
      exchange: async (code) => {
        const requestId = randomUUID();
        try {
          return await createIopToken(
            { appKey: application.appKey, appSecret: application.appSecret, code },
            { requestId }
          );
        } catch (failure) {
          const receipt = {
            requestId,
            phase: 'iop-token-create',
            capturedAtUtc: new Date().toISOString(),
            configuredCredentialsReplaced: false,
            error:
              failure instanceof GatewayConfigurationError
                ? { code: failure.code, message: failure.message, ...failure.diagnostics }
                : { code: 'IOP_EXCHANGE_NOT_COMPLETED' }
          };
          await atomicWriteJson(
            resolve(
              'artifacts/authorization-renewal-validation',
              new Date().toISOString().slice(0, 10),
              `${requestId}-iop-create-receipt.json`
            ),
            receipt
          );
          process.stdout.write(`${JSON.stringify(receipt)}\n`);
          throw failure;
        }
      },
      save: async (bundle) => {
        const output = resolve(
          'artifacts/authorization-renewal-validation',
          new Date().toISOString().slice(0, 10),
          'iop-candidate-credentials.json'
        );
        await atomicWriteJson(output, bundle);
        process.stdout.write(
          `${JSON.stringify({ status: 'saved', output, expiresAtUtc: bundle.oauth.expiresAtUtc, refreshExpiresAtUtc: bundle.oauth.refreshExpiresAtUtc, configuredCredentialsReplaced: false })}\n`
        );
      }
    });
    // CSP form-action 'self' also guards redirects; use an explicit safe local link instead.
    response.end(`<h1>新版授权入口已准备</h1><a href="${reconnect.origin}/">前往独立授权入口</a>`);
    process.stdout.write(`新版独立授权入口：${reconnect.origin}/\n`);
    await reconnect.closed;
    server.close();
  })().catch(() =>
    response.writeHead(400).end('新版授权未完成；未替换工作台凭据。请检查应用配置，或重新启动一次验收。')
  );
});
await new Promise<void>((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local address unavailable');
origin = `http://127.0.0.1:${address.port}`;
process.stdout.write(`仅本机新版授权验收：${origin}/\n`);
const timeout = setTimeout(() => server.close(), 600_000);
await new Promise<void>((done) => server.once('close', done));
clearTimeout(timeout);
