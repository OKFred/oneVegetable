/** Reuse an existing signed-in browser, with a local paste-only callback receiver. */
import { request } from '@playwright/test';
import { readCredentialBundle } from './openapi-auth/bundle';
import { readOpenApiAuthConfiguration } from './openapi-auth/config';
import { exchangeAuthorizationCode } from './openapi-auth/oauth';
import { createIopToken } from './openapi-auth/iop-token';
import { startReconnectServer } from './openapi-auth/reconnect-server';
import { atomicWriteJson } from './openapi-auth/storage';

const config = readOpenApiAuthConfiguration(process.env, process.cwd());
const previous = await readCredentialBundle(config.outputPath);
const protocol = process.env.OPEN_API_PROTOCOL ?? previous.protocol ?? 'top';
if (protocol !== 'top' && protocol !== 'iop') throw new Error('OPEN_API_PROTOCOL must be top or iop');
if (previous.protocol && previous.protocol !== protocol)
  throw new Error('Requested protocol does not match the existing authorization bundle');
const api = await request.newContext();
const result = { saved: false };
try {
  const server = await startReconnectServer({
    application: previous.application,
    protocol: protocol === 'iop' ? 'iop' : 'legacy',
    timeoutMilliseconds: config.manualTimeoutMilliseconds,
    exchange: (code) =>
      protocol === 'iop'
        ? createIopToken({
            appKey: previous.application.appKey,
            appSecret: previous.application.appSecret,
            code
          })
        : exchangeAuthorizationCode(api, {
            appKey: previous.application.appKey,
            appSecret: previous.application.appSecret,
            code,
            redirectUri: previous.application.callbackUrl
          }),
    save: async (bundle) => {
      await atomicWriteJson(config.outputPath, bundle);
      result.saved = true;
      process.stdout.write(
        JSON.stringify({
          status: 'saved',
          protocol,
          output: config.outputPath,
          expiresAtUtc: bundle.oauth.expiresAtUtc,
          refreshExpiresAtUtc: bundle.oauth.refreshExpiresAtUtc
        }) + '\n'
      );
    }
  });
  process.stdout.write(`仅本机授权入口：${server.origin}/\n`);
  await server.closed;
  if (!result.saved) {
    process.stderr.write('本次重新授权未完成，未更新授权包。\n');
    process.exitCode = 1;
  }
} finally {
  await api.dispose();
}
