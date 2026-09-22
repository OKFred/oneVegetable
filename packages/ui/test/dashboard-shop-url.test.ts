// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllDashboardShopUrls,
  dashboardShopScope,
  DASHBOARD_SHOP_URL_STORAGE_PREFIX,
  loadDashboardShopUrl,
  normalizeAlibabaShopUrl,
  removeDashboardShopUrl,
  saveDashboardShopUrl
} from '../src/lib/dashboard-shop-url';

beforeEach(() => {
  localStorage.clear();
});

describe('dashboard shop URL local preference', () => {
  it('normalizes official HTTPS URLs and does not guess a store from product data', () => {
    expect(normalizeAlibabaShopUrl(' https://Example.en.alibaba.com/ ')).toBe(
      'https://example.en.alibaba.com/'
    );
    expect(normalizeAlibabaShopUrl('https://example.en.alibaba.com/company_profile.html')).toBe(
      'https://example.en.alibaba.com/company_profile.html'
    );
    expect(loadDashboardShopUrl(localStorage, 'unconfigured')).toBeNull();
  });

  it.each([
    'http://example.en.alibaba.com/',
    'javascript:alert(1)',
    'https://alibaba.com.evil.test/',
    'https://evilalibaba.com/',
    'https://user:pass@example.en.alibaba.com/',
    'https://example.en.alibaba.com:8443/',
    'https://example.en.alibaba.com/?token=private',
    'https://example.en.alibaba.com/#private',
    'https://example.en.alibaba.com\\@evil.test/',
    'https://example.en.ali\nbaba.com/'
  ])('rejects unsafe or credential-bearing URL %s', (url) => {
    expect(normalizeAlibabaShopUrl(url)).toBeNull();
    expect(() => saveDashboardShopUrl(localStorage, 'account', url)).toThrow('DASHBOARD_SHOP_URL_INVALID');
    expect(localStorage.length).toBe(0);
  });

  it('isolates mode, account and credential configuration but not S3 configuration', () => {
    const context = { identity: 'opaque-user-a', gateway: 'opaque-account-a', storage: 's3-a' };
    const scope = dashboardShopScope('bff', context);
    saveDashboardShopUrl(localStorage, scope, 'https://example.en.alibaba.com');
    expect(
      loadDashboardShopUrl(localStorage, dashboardShopScope('bff', { ...context, storage: 's3-b' }))
    ).toBe('https://example.en.alibaba.com/');
    expect(loadDashboardShopUrl(localStorage, dashboardShopScope('extension', context))).toBeNull();
    expect(
      loadDashboardShopUrl(localStorage, dashboardShopScope('bff', { ...context, identity: 'opaque-user-b' }))
    ).toBeNull();
    expect(
      loadDashboardShopUrl(
        localStorage,
        dashboardShopScope('bff', { ...context, gateway: 'opaque-account-b' })
      )
    ).toBeNull();
    removeDashboardShopUrl(localStorage, scope);
    expect(loadDashboardShopUrl(localStorage, scope)).toBeNull();
  });

  it('rejects damaged/old records and clears only shop-link preferences', () => {
    const key = DASHBOARD_SHOP_URL_STORAGE_PREFIX + 'a';
    for (const raw of [
      '{',
      'null',
      '{"version":2,"url":"https://example.en.alibaba.com"}',
      '{"version":1,"url":"https://evil.test"}'
    ]) {
      localStorage.setItem(key, raw);
      expect(loadDashboardShopUrl(localStorage, 'a')).toBeNull();
    }
    saveDashboardShopUrl(localStorage, 'b', 'https://example.en.alibaba.com');
    localStorage.setItem('one-vegetable:columns:v2:products', 'keep');
    clearAllDashboardShopUrls(localStorage);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(DASHBOARD_SHOP_URL_STORAGE_PREFIX + 'b')).toBeNull();
    expect(localStorage.getItem('one-vegetable:columns:v2:products')).toBe('keep');
  });
});
