import { describe, expect, it } from 'vitest';

import { splitUserVisibleErrorMessages } from '../src/errors';

describe('user-visible errors', () => {
  it('splits and deduplicates Alibaba semicolon-separated reasons', () => {
    expect(
      splitUserVisibleErrorMessages(
        'Product title is required; Main image is required；Product title is required\nInvalid price'
      )
    ).toEqual(['Product title is required', 'Main image is required', 'Invalid price']);
  });

  it('keeps a normal single message intact', () => {
    expect(splitUserVisibleErrorMessages('Alibaba API 返回错误')).toEqual(['Alibaba API 返回错误']);
  });
});
