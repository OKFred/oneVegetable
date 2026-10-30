import type { AlibabaClient } from './alibaba-client';
import { ProductReferenceClient } from './product-reference';
import { validateCapabilityResponse } from './capability-validation-lazy';
import type { GatewayClient, OperationId, RequestOf, ResponseOf } from './types';
import type { KnownProductDraft } from './product-maintenance-api';
import type { ProductMaintenanceRuntime } from './product-maintenance-service';
import type { ProductOperationContext } from './product-operation-context';

/** One already-validated IOP configuration handles mutation and readback alike. */
export function createProductMaintenancePlatform(options: {
  context: ProductOperationContext;
  client: Pick<AlibabaClient, 'call'>;
  enabled: boolean;
  knownDrafts?: readonly KnownProductDraft[];
}): ProductMaintenanceRuntime {
  const gateway: Pick<GatewayClient, 'request'> = {
    async request<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
      if (operation !== 'callCapability') throw new Error('PRODUCT_MAINTENANCE_READ_ONLY');
      const input = payload as RequestOf<'callCapability'>;
      if (input.method !== '/alibaba/icbu/product/get/v2') throw new Error('PRODUCT_MAINTENANCE_READ_ONLY');
      const result = await options.client.call(input.method, input.parameters);
      const issues = await validateCapabilityResponse(input.method, result.data);
      return {
        method: input.method,
        data: result.data,
        traceId: result.traceId ?? '',
        contractValid: issues.length === 0,
        contractIssues: issues
      } as ResponseOf<K>;
    }
  };
  const reference = new ProductReferenceClient(gateway);
  return {
    context: options.context,
    protocol: 'iop',
    enabled: options.enabled,
    client: options.client,
    readProduct: async (productId) => reference.getProduct(productId),
    ...(options.knownDrafts ? { knownDrafts: options.knownDrafts } : {})
  };
}
