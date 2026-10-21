import { browser } from 'wxt/browser';
import { GatewayException } from '@one-vegetable/core/errors';
import { AlibabaIopTokenClient, IOP_API_ORIGIN, PUBLIC_AUTH_ORIGIN } from '@one-vegetable/core/alibaba-iop';
import { isRequestId } from '@one-vegetable/core/network';
import { isTrustedExtensionPageSender, type ExtensionRuntimeSenderIdentity } from './trusted-runtime-sender';
import {
  IopAuthorizationController,
  type AuthorizationStorage,
  type AuthorizationProtectionBridge
} from './iop-authorization';
import { failure, isRecord, required, parseCallback } from './authorization-input';
import { TopAuthorizationTokenClient } from './top-authorization-token-client';
import { IopApplicationReader, IOP_APPLICATION_READER_ORIGINS } from './iop-application-reader';
import { TOP_APPLICATION_READER_ORIGINS } from './iop-authorization-storage';
import { readTopApplication } from './top-application-reader';
import type { AuthorizationProtectionKey } from './authorization-protection';
import type { AlibabaOpenApiCredentialBundle } from '@one-vegetable/core/credential-bundle';

const applicationReader = new IopApplicationReader();
let protection:
  | (AuthorizationProtectionBridge & {
      status(): Promise<unknown>;
      prepareStatus(passphrase: string): Promise<unknown>;
    })
  | undefined;
export function configureAuthorizationProtection(bridge: NonNullable<typeof protection>): void {
  protection = bridge;
}
let applyWorkbenchBundle: ((bundle: AlibabaOpenApiCredentialBundle) => Promise<void>) | undefined;
export function configureAuthorizationWorkbench(apply: NonNullable<typeof applyWorkbenchBundle>): void {
  applyWorkbenchBundle = apply;
}
const sharedProtection: AuthorizationProtectionBridge = {
  async prepare(passphrase) {
    if (!protection) throw failure('AUTH_ACTION_FAILED');
    return protection.prepare(passphrase);
  },
  async adopt(vault) {
    if (!protection) throw failure('AUTH_ACTION_FAILED');
    await protection.adopt(vault);
  }
};

let storageAccessReady: Promise<void> | undefined;
function restrictLocalStorage(): Promise<void> {
  return (storageAccessReady ??= browser.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((error: unknown) => {
      storageAccessReady = undefined;
      throw error;
    }));
}
// Includes tab navigation and public callbacks, not only trusted page messages.
const trustedLocalStorage: AuthorizationStorage = {
  async get(key) {
    await restrictLocalStorage();
    return browser.storage.local.get(key);
  },
  async set(items) {
    await restrictLocalStorage();
    await browser.storage.local.set(items);
  },
  async remove(keys) {
    await restrictLocalStorage();
    await browser.storage.local.remove(keys);
  }
};

const controller = new IopAuthorizationController(
  trustedLocalStorage,
  new AlibabaIopTokenClient(),
  async (url) => {
    const tab = await browser.tabs.create({ url });
    if (tab.id === undefined) throw failure('AUTH_ACTION_FAILED');
    return tab.id;
  },
  Date.now,
  'iop',
  sharedProtection
);
const topController = new IopAuthorizationController(
  trustedLocalStorage,
  new TopAuthorizationTokenClient(),
  async (url) => {
    const tab = await browser.tabs.create({ url });
    if (tab.id === undefined) throw failure('AUTH_ACTION_FAILED');
    return tab.id;
  },
  Date.now,
  'top',
  sharedProtection
);
const controllers = { iop: controller, top: topController };
export async function rotateAuthorizationProtection(
  previousKey: string,
  next: AuthorizationProtectionKey,
  commit: (patch: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const releaseIop = controller.holdProtection();
  let releaseTop: (() => void) | undefined;
  try {
    releaseTop = topController.holdProtection();
    const patches = await Promise.all([
      controller.protectionUpdates(previousKey, next),
      topController.protectionUpdates(previousKey, next)
    ]);
    await commit(Object.assign({}, ...patches));
  } finally {
    releaseTop?.();
    releaseIop();
  }
}
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) void controller.acceptCallback(change.url, tabId).catch(() => undefined);
  if (change.url) void topController.acceptCallback(change.url, tabId).catch(() => undefined);
});

