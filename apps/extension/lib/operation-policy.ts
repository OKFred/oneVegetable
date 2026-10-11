import { authorizeCapabilityCall, type GatewaySettings, type OperationId } from '@one-vegetable/core';
import { iopOperationReason } from '@one-vegetable/core/alibaba-iop-business';
import {
  resolveExtensionStaticOperationAvailability,
  type ExtensionOperationPolicyDecision
} from './operation-availability';
export type { ExtensionOperationPolicyDecision } from './operation-availability';

export function resolveExtensionOperationAvailability(
  operation: OperationId,
  payload: Record<string, unknown> = {},
  protocol?: GatewaySettings['protocol']
): ExtensionOperationPolicyDecision {
  if (operation === 'callCapability') {
    if (protocol === 'iop') {
      const reason = iopOperationReason(operation, payload.method);
      if (reason) return { allowed: false, reasonCode: reason, message: reason };
    }
    const decision = authorizeCapabilityCall(payload);
    return { ...decision, message: decision.reasonCode };
  }
  return resolveExtensionStaticOperationAvailability(operation, protocol);
}
