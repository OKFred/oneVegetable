import { browser } from 'wxt/browser';

const guides = new Map<number, { protocol: 'top' | 'iop' | null; expiresAt: number }>();
const GUIDE_LIFETIME = 10 * 60 * 1000;

/** Only a worker-initiated guide can request navigation. Never accept a destination URL. */
export function registerAuthorizationGuide(tabId: number, protocol: 'top' | 'iop' | null): void {
  const now = Date.now();
  for (const [id, guide] of guides) if (guide.expiresAt <= now) guides.delete(id);
  guides.set(tabId, { protocol, expiresAt: now + GUIDE_LIFETIME });
}

export function forgetAuthorizationGuide(tabId: number): void {
  guides.delete(tabId);
}

export async function returnFromAuthorizationGuide(sender: {
  id?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
}): Promise<{ ok: boolean }> {
  const tabId = sender.tab?.id;
  const guide = tabId === undefined ? undefined : guides.get(tabId);
  if (!guide || guide.expiresAt <= Date.now() || sender.id !== browser.runtime.id || sender.frameId !== 0)
    return { ok: false };
  try {
    const source = new URL(sender.url ?? '');
    if (
      !(source.origin === 'https://i.alibaba.com' && source.pathname === '/explore/open-api') &&
      !(
        guide.protocol === null &&
        source.origin === 'https://openapi-account.alibaba.com' &&
        source.pathname === '/profile'
      )
    )
      return { ok: false };
    if (guide.protocol === null) {
      await browser.runtime.openOptionsPage();
      return { ok: true };
    }
    const tool = browser.runtime.getURL('/authorization.html');
    const contexts = await browser.runtime.getContexts({ contextTypes: ['TAB'] });
    const existing = contexts.find((context) => {
      const url = new URL(context.documentUrl ?? 'about:blank');
      return (
        url.protocol === 'chrome-extension:' &&
        url.host === browser.runtime.id &&
        url.pathname === '/authorization.html' &&
        (url.searchParams.get('protocol') === 'top' ? 'top' : 'iop') === guide.protocol
      );
    });
    if (existing && existing.tabId >= 0) {
      await browser.tabs.update(existing.tabId, { active: true });
      await browser.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
    } else {
      await browser.tabs.create({ url: `${tool}?protocol=${guide.protocol}`, active: true });
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
