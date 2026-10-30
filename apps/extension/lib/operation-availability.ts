import {
  GatewayException,
  QUALIFICATION_GATED_OPERATION_IDS,
  type CredentialVaultStatus,
  type GatewaySettings,
  type OperationAvailabilityClient,
  type OperationId
} from '@one-vegetable/core/runtime';
import { applyIopCapabilityProtocol, iopOperationReason } from '@one-vegetable/core/alibaba-iop-availability';
import { getIopOperationSupport } from '@one-vegetable/core/alibaba-iop-registry';
import {
  selectAlibabaOperationProtocol,
  type AlibabaProtocolAvailability
} from '@one-vegetable/core/alibaba-protocol-routing';

export interface AuthorizationStatus {
  state: CredentialVaultStatus['state'];
  gatewayAvailable?: boolean;
  protocol?: unknown;
  pool?: AlibabaProtocolAvailability | undefined;
}

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
  status: AuthorizationStatus
): T {
  let protocol: unknown;
  try {
    protocol = status.pool
      ? selectAlibabaOperationProtocol(
          'callCapability',
          { method: capability.method, parameters: {} },
          status.pool
        )
      : status.protocol;
  } catch (error: unknown) {
    if (error instanceof GatewayException && error.gatewayError.code === 'ALIBABA_IOP_AUTHORIZATION_REQUIRED')
      return { ...capability, realCallEnabled: false };
    throw error;
  }
  if (capability.method.startsWith('/') && protocol !== 'iop')
    return { ...capability, realCallEnabled: false };
  const mapped = protocol === 'iop' ? applyIopCapabilityProtocol(capability) : capability;
  return {
    ...mapped,
    realCallEnabled:
      mapped.realCallEnabled &&
      hasGatewayAccess(status) &&
      (status.protocol === undefined || status.protocol === 'top' || status.protocol === 'iop')
  };
}

function hasGatewayAccess(status: AuthorizationStatus): boolean {
  return (
    ['empty', 'legacy', 'unlocked'].includes(status.state) ||
    (status.state === 'locked' && status.gatewayAvailable === true)
  );
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
  readStatus: (options?: Parameters<OperationAvailabilityClient['get']>[1]) => Promise<AuthorizationStatus>
): OperationAvailabilityClient {
  return {
    async get(operations, options) {
      try {
        const status = await readStatus(options);
        const protocol = status.protocol;
        if (
          !hasGatewayAccess(status) ||
          (options?.galleryContext !== undefined && protocol === undefined) ||
          (protocol !== undefined && protocol !== 'top' && protocol !== 'iop')
        )
          throw new Error('OPERATION_AVAILABILITY_UNAVAILABLE');
        return {
          items: operations.map((operation) => {
            const selected = options?.galleryContext
              ? protocol
              : status.pool
                ? selectAlibabaOperationProtocol(operation, {}, status.pool)
                : protocol;
            return {
              operation,
              ...resolveExtensionStaticOperationAvailability(operation, selected),
              ...(selected === 'iop'
                ? { protocolSupport: { protocol: 'iop' as const, ...getIopOperationSupport(operation) } }
                : {})
            };
          })
        };
      } catch (error: unknown) {
        const contextCode =
          error instanceof GatewayException &&
          ['GALLERY_CONTEXT_CHANGED', 'GALLERY_CONTEXT_INVALID', 'GALLERY_CONTEXT_UNTRUSTED'].includes(
            error.gatewayError.code
          )
            ? error.gatewayError.code
            : null;
        return {
          items: operations.map((operation) => ({
            operation,
            allowed: false,
            reasonCode: contextCode ?? 'OPERATION_AVAILABILITY_UNAVAILABLE'
          }))
        };
      }
    }
  };
}
