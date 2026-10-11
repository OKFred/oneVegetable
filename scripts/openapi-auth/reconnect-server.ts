import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  createAlibabaOpenApiCredentialBundle,
  type AlibabaOpenApiCredentialBundle,
  type AlibabaTokenResponse
} from '../../packages/core/src/alibaba-credential-bundle';
import { buildAuthorizationUrl } from './browser';
import { callbackMatches } from './config';
import { validateCallback } from './oauth';
import { IOP_AUTHORIZE_ENDPOINT } from './iop-token';

export async function startReconnectServer(input: {
  application: AlibabaOpenApiCredentialBundle['application'];
  protocol?: 'legacy' | 'iop';
  timeoutMilliseconds: number;
  exchange: (code: string) => Promise<AlibabaTokenResponse>;
  save: (bundle: AlibabaOpenApiCredentialBundle) => Promise<void>;
}) {
  const state = randomUUID();
  const callback = new URL(input.application.callbackUrl);
  const authorize = buildAuthorizationUrl(
    { ...input.application, callbackUrl: callback, source: 'legacy-crosstrade' },
    state
  );
  if (input.protocol === 'iop') {
    authorize.href = IOP_AUTHORIZE_ENDPOINT + authorize.search;
    authorize.searchParams.delete('sp');
    authorize.searchParams.delete('view');
  }
  let origin = '';
  let submitted = false;
  const escape = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const server = createServer((incoming, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    // no-referrer makes Chrome send Origin:null on form POST; preserve same-origin CSRF checks.
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
          `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Alibaba 重新授权</title><h1>重新授权原应用</h1><p>沿用已登记 Callback，不创建应用，不修改权限。</p><p><a href="${escape(authorize.href)}" target="_blank" rel="noreferrer">1. 前往 Alibaba 授权</a></p><p>完成授权后复制跳转地址，粘贴到下方。地址含一次性授权码，请勿发到聊天或日志。</p><form method="post" action="/complete"><input type="hidden" name="state" value="${state}"><label>2. Callback 完整地址 <input type="password" name="callback" autocomplete="off" required size="80"></label><button type="submit">校验并保存授权包</button></form><p>仅保存至本机忽略目录，文件含明文密钥；现有服务需重新导入或重启后使用。</p></html>`
        );
        return;
      }
      if (
        incoming.method !== 'POST' ||
        incoming.url !== '/complete' ||
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
      const received = new URL(form.get('callback') ?? '');
      if (form.get('state') !== state || !callbackMatches(callback, received))
        throw new Error('invalid callback');
      const code = validateCallback(received, state);
      if (submitted) {
        response.writeHead(409).end('本次授权码已尝试交换，请重新运行命令。');
        return;
      }
      // Never retry the one-time exchange, including ambiguous failures or local write failure.
      submitted = true;
      const token = await input.exchange(code);
      const bundle = createAlibabaOpenApiCredentialBundle({
        capturedAtTimeUtc: Date.now(),
        application: input.application,
        token,
        receivedCallbackUrl: received.href
      });
      await input.save(bundle);
      response.end(
        '<h1>授权包已保存</h1><p>state 与 Callback 校验通过。接下来请导入本地服务并测试只读连接；未执行商品操作。</p>'
      );
      close();
    })().catch(() => {
      response
        .writeHead(400)
        .end('授权未完成，请检查 Callback 和 state；若已尝试交换授权码，请重新运行命令。');
    });
  });
  const timeout = setTimeout(() => {
    close();
  }, input.timeoutMilliseconds);
  function close(): void {
    clearTimeout(timeout);
    server.close();
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    close,
    closed: new Promise<void>((resolve) => {
      server.once('close', resolve);
    })
  };
}
