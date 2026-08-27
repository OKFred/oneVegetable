import { ACCOUNT_VERIFICATION_SNAPSHOT } from './generated/account-verification';
import { listCapabilities } from './capability-registry';

import type { ApiCapability } from './types';

type AccountVerificationResult = (typeof ACCOUNT_VERIFICATION_SNAPSHOT.results)[number];

export function listCapabilitiesWithAccountVerification(): ApiCapability[] {
  const accountVerificationResults: ReadonlyMap<string, AccountVerificationResult> = new Map(
    ACCOUNT_VERIFICATION_SNAPSHOT.results.map((result) => [result.method, result] as const)
  );
  return listCapabilities().map(withAccountVerification);

  function withAccountVerification(capability: ApiCapability): ApiCapability {
    const result = accountVerificationResults.get(capability.method);
    return {
      ...capability,
      accountVerificationStatus: result?.status ?? 'not-tested',
      accountVerificationReasonCode: result?.reasonCode ?? null,
      accountVerificationCheckedAt: result ? ACCOUNT_VERIFICATION_SNAPSHOT.checkedAtUtc : null
    };
  }
}

export function findCapabilityWithAccountVerification(method: string): ApiCapability | undefined {
  return listCapabilitiesWithAccountVerification().find((capability) => capability.method === method);
}
