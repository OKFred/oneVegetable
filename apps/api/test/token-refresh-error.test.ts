import { describe, expect, it } from 'vitest';
import fixture from '../../../mock/data/alibaba-token-errors.json';
import { hasTokenError, parseTokenBody, tokenRefreshFailure } from '../src/gateway/token-refresh-error';

const secrets = ['fixture-secret', 'fixture-access', 'fixture-refresh'];

describe('token refresh diagnostics', () => {
  it('keeps OAuth error identifiers and trace but never echoed credentials', () => {
    const error = tokenRefreshFailure(400, fixture.oauth, secrets);
    expect(error.code).toBe('ALIBABA_TOKEN_REFRESH_FAILED');
    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('invalid_grant');
    expect(error.diagnostics).toEqual({ subCode: 'invalid_grant', traceId: 'fixture-request-123' });
    for (const secret of secrets) expect(error.message).not.toContain(secret);
  });
  it('reads only whitelisted TOP errors, not the full response', () => {
    const error = tokenRefreshFailure(200, fixture.top, secrets);
    expect(error.diagnostics).toEqual({
      subCode: 'isv.invalid-refresh-token',
      traceId: 'fixture-top-request'
    });
    expect(hasTokenError(fixture.top)).toBe(true);
  });
  it('rejects injected identifiers and strips secrets, URLs, markup and personal data', () => {
    const error = tokenRefreshFailure(400, fixture.malicious, secrets);
    expect(error.diagnostics).toEqual({});
    expect(error.message).not.toMatch(/fixture-(secret|access|refresh)|https:|user@|<script>|never-return/);
    expect(error.message).not.toContain('\n');
  });
  it('handles non-JSON and malformed responses without exposing body content', () => {
    expect(parseTokenBody('<html>private-response</html>')).toBeNull();
    expect(parseTokenBody(undefined)).toBeNull();
    expect(tokenRefreshFailure(502, null, secrets).message).not.toContain('private-response');
    expect(hasTokenError(null)).toBe(false);
    expect(hasTokenError(parseTokenBody(JSON.stringify(fixture.oauth)))).toBe(true);
  });
});