/** Never navigate a merchant page or put OAuth parameters in an extension URL. */
function callbackReturn(toolTabId: unknown, protocol: 'top' | 'iop'): () => Promise<void> {
  return async () => {
    let activated = false;
    let windowId: number | undefined;
    if (typeof toolTabId === 'number' && Number.isSafeInteger(toolTabId) && toolTabId >= 0) {
      try {
        // Tab URLs are redacted without the broad "tabs" permission. Query only
        // this extension's own contexts instead of requesting browsing access.
        const [context] = await browser.runtime.getContexts({ contextTypes: ['TAB'], tabIds: [toolTabId] });
        if (
          context &&
          isTrustedExtensionPageSender(
            { id: browser.runtime.id, url: context.documentUrl ?? '' },
            browser.runtime.id,
            browser.runtime.getURL('/authorization.html')
          ) &&
          (new URL(context.documentUrl ?? '').searchParams.get('protocol') === 'top' ? 'top' : 'iop') ===
            protocol
        ) {
          await browser.tabs.update(toolTabId, { active: true });
          windowId = context.windowId;
          activated = true;
        }
      } catch {
        // The initiating tab may have been closed. Open a clean result page instead.
      }
    }
    if (!activated) {
      const tab = await browser.tabs.create({
        url: browser.runtime.getURL(`/authorization.html?protocol=${protocol}`),
        active: true
      });
      windowId = tab.windowId;
    }
    if (windowId !== undefined)
      await browser.windows.update(windowId, { focused: true }).catch(() => undefined);
  };
}

