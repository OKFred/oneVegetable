import { describe, expect, it } from 'vitest';

import { PAGE_IDS, pageHash, parsePageHash } from '../src/lib/hash-router';

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

  it.each(['', '#', '#products', '#/', '#/unknown', '#/products/details'])(
    'rejects invalid hash %s',
    (hash) => {
      expect(parsePageHash(hash)).toBeNull();
    }
  );
});
