import { QUALIFICATION_GATED_OPERATION_IDS, type OperationId } from '@one-vegetable/core/runtime';

export interface ExtensionOperationPolicyDecision {
  allowed: boolean;
  reasonCode: string;
  message: string;
}

const DISABLED_MUTATION_OPERATIONS: ReadonlySet<OperationId> = new Set([
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'createProductGroup',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createTradeOrder',
  'modifyTradeOrder',
  'createLogisticsOrder'
]);

export function resolveExtensionOperationAvailability(
  operation: OperationId
): ExtensionOperationPolicyDecision {
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
