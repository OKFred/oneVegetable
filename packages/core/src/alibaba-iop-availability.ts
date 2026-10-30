import {
  getIopMethod,
  iopMethodAvailabilityReason,
  iopRegisteredOperationReason
} from './alibaba-iop-registry';
import type { OperationId } from './types';

/** Startup-safe capability metadata. Never import transport construction or request validators here. */
export function iopOperationReason(operation: OperationId, method?: unknown): string | null {
  return iopRegisteredOperationReason(operation, method);
}
export function iopMethodReason(
  method: unknown,
  parameters?: Readonly<Record<string, unknown>>
): string | null {
  return iopMethodAvailabilityReason(method, parameters);
}
export function isAccountVerifiedIopMethod(method: string): boolean {
  return getIopMethod(method)?.accountVerified === true;
}
export function applyIopCapabilityProtocol<T extends { method: string; realCallEnabled: boolean }>(
  capability: T
): T {
  return {
    ...capability,
    realCallEnabled: capability.realCallEnabled && iopMethodReason(capability.method) === null,
    verification: getIopMethod(capability.method)?.accountVerified ? 'account-verified' : 'documented'
  };
}
