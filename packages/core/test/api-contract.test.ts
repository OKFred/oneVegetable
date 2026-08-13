import { describe, expect, it } from 'vitest';

import { DEFAULT_API_PREFIX, normalizeApiPrefix } from '../src/api-contract';

describe('normalizeApiPrefix', () => {
  it('uses the versioned default and preserves a valid explicit prefix', () => {
    expect(normalizeApiPrefix(undefined)).toBe(DEFAULT_API_PREFIX);
    expect(normalizeApiPrefix('/internal/api/v2')).toBe('/internal/api/v2');
  });

  it.each(['api/v1', '/', '/api/v1/', '/api//v1', '/api/../v1', '/api/v1?q=1', '/api/v1#x'])(
    'rejects invalid prefix %s',
    (prefix) => {
      expect(() => normalizeApiPrefix(prefix)).toThrow('API prefix 无效');
    }
  );
});
