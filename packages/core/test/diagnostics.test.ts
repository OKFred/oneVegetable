import { describe, expect, it } from 'vitest';

import { sanitizeDiagnosticMessage } from '../src/diagnostics';

describe('sanitizeDiagnosticMessage', () => {
  it('removes URLs, credentials and long token-shaped values', () => {
    const result = sanitizeDiagnosticMessage(
      'POST https://user:pass@example.com/path?access_token=visible appSecret=top-secret ' +
        'session: session-value authorization=BearerValue ' +
        'abcdefghijklmnopqrstuvwxyz0123456789 operation failed'
    );

    expect(result).not.toContain('example.com');
    expect(result).not.toContain('top-secret');
    expect(result).not.toContain('session-value');
    expect(result).not.toContain('BearerValue');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result).toContain('[url]');
    expect(result).toContain('appSecret=[redacted]');
    expect(result).toContain('operation failed');
  });

  it('limits persisted messages to 300 characters', () => {
    expect(sanitizeDiagnosticMessage('message '.repeat(100))).toHaveLength(300);
  });
});
