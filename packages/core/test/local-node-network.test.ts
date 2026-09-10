import { describe, expect, it } from 'vitest';
import { localNodeNetworkOptions } from '../../../scripts/lib/local-node-network';

describe('local Node network defaults', () => {
  it('gives slow IPv4 connections time without disabling dual-stack fallback', () => {
    expect(localNodeNetworkOptions()).toBe(
      '--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=2000'
    );
  });
  it('preserves explicit operator options and is idempotent', () => {
    const explicit =
      '--max-old-space-size=2048 --dns-result-order=verbatim --network-family-autoselection-attempt-timeout=900';
    expect(localNodeNetworkOptions(explicit)).toBe(explicit);
    expect(localNodeNetworkOptions(localNodeNetworkOptions())).toBe(localNodeNetworkOptions());
  });
});
