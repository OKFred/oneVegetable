import { describe, expect, it } from 'vitest';
import { authorizationStatusPollDelay } from '../lib/authorization-status';

describe('authorization tool status observation', () => {
  it.each(['ready', 'locked', 'empty', 'unknown'] as const)(
    'observes visible %s state but lets a hidden idle tool sleep',
    (state) => {
      expect(authorizationStatusPollDelay(state, true)).toBe(15_000);
      expect(authorizationStatusPollDelay(state, false)).toBeNull();
    }
  );
  it.each(['waiting', 'busy'] as const)('continues observing %s when the provider tab is active', (state) => {
    expect(authorizationStatusPollDelay(state, true)).toBe(5000);
    expect(authorizationStatusPollDelay(state, false)).toBe(5000);
  });
  it('does not retry failed initialization continuously', () => {
    expect(authorizationStatusPollDelay(undefined, true)).toBeNull();
  });
});
