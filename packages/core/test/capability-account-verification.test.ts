import { describe, expect, it } from 'vitest';

import { findCapability, listCapabilities } from '../src/capability-registry';

describe('capability account verification matrix', () => {
  it('keeps real account outcomes separate from contract verification', () => {
    expect(findCapability('alibaba.icbu.product.list')).toMatchObject({
      enabled: true,
      verification: 'documented',
      accountVerificationStatus: 'passed',
      accountVerificationReasonCode: null,
      accountVerificationCheckedAt: '2026-08-20T16:39:50.512Z'
    });
    expect(findCapability('alibaba.icbu.rfq.search')).toMatchObject({
      enabled: true,
      verification: 'documented',
      accountVerificationStatus: 'permission-denied',
      accountVerificationReasonCode: 'isv.permission-api-package-limit'
    });
  });

  it('marks methods outside the sanitized smoke snapshot as not tested', () => {
    const untested = listCapabilities().find(
      (capability) => capability.accountVerificationStatus === 'not-tested'
    );
    expect(untested).toBeDefined();
    expect(untested?.accountVerificationCheckedAt).toBeNull();
  });
});
