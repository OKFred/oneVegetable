import { describe, expect, it } from 'vitest';

import { isPhotoBankUrl, sanitizeProductDescriptionHtml } from '../src/product-description';

describe('product description HTML sanitizer', () => {
  it('runs without browser DOM globals so Node and Workers share the same sanitizer', () => {
    expect(globalThis.DOMParser).toBeUndefined();
    expect(sanitizeProductDescriptionHtml('<p>Portable</p>').html).toBe('<p>Portable</p>');
  });

  it('keeps the fixed safe tag set and removes scripts, event handlers, styles and unknown wrappers', () => {
    const result = sanitizeProductDescriptionHtml(
      '<div class="legacy"><h2 style="color:red" onclick="alert(1)">Title</h2><script>alert(1)</script><p><strong>Safe</strong></p></div>'
    );
    expect(result.html).toBe('<h2>Title</h2><p><strong>Safe</strong></p>');
    expect(result.supported).toBe(false);
    expect(result.changes.map((change) => change.type)).toEqual([
      'unwrapped-element',
      'removed-attribute',
      'removed-attribute',
      'removed-element'
    ]);
  });

  it('secures HTTP(S) links and removes unsafe protocols', () => {
    const safe = sanitizeProductDescriptionHtml('<p><a href="https://example.com">More</a></p>');
    expect(safe.html).toContain('rel="nofollow noopener noreferrer"');
    expect(safe.html).toContain('target="_blank"');
    const unsafe = sanitizeProductDescriptionHtml('<a href="javascript:alert(1)">Bad</a>');
    expect(unsafe.html).toBe('<a>Bad</a>');
  });

  it('only keeps PhotoBank images and retains the known internal file ID association', () => {
    expect(isPhotoBankUrl('https://sc04.alicdn.com/kf/detail.jpg')).toBe(true);
    expect(isPhotoBankUrl('https://images.example.com/detail.jpg')).toBe(false);
    const result = sanitizeProductDescriptionHtml(
      '<img src="https://sc04.alicdn.com/kf/detail.jpg" alt="Detail" data-photobank-file-id="ph_1"><img src="https://images.example.com/external.jpg">'
    );
    expect(result.html).toBe(
      '<img src="https://sc04.alicdn.com/kf/detail.jpg" alt="Detail" data-photobank-file-id="ph_1">'
    );
    expect(result.changes).toHaveLength(1);
  });

  it('preserves supported headings, lists, quotes and tables without changes', () => {
    const html =
      '<h2>Overview</h2><ul><li>One</li></ul><blockquote>Note</blockquote><table><tbody><tr><th colspan="2">Spec</th></tr><tr><td>A</td><td>B</td></tr></tbody></table><hr>';
    const result = sanitizeProductDescriptionHtml(html);
    expect(result.supported).toBe(true);
    expect(result.html).toBe(html);
  });
});
