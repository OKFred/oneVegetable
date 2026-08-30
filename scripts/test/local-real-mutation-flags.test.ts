import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCAL_REAL_MUTATION_FLAGS,
  resolveLocalRealMutationFlags
} from '../lib/local-real-mutation-flags';

describe('local real mutation flags', () => {
  it('enables reviewed local mutations while keeping unsupported domains closed', () => {
    expect(DEFAULT_LOCAL_REAL_MUTATION_FLAGS).toContain('operation:updateProductDisplay');
    expect(DEFAULT_LOCAL_REAL_MUTATION_FLAGS).toContain('operation:createProductGroup');
    expect(DEFAULT_LOCAL_REAL_MUTATION_FLAGS).not.toContain('operation:submitRfqQuotation');
  });

  it('preserves an explicit environment override, including an empty deny-all value', () => {
    expect(resolveLocalRealMutationFlags('operation:saveProductDraft')).toBe('operation:saveProductDraft');
    expect(resolveLocalRealMutationFlags('')).toBe('');
  });

  it('serializes the default flags for the local Node child process', () => {
    expect(resolveLocalRealMutationFlags(undefined).split(',')).toEqual([
      ...DEFAULT_LOCAL_REAL_MUTATION_FLAGS
    ]);
  });
});