/** Shared workbench manual lock; standalone lock affects only its chosen protocol. */
export async function lockAllAlibabaAuthorizations(): Promise<void> {
  const results = await Promise.allSettled([controller.lock(), topController.lock()]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Called only by the trusted workbench's explicit clear-all-data workflow. */
export async function resetIopAuthorization(): Promise<void> {
  await controller.clear();
  await topController.clear();
}

export async function handleAuthorization(
  value: unknown,
  sender: ExtensionRuntimeSenderIdentity
): Promise<unknown> {
  let requestId = crypto.randomUUID() as string;
  try {
    if (!isRecord(value) || value.kind !== 'iop-authorization-request' || !isRequestId(value.requestId))
      throw failure('INVALID_REQUEST_ID');
    requestId = value.requestId;
    if (
      !isTrustedExtensionPageSender(sender, browser.runtime.id, browser.runtime.getURL('/authorization.html'))
    )
      throw failure('AUTH_ORIGIN_DENIED');
    const payload = isRecord(value.payload) ? value.payload : {};
    const protocol = value.protocol === undefined ? 'iop' : value.protocol;
    if (protocol !== 'top' && protocol !== 'iop') throw failure('AUTH_INPUT_INVALID');
    const selected = controllers[protocol];
    let data: unknown;
    switch (value.action) {
      case 'protection-status':
        if (!protection) throw failure('AUTH_ACTION_FAILED');
        // Restore/adopt a previously unlocked standalone key before requesting setup again.
        await selected.status();
        data = await protection.status();
        break;
      case 'prepare-protection':
        if (!protection) throw failure('AUTH_ACTION_FAILED');
        data = await protection.prepareStatus(passphrase(payload.passphrase));
        break;
      case 'discover-application':
        if (
          !(await browser.permissions.contains({
            origins: [
              ...(protocol === 'iop' ? IOP_APPLICATION_READER_ORIGINS : TOP_APPLICATION_READER_ORIGINS)
            ]
          }))
        )
          throw failure('AUTH_PERMISSION_REQUIRED');
        data = protocol === 'iop' ? await applicationReader.read() : await readTopApplication();
        break;
      case 'status':
        data = await selected.status();
        break;
      case 'start': {
        const callbackUrl = required(payload.callbackUrl);
        await requirePermissions(protocol, callbackUrl);
        await selected.start(
          {
            appName: required(payload.appName),
            appKey: required(payload.appKey),
            appSecret: required(payload.appSecret),
            callbackUrl,
            passphrase: passphrase(payload.passphrase)
          },
          callbackReturn(value.toolTabId, protocol)
        );
        data = await selected.status();
        break;
      }
      case 'reauthorize':
        await selected.status();
        await requirePermissions(protocol, selected.callbackUrl());
        await selected.reauthorize(callbackReturn(value.toolTabId, protocol));
        data = await selected.status();
        break;
      case 'callback':
        await selected.acceptCallback(required(payload.url));
        data = await selected.status();
        break;
      case 'unlock':
        await selected.unlock(passphrase(payload.passphrase));
        data = await selected.status();
        break;
      case 'import':
        await selected.import(payload.bundle, passphrase(payload.passphrase));
        data = await selected.status();
        break;
      case 'refresh':
        await requirePermissions(protocol);
        await selected.refresh();
        data = await selected.status();
        break;
      case 'save':
        await selected.save();
        data = await selected.status();
        break;
      case 'export':
        data = await selected.export();
        break;
      case 'apply-to-workbench': {
        const apply = applyWorkbenchBundle;
        if (!apply) throw failure('AUTH_ACTION_FAILED');
        // Check the business origin, not the token endpoint. Denial must not change either store.
        if (
          !(await browser.permissions.contains({
            origins: [`${protocol === 'iop' ? IOP_API_ORIGIN : 'https://eco.taobao.com'}/*`]
          }))
        )
          throw failure('AUTH_PERMISSION_REQUIRED');
        await selected.applyToWorkbench(apply);
        data = { applied: true, protocol };
        break;
      }
      case 'lock':
        await selected.lock();
        data = await selected.status();
        break;
      case 'cancel':
        selected.cancel();
        data = await selected.status();
        break;
      case 'clear':
        await selected.clear();
        data = await selected.status();
        break;
      default:
        throw failure('AUTH_INPUT_INVALID');
    }
    return { requestId, ok: true, data };
  } catch (error) {
    const code =
      error instanceof GatewayException
        ? error.gatewayError.code
        : isRecord(error) &&
            typeof error.code === 'string' &&
            /^PASSPHRASE_TOO_(SHORT|LONG)$/u.test(error.code)
          ? error.code
          : error instanceof Error && /^CREDENTIAL_VAULT_(LOCKED|INVALID)$/u.test(error.message)
            ? error.message
            : 'AUTH_ACTION_FAILED';
    return { requestId, ok: false, error: { code, message: code, retryable: false } };
  }
}

export async function handlePublicAuthorization(
  value: unknown,
  sender: { url?: string | undefined; tab?: { id?: number | undefined } | undefined }
): Promise<unknown> {
  if (!isRecord(value) || value.kind !== 'one-vegetable-public-auth' || !isRequestId(value.requestId))
    return { ok: false };
  try {
    const url = new URL(sender.url ?? '');
    if (url.origin !== PUBLIC_AUTH_ORIGIN) throw failure('AUTH_ORIGIN_DENIED');
    if (value.action === 'probe') return { ok: true, data: { protocol: 'iop', supported: true } };
    if (value.action === 'open' && url.pathname !== '/callback') {
      await browser.tabs.create({ url: browser.runtime.getURL('/authorization.html') });
      return { ok: true, data: { opened: true } };
    }
    if (value.action === 'callback' && url.pathname === '/callback' && sender.tab?.id !== undefined) {
      // Only this tab's exact registered callback plus task-bound state can consume a code.
      url.search = '';
      url.searchParams.set('state', required(value.state));
      if (typeof value.error === 'string') url.searchParams.set('error', 'provider-error');
      else url.searchParams.set('code', required(value.code));
      const received =
        (await controller.acceptCallback(url.href, sender.tab.id)) ||
        (await topController.acceptCallback(url.href, sender.tab.id));
      return { ok: true, data: { received } };
    }
    throw failure('AUTH_INPUT_INVALID');
  } catch {
    return { ok: false, error: { code: 'AUTH_CALLBACK_NOT_ACCEPTED' } };
  }
}
async function requirePermissions(protocol: 'top' | 'iop', callbackUrl?: string): Promise<void> {
  const origins = [
    `${protocol === 'top' ? 'https://oauth.alibaba.com' : IOP_API_ORIGIN}/*`,
    ...(callbackUrl ? [`${parseCallback(callbackUrl).origin}/*`] : [])
  ];
  if (!(await browser.permissions.contains({ origins }))) throw failure('AUTH_PERMISSION_REQUIRED');
}
function passphrase(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) throw failure('AUTH_INPUT_INVALID');
  return value;
}
