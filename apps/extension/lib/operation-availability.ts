import { QUALIFICATION_GATED_OPERATION_IDS, type OperationId } from '@one-vegetable/core/runtime';

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

/** Options startup only asks about operation IDs, never target capability methods. */
export function resolveExtensionStaticOperationAvailability(
  operation: OperationId
): ExtensionOperationPolicyDecision {
  // A generic call without a target is not authorized. Full authorization stays in the background.
  if (operation === 'callCapability') {
    return { allowed: false, reasonCode: 'CAPABILITY_UNKNOWN', message: 'CAPABILITY_UNKNOWN' };
  }
  if (DISABLED_MUTATION_OPERATIONS.has(operation)) {
    return {
      allowed: false,
      reasonCode: 'REAL_MUTATION_DISABLED',
      message: '该真实写操作未开放，后台已在出网前拒绝'
    };
  }
  if (QUALIFICATION_GATED_OPERATION_IDS.has(operation)) {
    return {
      allowed: false,
      reasonCode: 'LOGISTICS_QUALIFICATION_REQUIRED',
      message: 'OneTouch 国际物流能力需要业务资格，当前账号尚未完成资格与真实接口验收'
    };
  }
  return {
    allowed: true,
    reasonCode: 'EXTENSION_OPERATION_ALLOWED',
    message: '扩展本地策略允许该操作'
  };
}
