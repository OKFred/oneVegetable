/** Reuse an existing signed-in browser, with a local paste-only callback receiver. */
import { request } from '@playwright/test';
import { readCredentialBundle } from './openapi-auth/bundle';
import { readOpenApiAuthConfiguration } from './openapi-auth/config';
import { exchangeAuthorizationCode } from './openapi-auth/oauth';
import { startReconnectServer } from './openapi-auth/reconnect-server';
import { atomicWriteJson } from './openapi-auth/storage';

const config = readOpenApiAuthConfiguration(process.env, process.cwd());
const previous = await readCredentialBundle(config.outputPath);
const api = await request.newContext();
const result = { saved: false };
try {
  const server = await startReconnectServer({
    application: previous.application,
    timeoutMilliseconds: config.manualTimeoutMilliseconds,
    exchange: (code) =>
      exchangeAuthorizationCode(api, {
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
