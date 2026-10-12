import {
  QUALIFICATION_GATED_OPERATION_IDS,
  type CredentialVaultStatus,
  type GatewaySettings,
  type OperationAvailabilityClient,
  type OperationId
} from '@one-vegetable/core/runtime';
import { applyIopCapabilityProtocol, iopOperationReason } from '@one-vegetable/core/alibaba-iop-business';

export interface ExtensionOperationPolicyDecision {
  allowed: boolean;
  reasonCode: string;
  message: string;
}

const DISABLED_MUTATION_OPERATIONS: ReadonlySet<OperationId> = new Set([
  'associateProductVideo',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createTradeOrder',
  'modifyTradeOrder',
  'createLogisticsOrder'
]);

/** Reuse existing capability metadata so the debugger can gate its known target, not all generic reads. */
export function applyExtensionCapabilityProtocol<T extends { method: string; realCallEnabled: boolean }>(
  capability: T,
  status: { state: CredentialVaultStatus['state']; protocol?: unknown }
): T {
  const mapped = status.protocol === 'iop' ? applyIopCapabilityProtocol(capability) : capability;
  return {
    ...mapped,
    realCallEnabled:
      mapped.realCallEnabled &&
      ['empty', 'legacy', 'unlocked'].includes(status.state) &&
      (status.protocol === undefined || status.protocol === 'top' || status.protocol === 'iop')
  };
}

/** Options startup only asks about operation IDs, never target capability methods. */
export function resolveExtensionStaticOperationAvailability(
  operation: OperationId,
  protocol?: GatewaySettings['protocol']
): ExtensionOperationPolicyDecision {
  if (protocol === 'iop') {
    const reason = iopOperationReason(operation);
    if (reason) return { allowed: false, reasonCode: reason, message: reason };
  }
  // A generic call without a target is not authorized. Full authorization stays in the background.
  if (operation === 'callCapability') {
    return { allowed: false, reasonCode: 'CAPABILITY_UNKNOWN', message: 'CAPABILITY_UNKNOWN' };
  }
  if (DISABLED_MUTATION_OPERATIONS.has(operation)) {
    return {
      allowed: false,
      reasonCode: 'REAL_MUTATION_DISABLED',
      message: 'REAL_MUTATION_DISABLED'
    };
  }
  if (QUALIFICATION_GATED_OPERATION_IDS.has(operation)) {
    return {
      allowed: false,
      reasonCode: 'LOGISTICS_QUALIFICATION_REQUIRED',
      message: 'LOGISTICS_QUALIFICATION_REQUIRED'
    };
  }
  return {
    allowed: true,
    reasonCode: 'EXTENSION_OPERATION_ALLOWED',
    message: 'EXTENSION_OPERATION_ALLOWED'
  };
}

/** Read only safe status, never settings/secrets or a stale startup protocol snapshot. */
export function createExtensionOperationAvailabilityClient(
  readStatus: () => Promise<{ state: CredentialVaultStatus['state']; protocol?: unknown }>
): OperationAvailabilityClient {
  return {
    async get(operations) {
      try {
        const status = await readStatus();
        const protocol = status.protocol;
        if (
          !['empty', 'legacy', 'unlocked'].includes(status.state) ||
          (protocol !== undefined && protocol !== 'top' && protocol !== 'iop')
        )
          throw new Error('OPERATION_AVAILABILITY_UNAVAILABLE');
        return {
          items: operations.map((operation) => ({
            operation,
            ...resolveExtensionStaticOperationAvailability(operation, protocol)
          }))
        };
      } catch {
        return {
          items: operations.map((operation) => ({
            operation,
            allowed: false,
            reasonCode: 'OPERATION_AVAILABILITY_UNAVAILABLE'
          }))
        };
      }
    }
  };
}
