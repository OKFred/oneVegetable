import { getCapabilityDefinition } from '@one-vegetable/core';

import type { OperationId } from '@one-vegetable/core';
import type { AuthPrincipal } from './auth/types';

export type AbacAction = 'operation.call' | 'admin.read' | 'admin.write';

export interface AbacDecision {
  allowed: boolean;
  reasonCode: string;
}

export interface OperationFeatureFlags {
  isEnabled(key: string): boolean;
  disabledReason?(key: string): string | null;
}

export class StaticOperationFeatureFlags implements OperationFeatureFlags {
  constructor(private readonly enabled = new Set<string>()) {}

  isEnabled(key: string): boolean {
    return this.enabled.has(key);
  }
}

export class EmergencyPauseFeatureFlags implements OperationFeatureFlags {
  constructor(
    private readonly delegate: OperationFeatureFlags,
    private paused = false
  ) {}

  isEnabled(key: string): boolean {
    return !this.paused && this.delegate.isEnabled(key);
  }

  disabledReason(key: string): string | null {
    return this.paused ? 'REAL_MUTATIONS_PAUSED' : (this.delegate.disabledReason?.(key) ?? null);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }
}

const MUTATION_OPERATIONS: ReadonlySet<OperationId> = new Set([
  'clearDiagnostics',
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'createProductGroup',
  'operatePhotoGroup',
  'uploadPhoto',
  'transferPhotoFromUrl',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'createTradeOrder',
  'modifyTradeOrder',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createLogisticsOrder'
]);

export function authorizeAdmin(principal: AuthPrincipal, action: 'admin.read' | 'admin.write'): AbacDecision {
  if (principal.role !== 'admin') return denied('ADMIN_REQUIRED');
  return {
    allowed: true,
    reasonCode: action === 'admin.read' ? 'ADMIN_READ_ALLOWED' : 'ADMIN_WRITE_ALLOWED'
  };
}

export function authorizeOperation(
  principal: AuthPrincipal,
  operation: OperationId,
  payload: Record<string, unknown>,
  flags: OperationFeatureFlags
): AbacDecision {
  const capabilityDecision = capabilityPolicy(operation, payload, flags);
  if (!capabilityDecision.allowed) return capabilityDecision;
  const risk = operationRisk(operation, payload);
  if (risk === 'read') return { allowed: true, reasonCode: 'READ_ALLOWED' };
  if (principal.role !== 'admin') return denied('USER_MUTATION_DENIED');
  const operationFlag = `operation:${operation}`;
  if (!flags.isEnabled(operationFlag)) {
    return denied(flags.disabledReason?.(operationFlag) ?? 'MUTATION_FLAG_DISABLED');
  }
  return { allowed: true, reasonCode: 'ADMIN_MUTATION_ALLOWED' };
}

export function operationIsMutation(operation: OperationId, payload: Record<string, unknown>): boolean {
  return operationRisk(operation, payload) === 'mutation';
}

export function policySummary(): Record<string, unknown> {
  return {
    evaluationOrder: ['identity', 'abac', 'capability', 'emergencyPause', 'mutationFlag', 'contract'],
    roles: {
      user: ['active read operations'],
      admin: ['read operations', 'admin management', 'flag-enabled mutations']
    },
    invariants: [
      'disabled users are denied before ABAC',
      'admins cannot bypass capability restrictions',
      'the emergency pause overrides every real mutation flag',
      'Alibaba mutations require a server-side feature flag'
    ]
  };
}

export function extensionAdminPrincipal(): AuthPrincipal {
  return {
    actorId: 'extension:local-admin',
    username: '本机管理员',
    role: 'admin',
    source: 'extension'
  };
}

function operationRisk(operation: OperationId, payload: Record<string, unknown>): 'read' | 'mutation' {
  if (operation === 'callCapability') {
    const method = typeof payload.method === 'string' ? payload.method : '';
    return getCapabilityDefinition(method)?.risk ?? 'mutation';
  }
  return MUTATION_OPERATIONS.has(operation) ? 'mutation' : 'read';
}

function capabilityPolicy(
  operation: OperationId,
  payload: Record<string, unknown>,
  flags: OperationFeatureFlags
): AbacDecision {
  if (operation !== 'callCapability') return { allowed: true, reasonCode: 'CAPABILITY_NOT_APPLICABLE' };
  const method = typeof payload.method === 'string' ? payload.method : '';
  const definition = getCapabilityDefinition(method);
  if (!definition) return denied('CAPABILITY_UNKNOWN');
  if (definition.lifecycle !== 'active') return denied('CAPABILITY_NOT_ACTIVE');
  if (definition.restricted === true) return denied('CAPABILITY_RESTRICTED');
  if (definition.risk === 'mutation' && !definition.realCallEnabled) {
    return denied('CAPABILITY_REAL_CALL_DISABLED');
  }
  const capabilityFlag = `capability:${method}`;
  if (definition.risk === 'mutation' && !flags.isEnabled(capabilityFlag)) {
    return denied(flags.disabledReason?.(capabilityFlag) ?? 'CAPABILITY_MUTATION_FLAG_DISABLED');
  }
  return { allowed: true, reasonCode: 'CAPABILITY_ALLOWED' };
}

function denied(reasonCode: string): AbacDecision {
  return { allowed: false, reasonCode };
}
