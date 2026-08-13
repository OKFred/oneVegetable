import type { LocalDataCategory, LocalDataInventory, OnboardingState } from './types';

export const ONBOARDING_STORAGE_KEY = 'oneVegetableOnboarding';
export const ONBOARDING_VERSION = 1;

export function readOnboardingState(value: unknown): OnboardingState {
  if (!isRecord(value) || value.version !== ONBOARDING_VERSION || typeof value.completedAt !== 'string') {
    return { version: ONBOARDING_VERSION, completedAt: null };
  }
  return Number.isNaN(Date.parse(value.completedAt))
    ? { version: ONBOARDING_VERSION, completedAt: null }
    : { version: ONBOARDING_VERSION, completedAt: value.completedAt };
}

export function completeOnboarding(now = new Date()): OnboardingState {
  return { version: ONBOARDING_VERSION, completedAt: now.toISOString() };
}

export function createLocalDataInventory(
  categories: LocalDataCategory[],
  now = new Date()
): LocalDataInventory {
  return {
    generatedAt: now.toISOString(),
    totalApproximateBytes: categories.reduce((total, category) => total + category.approximateBytes, 0),
    categories
  };
}

export function approximateStorageBytes(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
