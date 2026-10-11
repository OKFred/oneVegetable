/** Explicit, bounded diagnostics; never replaces the configured credential or prints token responses. */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { NetworkManager } from '../packages/core/src/network';
import {
  parseAlibabaOpenApiCredentialBundle,
  parseAlibabaTokenResponse,
  credentialExpiryFromSeconds
} from '../packages/core/src/alibaba-credential-bundle';
import { ALIBABA_GATEWAY } from '../packages/core/src/signing';
import { openNodeDatabase } from '../apps/api/src/db/node-database';
import {
  GatewayCredentialCipher,
  SqlGatewayCredentialRepository
} from '../apps/api/src/gateway/credential-vault';
import {
  credentialDocumentFromBundle,
  parseCredentialDocument
} from '../apps/api/src/gateway/credential-document';
import {
  parseTokenBody,
  hasTokenError,
  tokenRefreshFailure
} from '../apps/api/src/gateway/token-refresh-error';
import { testGatewayCredential } from '../apps/api/src/gateway/credential-test';
import { atomicWriteJson } from './openapi-auth/storage';
import { signIopParameters } from './openapi-auth/iop-token';
import { summarizeIopProductRead } from './openapi-auth/iop-product-read';

if (existsSync('.env')) loadEnvFile('.env');
const root = process.cwd();
const database = openNodeDatabase(
  resolve(root, 'apps/api', process.env.ONE_VEGETABLE_SQLITE_PATH ?? '.data/one-vegetable.sqlite')
);
const repository = new SqlGatewayCredentialRepository(database.executor);
const cipher = await GatewayCredentialCipher.create(
  process.env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY ??
    (await readFile(resolve(root, '.data/local-credential-encryption-key'), 'utf8')).trim()
);
const requestId = crypto.randomUUID();
const directory = resolve(
  root,
  'artifacts/authorization-renewal-validation',
  new Date().toISOString().slice(0, 10)
);
try {
  const bundleArgument = process.argv
    .find((value) => value.startsWith('--bundle='))
    ?.slice('--bundle='.length);
  const documentArgument = process.argv
    .find((value) => value.startsWith('--document='))
    ?.slice('--document='.length);
  if (bundleArgument && documentArgument) throw new Error('Choose one credential input');
  const record = bundleArgument || documentArgument ? null : await repository.find();
  const document = documentArgument
    ? parseCredentialDocument(JSON.parse(await readFile(resolve(root, documentArgument), 'utf8')) as unknown)
    : bundleArgument
      ? credentialDocumentFromBundle(
          parseAlibabaOpenApiCredentialBundle(
            JSON.parse(await readFile(resolve(root, bundleArgument), 'utf8')) as unknown
          )
        )
      : record
        ? await cipher.decryptDocument(record)
        : null;
  if (!document) throw new Error('No managed credential configured');
  process.stdout.write(
    `${JSON.stringify({ appName: document.credentials.appName, appKeySuffix: document.credentials.appKey.slice(-4), revision: record?.revision ?? null, hasRefreshToken: Boolean(document.credentials.refreshToken), expiresTimeUtc: document.credentials.accessTokenExpiresTimeUtc, refreshExpiresTimeUtc: document.credentials.refreshTokenExpiresTimeUtc })}\n`
  );
  const credentialRead = () =>
    testGatewayCredential(
      {
        status: () =>
          Promise.resolve({
            source: 'credential-bundle',
            configured: true,
            hasAppKey: true,
            hasAppSecret: true,
            hasAccessToken: true,
            endpointOrigin: new URL(ALIBABA_GATEWAY).origin,
            signMethod: 'hmac-sha256'
          }),
        requireCredentials: () =>
          Promise.resolve({
            ...document.credentials,
            endpoint: ALIBABA_GATEWAY,
            signMethod: 'hmac-sha256'
          })
      },
      crypto.randomUUID()
    );
  if (process.argv.includes('--test')) {
    const test = await credentialRead();
    await atomicWriteJson(resolve(directory, `${requestId}-read-receipt.json`), test);
    process.stdout.write(`${JSON.stringify(test)}\n`);
    if (test.status !== 'passed' && test.status !== 'no-data') process.exitCode = 1;
  }
  if (process.argv.includes('--test-iop')) {
    // Fixed read-only path from the official IOP product-list reference; no guessed endpoints.
    const path = '/alibaba/icbu/product/list';
    const endpoint = `https://openapi-api.alibaba.com/rest${path}`;
    const parameters = {
      app_key: document.credentials.appKey,
      access_token: document.credentials.accessToken,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      simplify: 'true',
      current_page: '1',
      page_size: '1'
    };
    const network = new NetworkManager({
      policies: {
        alibaba: {
          allowedOrigins: [new URL(endpoint).origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 16_384,
          maxResponseBytes: 262_144,
          redirect: 'error'
        }
      }
    });
    const response = await network.request({
      service: 'alibaba',
      url: endpoint,
      requestId,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        ...parameters,
        sign: signIopParameters(path, parameters, document.credentials.appSecret)
      }),
      responseType: 'text',
      maxAttempts: 1
    });
    const value = parseTokenBody(response.data);
    const body =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const summary = summarizeIopProductRead(value);
    const valid = response.ok && summary !== null;
    const failure = valid
      ? null
      : tokenRefreshFailure(response.status, value, [
          document.credentials.appSecret,
          document.credentials.accessToken,
          document.credentials.refreshToken ?? ''
        ]);
    const receipt = {
      requestId,
      phase: 'iop-product-list-read',
      endpoint,
      capturedAtUtc: new Date().toISOString(),
      httpStatus: response.status,
      status: valid
        ? summary.itemCount
          ? 'passed'
          : 'no-data'
        : body?.code === '0' || body?.code === 0
          ? 'contract-drift'
          : 'provider-error',
      itemCount: valid ? summary.itemCount : null,
      error: failure ? { code: failure.code, ...failure.diagnostics } : null,
      credentialsReplaced: false
    };
    await atomicWriteJson(resolve(directory, `${requestId}-iop-read-receipt.json`), receipt);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (!valid) process.exitCode = 1;
  }
  if (process.argv.includes('--refresh')) {
    const protocol = process.argv.includes('--iop') ? 'iop' : 'oauth';
    if (!document.credentials.refreshToken) throw new Error('Refresh Token is missing');
    await atomicWriteJson(
      resolve(directory, `${requestId}-encrypted-baseline.json`),
      await cipher.encryptDocument(document)
    );
    const path = '/auth/token/refresh';
    const endpoint =
      protocol === 'iop' ? `https://openapi-api.alibaba.com/rest${path}` : 'https://oauth.alibaba.com/token';
    const parameters: Record<string, string> =
      protocol === 'iop'
        ? {
            app_key: document.credentials.appKey,
            timestamp: String(Date.now()),
            sign_method: 'sha256',
            simplify: 'true',
            refresh_token: document.credentials.refreshToken
          }
        : {
            grant_type: 'refresh_token',
            client_id: document.credentials.appKey,
            client_secret: document.credentials.appSecret,
            refresh_token: document.credentials.refreshToken,
            sp: 'icbu'
          };
    if (protocol === 'iop') {
      parameters.sign = signIopParameters(path, parameters, document.credentials.appSecret);
    }
    const network = new NetworkManager({
      policies: {
        alibaba: {
          allowedOrigins: [new URL(endpoint).origin],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 16 * 1024,
          maxResponseBytes: 64 * 1024,
          defaultHeaders: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          redirect: 'error'
        }
      }
    });
    const response = await network.request({
      service: 'alibaba',
      url: endpoint,
      requestId,
      method: 'POST',
      body: new URLSearchParams(parameters),
      responseType: 'text',
      maxAttempts: 1
    });
    const value = parseTokenBody(response.data);
    const body =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const shape = {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      bodyBytes: typeof response.data === 'string' ? new TextEncoder().encode(response.data).byteLength : 0,
      fields: body
        ? Object.keys(body).filter((key) =>
            [
              'code',
              'error',
              'error_code',
              'error_msg',
              'error_description',
              'request_id',
              'access_token',
              'refresh_token',
              'expires_in',
              'refresh_expires_in',
              're_expires_in'
            ].includes(key)
          )
        : []
    };
    const secrets = [
      document.credentials.appKey,
      document.credentials.appSecret,
      document.credentials.accessToken,
      document.credentials.refreshToken
    ];
    let token: ReturnType<typeof parseAlibabaTokenResponse> | null = null;
    try {
      if (response.ok && !hasTokenError(value) && (protocol !== 'iop' || String(body?.code) === '0'))
        token = parseAlibabaTokenResponse(value);
    } catch {
      /* Invalid responses never replace configured credentials. */
    }
    let result: Record<string, unknown>;
    if (!token) {
      const failure = tokenRefreshFailure(response.status, value, secrets);
      result = { ok: false, error: { code: failure.code, message: failure.message, ...failure.diagnostics } };
      process.exitCode = 1;
    } else {
      const capturedAt = Date.now();
      const oauth = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? document.credentials.refreshToken,
        expiresAtUtc: credentialExpiryFromSeconds(capturedAt, token.expiresInSeconds),
        refreshExpiresAtUtc: credentialExpiryFromSeconds(capturedAt, token.refreshExpiresInSeconds)
      };
      document.authorization = document.authorization
        ? { ...document.authorization, capturedAtUtc: new Date(capturedAt).toISOString(), oauth }
        : null;
      document.credentials = {
        ...document.credentials,
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        accessTokenExpiresTimeUtc: oauth.expiresAtUtc === null ? null : Date.parse(oauth.expiresAtUtc),
        refreshTokenExpiresTimeUtc:
          oauth.refreshExpiresAtUtc === null ? null : Date.parse(oauth.refreshExpiresAtUtc)
      };
      // Persist a successful rotation BEFORE any subsequent real read; it must not be lost on read failure.
      await atomicWriteJson(resolve(directory, `${requestId}-refreshed-credentials.json`), document);
      result = {
        ok: true,
        expiresInSeconds: token.expiresInSeconds,
        refreshExpiresInSeconds: token.refreshExpiresInSeconds,
        readVerification: await credentialRead()
      };
    }
    const receipt = {
      requestId,
      protocol,
      endpoint,
      capturedAtUtc: new Date().toISOString(),
      ...shape,
      ...result,
      credentialsReplaced: false
    };
    await atomicWriteJson(resolve(directory, `${requestId}-receipt.json`), receipt);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
} catch {
  process.stderr.write(
    'Diagnostic did not complete; no configured credential was replaced. Check the local input and network.\n'
  );
  process.exitCode = 1;
} finally {
  database.connection.close();
}
