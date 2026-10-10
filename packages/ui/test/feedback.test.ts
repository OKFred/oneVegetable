import { describe, expect, it } from 'vitest';

import {
  browserSummary,
  buildGitHubFeedbackUrl,
  formatFeedbackEnvironment,
  normalizeFeedbackRoute,
  operatingSystemSummary
} from '../src/lib/feedback';

const environment = {
  appVersion: '2.1.0',
  capturedAtUtc: '2026-09-02T03:04:05.000Z',
  devicePixelRatio: 1.25,
  mode: 'extension' as const,
  route: '#/products?productId=secret-product',
  theme: 'dark' as const,
  uiLocale: 'zh-CN' as const,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  viewportHeight: 900,
  viewportWidth: 1440
};

describe('GitHub feedback', () => {
  it('prefills only safe environment metadata and leaves feedback for the user', () => {
    const result = new URL(buildGitHubFeedbackUrl(environment));

    expect(result.origin + result.pathname).toBe('https://github.com/OKFred/oneVegetable/issues/new');
    expect(result.searchParams.get('template')).toBe('feedback.yml');
    expect([...result.searchParams.keys()]).toEqual(['template', 'environment']);
    expect(result.searchParams.get('environment')).toContain('Route: #/products');
    expect(result.href).not.toContain('secret-product');
  });

  it('limits environment data to a coarse browser, OS and hash route summary', () => {
    expect(formatFeedbackEnvironment(environment)).toBe(
      [
        'oneVegetable: 2.1.0',
        'Mode: extension',
        'Route: #/products',
        'UI locale: zh-CN',
        'Theme: dark',
        'Browser: Chrome 140',
        'OS: Windows',
        'Viewport: 1440 × 900 @ 1.25x',
        'Captured at (UTC): 2026-09-02T03:04:05.000Z'
      ].join('\n')
    );
    expect(browserSummary('Mozilla/5.0 Edg/141.0')).toBe('Edge 141');
    expect(operatingSystemSummary('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    expect(normalizeFeedbackRoute('https://bad.example/products?id=1')).toBe('#/dashboard');
  });

  it('refuses oversized prefill URLs instead of silently dropping feedback', () => {
    expect(() => buildGitHubFeedbackUrl({ ...environment, appVersion: 'a'.repeat(16_000) })).toThrow(
      'FEEDBACK_URL_TOO_LONG'
    );
  });
});
