import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';

/** A public URL preference only; never store credentials or raw account identifiers here. */
export const DASHBOARD_SHOP_URL_STORAGE_PREFIX = 'one-vegetable:dashboard-shop-url:v1:';

export function dashboardShopScope(
  mode: 'mock' | 'extension' | 'bff',
  context: GalleryTransferContext
): string {
  // Storage configuration and refreshed access tokens do not identify a shop.
  return encodeURIComponent(JSON.stringify([mode, context.identity, context.gateway]));
}

export function normalizeAlibabaShopUrl(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048 || /[\p{Cc}\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !(url.hostname === 'alibaba.com' || url.hostname.endsWith('.alibaba.com'))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function loadDashboardShopUrl(storage: Storage, scope: string): string | null {
  const raw = storage.getItem(DASHBOARD_SHOP_URL_STORAGE_PREFIX + scope);
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !('version' in data) ||
      data.version !== 1 ||
      !('url' in data) ||
      typeof data.url !== 'string'
    )
      return null;
    return normalizeAlibabaShopUrl(data.url);
  } catch {
    return null;
  }
}

export function saveDashboardShopUrl(storage: Storage, scope: string, input: string): string {
  const url = normalizeAlibabaShopUrl(input);
  if (!url) throw new Error('DASHBOARD_SHOP_URL_INVALID');
  storage.setItem(DASHBOARD_SHOP_URL_STORAGE_PREFIX + scope, JSON.stringify({ version: 1, url }));
  return url;
}

export function removeDashboardShopUrl(storage: Storage, scope: string): void {
  storage.removeItem(DASHBOARD_SHOP_URL_STORAGE_PREFIX + scope);
}

/** Wire into clear-all local data. This never changes the store or any platform settings. */
export function clearAllDashboardShopUrls(storage: Storage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(DASHBOARD_SHOP_URL_STORAGE_PREFIX)) storage.removeItem(key);
  }
}
