import { findCapability, getCapabilityDefinition } from './capability-registry';
import { hasAlibabaTransportParameters } from './transport-security';

export interface CapabilityPolicyDecision {
  allowed: boolean;
  reasonCode: string;
  warningCode?: 'CAPABILITY_DEPRECATED';
}

/** Missing or conflicting metadata must never turn a target into a read. */
export function capabilityCallRisk(method: unknown): 'read' | 'mutation' {
  if (typeof method !== 'string') return 'mutation';
  return findCapability(method)?.risk === 'read' && getCapabilityDefinition(method)?.risk === 'read'
    ? 'read'
    : 'mutation';
}

/** The generic debugger is read-only. Dedicated mutation workflows retain their own flags. */
export function authorizeCapabilityCall(payload: Record<string, unknown>): CapabilityPolicyDecision {
  const method = Object.hasOwn(payload, 'method') && typeof payload.method === 'string' ? payload.method : '';
  const capability = findCapability(method);
  const definition = capability ? getCapabilityDefinition(method) : null;
  const denied = (reasonCode: string): CapabilityPolicyDecision => ({ allowed: false, reasonCode });
  if (!capability || definition?.method !== method) return denied('CAPABILITY_UNKNOWN');
  if (capability.restricted || capability.jushitaOnly || definition.restricted) {
    return denied('CAPABILITY_RESTRICTED');
  }
  // Report the specific qualification restriction before the generic disabled state, as the UI does.
  // Lifecycle is advisory for retained query APIs; the catalog UI already displays its warning.
  if (!capability.enabled) {
    return denied('CAPABILITY_NOT_ACTIVE');
  }
  if (capabilityCallRisk(method) !== 'read' || !capability.realCallEnabled || !definition.realCallEnabled) {
    return denied('REAL_MUTATION_DISABLED');
  }
  if (
    !Object.hasOwn(payload, 'parameters') ||
    typeof payload.parameters !== 'object' ||
    payload.parameters === null ||
    Array.isArray(payload.parameters)
  ) {
    return denied('REQUEST_CONTRACT_INVALID');
  }
  if (hasAlibabaTransportParameters(payload.parameters)) {
    return denied('CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN');
  }
  return {
    allowed: true,
    reasonCode: 'CAPABILITY_ALLOWED',
    ...(capability.lifecycle === 'deprecated' || definition.lifecycle === 'deprecated'
      ? { warningCode: 'CAPABILITY_DEPRECATED' as const }
      : {})
  };
}
