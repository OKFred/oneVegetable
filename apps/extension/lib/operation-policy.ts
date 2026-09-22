import { authorizeCapabilityCall, type OperationId } from '@one-vegetable/core';
import {
  resolveExtensionStaticOperationAvailability,
  type ExtensionOperationPolicyDecision
} from './operation-availability';
export type { ExtensionOperationPolicyDecision } from './operation-availability';

export function resolveExtensionOperationAvailability(
  operation: OperationId,
  payload: Record<string, unknown> = {}
): ExtensionOperationPolicyDecision {
  if (operation === 'callCapability') {
    const decision = authorizeCapabilityCall(payload);
    return { ...decision, message: decision.reasonCode };
  }
  return resolveExtensionStaticOperationAvailability(operation);
}
