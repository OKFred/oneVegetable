/** Formal MV3 runtime, four isolated encrypted profiles. No user profile/config is touched. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { GatewayException } from '../packages/core/src/errors';
import { ONBOARDING_STORAGE_KEY, completeOnboarding } from '../packages/core/src/privacy';
import type { GatewayClient, ResponseOf } from '../packages/core/src/types';
import { atomicWriteJson } from './openapi-auth/storage';
import { buildDigest } from './smoke-iop-workbench-real';
import { parseModeOptions, readModeBundles } from './smoke-authorization-modes-real';
import {
  isRow,
  profiles,
  runReadPlan,
  type Row,
  type Observation
} from './lib/authorization-mode-regression';
import { ReadWireGuard } from './lib/authorization-mode-wire';
import { exerciseModeMenus } from './lib/authorization-mode-ui';

async function send(page: Page, message: Row) {
  const result: unknown = await page.evaluate(
    (input) =>
      (
        globalThis as unknown as { chrome: { runtime: { sendMessage(input: unknown): Promise<unknown> } } }
      ).chrome.runtime.sendMessage(input),
    message
  );
  if (!isRow(result) || result.requestId !== message.requestId || typeof result.ok !== 'boolean')
    throw new Error('RUNTIME_CORRELATION_INVALID');
  if (!result.ok) {
    if (!isRow(result.error) || typeof result.error.code !== 'string')
      throw new Error('RUNTIME_ERROR_INVALID');
    throw new GatewayException(
      {
        ...result.error,
        code: result.error.code,
        message: typeof result.error.message === 'string' ? result.error.message : result.error.code,
        retryable: false
      },
      String(message.requestId)
    );
  }
  return result.data;
}
async function main() {
  const options = parseModeOptions(process.argv.slice(2)),
    bundles = await readModeBundles(options);
  const source = resolve('apps/extension/.output/chrome-mv3'),
    digest = await buildDigest(source);
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  const directory = await mkdtemp(resolve(dirname(options.output), 'mode-profiles-'));
  const extension = resolve(directory, 'extension');
  await cp(source, extension, { recursive: true, errorOnExist: true, force: false });
  assert.equal(await buildDigest(extension), digest);
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')) as Row;
  assert(Array.isArray(manifest.host_permissions));
  const hosts: unknown[] = manifest.host_permissions;
  // Only this disposable copy pregrants exact provider hosts. Native permission UX is not claimed.
  manifest.host_permissions = [
    ...new Set([
      ...hosts.filter((value): value is string => typeof value === 'string'),
      'https://openapi-api.alibaba.com/*'
    ])
  ];
  await atomicWriteJson(resolve(extension, 'manifest.json'), manifest);
  const results = [];
  const uiOnly = process.argv.includes('--ui-only');
  for (const mode of options.modes) {
    const guard = new ReadWireGuard(),
      observations: Observation[] = [];
    const uiGuards = new Map<string, ReadWireGuard>();
    let routeTail: Promise<unknown> = Promise.resolve(),
      routeStarted = 0,
      routeCount = 0;
    const context = await chromium.launchPersistentContext(resolve(directory, mode), {
      headless: false,
      locale: 'zh-CN',
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
    });
    try {
      await context.addInitScript({ content: 'globalThis.__name = (value) => value;' });
      await context.addInitScript(
        ({ key, value }) => {
          localStorage.setItem(key, JSON.stringify(value));
        },
        {
          key: ONBOARDING_STORAGE_KEY,
          value: completeOnboarding()
        }
      );
      await context.route(/^https?:\/\//u, async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (!['https://eco.taobao.com', 'https://openapi-api.alibaba.com'].includes(url.origin)) {
          await route.abort('blockedbyclient');
          return;
        }
        try {
          assert(request.serviceWorker(), 'Provider requests must originate in the trusted worker.');
          const input = new Request(request.url(), {
            method: request.method(),
            headers: request.headers(),
            body: request.postDataBuffer()?.toString('utf8') ?? null
          });
          const currentGuard = uiGuards.get(request.headers()['x-request-id'] ?? '') ?? guard;
          const execute = async () =>
            currentGuard.send(input, async () => {
              if (++routeCount > 300) throw new Error('UI_READ_LIMIT_EXCEEDED');
              await new Promise<void>((done) =>
                setTimeout(done, Math.max(0, 350 - (Date.now() - routeStarted)))
              );
              routeStarted = Date.now();
              await route.continue();
              const response = await request.response();
              if (!response) throw new Error('PROVIDER_RESPONSE_MISSING');
              return new Response(null, { status: response.status() });
            });
          const sent = routeTail.then(execute);
          routeTail = sent.catch(() => undefined);
          await sent;
        } catch {
          await route.abort('blockedbyclient').catch(() => undefined);
        }
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await worker.evaluate('globalThis.__name = (value) => value;');
      await worker.evaluate(
        async ({ key, value }) => {
          await (
            globalThis as unknown as { chrome: { storage: { local: { set(value: Row): Promise<void> } } } }
          ).chrome.storage.local.set({ [key]: value });
        },
        { key: ONBOARDING_STORAGE_KEY, value: completeOnboarding() }
      );
      const page = await context.newPage();
      await page.goto('chrome-extension://' + new URL(worker.url()).host + '/options.html#/releases');
      const protocols = profiles(mode);
      for (const [index, protocol] of protocols.entries()) {
        const bundle = bundles[protocol];
        const settings = {
          protocol,
          appKey: bundle.application.appKey,
          appSecret: bundle.application.appSecret,
          accessToken: bundle.oauth.accessToken,
          ...(bundle.oauth.expiresAtUtc
            ? { accessTokenExpiresTimeUtc: Date.parse(bundle.oauth.expiresAtUtc) }
            : {}),
          endpoint:
            protocol === 'top'
              ? 'https://eco.taobao.com/router/rest'
              : 'https://openapi-api.alibaba.com/rest',
          signMethod: 'hmac-sha256'
        };
        await send(page, {
          kind: 'credential-vault-request',
          requestId: randomUUID(),
          operation: index === 0 ? 'create' : 'save',
          payload: index === 0 ? { passphrase: randomBytes(32).toString('base64url'), settings } : settings
        });
      }
      const summary = () =>
        send(page, {
          kind: 'credential-vault-request',
          operation: 'authorizations',
          requestId: randomUUID()
        });
      const before = await summary();
      assert(isRow(before));
      assert.equal(before.defaultProtocol, protocols[0]);
      assert.equal(Boolean(before.top), protocols.includes('top'));
      assert.equal(Boolean(before.iop), protocols.includes('iop'));
      const gateway: GatewayClient = {
        async galleryTransferContext(operation, payload) {
          return (await send(page, {
            kind: 'gallery-transfer-context',
            requestId: randomUUID(),
            operation,
            payload
          })) as Awaited<ReturnType<NonNullable<GatewayClient['galleryTransferContext']>>>;
        },
        async request(operation, payload, requestOptions) {
          return (await send(page, {
            kind: 'gateway-request',
            operation,
            payload,
            requestId: requestOptions?.requestId ?? randomUUID(),
            ...(requestOptions?.galleryContext ? { galleryContext: requestOptions.galleryContext } : {})
          })) as ResponseOf<typeof operation>;
        }
      };
      if (!uiOnly) await runReadPlan(mode, gateway, guard, observations, options);
      const menus = uiOnly ? await exerciseModeMenus(page, mode, uiGuards, observations) : null;
      if (menus) {
        assert(
          observations.length > 0,
          'Actual app reads must be observed; onboarding is not menu acceptance.'
        );
        assert(menus.pages.every((item) => item.heading && item.completed));
        assert.equal(menus.scriptErrors.length, 0);
      }
      assert.deepEqual(await summary(), before, 'Read acceptance must preserve both slots and default.');
      results.push({
        menus,
        mode,
        runtime: 'formal-mv3',
        profilesPreserved: true,
        observations,
        network: guard.snapshot()
      });
    } finally {
      await context.close();
    }
    assert.equal(await buildDigest(source), digest, 'Production build must remain unchanged.');
    await atomicWriteJson(resolve(options.output), {
      schemaVersion: 1,
      runtime: 'formal-mv3',
      capturedAtUtc: new Date().toISOString(),
      readOnly: true,
      nativePermissionConsentTested: false,
      productionManifestUnchanged: true,
      results
    });
    const result = results.at(-1);
    assert(result);
    console.log(
      JSON.stringify({
        mode,
        statuses: observations.reduce<Record<string, number>>(
          (all, item) => ({ ...all, [item.status]: (all[item.status] ?? 0) + 1 }),
          {}
        ),
        failures: result.observations.filter((item) => ['failed', 'credential-blocked'].includes(item.status))
      })
    );
  }
  if (
    results.some((result) =>
      result.observations.some((item) => ['failed', 'credential-blocked'].includes(item.status))
    )
  )
    process.exitCode = 1;
}
await main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      failure: 'MV3_AUTHORIZATION_MODE_REGRESSION_FAILED',
      kind: error instanceof Error ? error.name : 'unknown',
      detail:
        error instanceof Error && /^UI_MENU_[A-Z0-9_:]+$/iu.test(error.message) ? error.message : undefined,
      location:
        error instanceof Error
          ? error.stack
              ?.split('\n')
              .slice(1, 4)
              .filter((line) => line.includes('authorization-mode'))
          : []
    })
  );
  process.exitCode = 1;
});
