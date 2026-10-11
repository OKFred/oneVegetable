import { browser } from 'wxt/browser';
import { GatewayException } from '@one-vegetable/core/errors';
import { AlibabaIopTokenClient, IOP_API_ORIGIN, PUBLIC_AUTH_ORIGIN } from '@one-vegetable/core/alibaba-iop';
import { isRequestId } from '@one-vegetable/core/network';
import { isTrustedExtensionPageSender, type ExtensionRuntimeSenderIdentity } from './trusted-runtime-sender';
import { failure, IopAuthorizationController, isRecord, required, parseCallback } from './iop-authorization';

const controller = new IopAuthorizationController(
  browser.storage.local,
  new AlibabaIopTokenClient(),
  async (url) => {
    const tab = await browser.tabs.create({ url });
    if (tab.id === undefined) throw failure('AUTH_ACTION_FAILED');
    return tab.id;
  }
);
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) void controller.acceptCallback(change.url, tabId).catch(() => undefined);
});

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
    let data: unknown;
    switch (value.action) {
      case 'status':
        data = await controller.status();
        break;
      case 'start': {
        const callbackUrl = required(payload.callbackUrl);
        await requirePermissions(callbackUrl);
        await controller.start({
          appName: required(payload.appName),
          appKey: required(payload.appKey),
          appSecret: required(payload.appSecret),
          callbackUrl,
          passphrase: passphrase(payload.passphrase)
        });
        data = await controller.status();
        break;
      }
      case 'callback':
        await controller.acceptCallback(required(payload.url));
        data = await controller.status();
        break;
      case 'unlock':
        await controller.unlock(passphrase(payload.passphrase));
        data = await controller.status();
        break;
      case 'import':
        await controller.import(payload.bundle, passphrase(payload.passphrase));
        data = await controller.status();
        break;
      case 'refresh':
        await requirePermissions();
        await controller.refresh();
        data = await controller.status();
        break;
      case 'save':
        await controller.save();
        data = await controller.status();
        break;
      case 'export':
        data = await controller.export();
        break;
      case 'lock':
        controller.lock();
        data = await controller.status();
        break;
      case 'cancel':
        controller.cancel();
        data = await controller.status();
        break;
      case 'clear':
        await controller.clear();
        data = await controller.status();
        break;
      default:
        throw failure('AUTH_INPUT_INVALID');
    }
    return { requestId, ok: true, data };
  } catch (error) {
    const code = error instanceof GatewayException ? error.gatewayError.code : 'AUTH_ACTION_FAILED';
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
      const received = await controller.acceptCallback(url.href, sender.tab.id);
      return { ok: true, data: { received } };
    }
    throw failure('AUTH_INPUT_INVALID');
  } catch {
    return { ok: false, error: { code: 'AUTH_CALLBACK_NOT_ACCEPTED' } };
  }
}
async function requirePermissions(callbackUrl?: string): Promise<void> {
  const origins = [`${IOP_API_ORIGIN}/*`, ...(callbackUrl ? [`${parseCallback(callbackUrl).origin}/*`] : [])];
  if (!(await browser.permissions.contains({ origins }))) throw failure('AUTH_PERMISSION_REQUIRED');
}
function passphrase(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) throw failure('AUTH_INPUT_INVALID');
  return value;
}
