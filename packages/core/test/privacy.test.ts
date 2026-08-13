import { describe, expect, it } from 'vitest';

import {
  approximateStorageBytes,
  completeOnboarding,
  createLocalDataInventory,
  readOnboardingState
} from '../src/privacy';

describe('privacy and onboarding state', () => {
  it('rejects stale or invalid acknowledgements', () => {
    expect(readOnboardingState(undefined)).toEqual({ version: 1, completedAt: null });
    expect(readOnboardingState({ version: 0, completedAt: '2026-08-13T00:00:00.000Z' })).toEqual({
      version: 1,
      completedAt: null
    });
    expect(readOnboardingState({ version: 1, completedAt: 'not-a-date' }).completedAt).toBeNull();
  });

  it('records a versioned acknowledgement timestamp', () => {
    const now = new Date('2026-08-13T08:00:00.000Z');
    expect(completeOnboarding(now)).toEqual({ version: 1, completedAt: now.toISOString() });
    expect(readOnboardingState(completeOnboarding(now))).toEqual(completeOnboarding(now));
  });

  it('builds a value-free inventory total', () => {
    const categories = [
      {
        id: 'credentials' as const,
        label: 'Credentials',
        storage: 'chrome.storage.local' as const,
        itemCount: 1,
        approximateBytes: approximateStorageBytes({ secret: 'hidden' }),
        sensitive: true,
        retention: 'Until deleted'
      }
    ];
    const inventory = createLocalDataInventory(categories, new Date('2026-08-13T08:00:00.000Z'));
    expect(inventory.totalApproximateBytes).toBeGreaterThan(0);
    expect(JSON.stringify(inventory)).not.toContain('hidden');
  });
});
