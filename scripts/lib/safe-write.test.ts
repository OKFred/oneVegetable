import { describe, expect, it } from 'vitest';

import { isRetryableWindowsWriteError } from './safe-write';

describe('safe Windows file writes', () => {
  it.each(['EACCES', 'EBUSY', 'EPERM', 'UNKNOWN'])('retries transient %s errors', (code) => {
    expect(isRetryableWindowsWriteError(Object.assign(new Error('locked'), { code }))).toBe(true);
  });

  it('does not retry permanent or malformed errors', () => {
    expect(isRetryableWindowsWriteError(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(false);
    expect(isRetryableWindowsWriteError(new Error('missing code'))).toBe(false);
    expect(isRetryableWindowsWriteError(null)).toBe(false);
  });
});
