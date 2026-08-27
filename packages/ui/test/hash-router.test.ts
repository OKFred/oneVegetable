import { describe, expect, it } from 'vitest';

import { PAGE_IDS, pageHash, parseAppHash, parsePageHash } from '../src/lib/hash-router';

describe('hash router', () => {
  it('round-trips every application page', () => {
    for (const page of PAGE_IDS) {
      expect(parsePageHash(pageHash(page))).toBe(page);
    }
  });

  it('accepts a trailing slash and ignores hash query parameters', () => {
    expect(parsePageHash('#/products/')).toBe('products');
    expect(parsePageHash('#/orders?source=dashboard')).toBe('orders');
  });

  it('keeps the page identity for deep routes', () => {
    expect(parsePageHash('#/products/details')).toBe('products');
    expect(parseAppHash('#/products/details')).toEqual({ page: 'products', segments: ['details'] });
  });

  it.each(['', '#', '#products', '#/', '#/unknown', '#/products/%E0%A4%A'])(
    'rejects invalid hash %s',
    (hash) => {
      expect(parsePageHash(hash)).toBeNull();
    }
  );
});
