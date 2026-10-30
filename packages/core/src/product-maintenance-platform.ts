import type { AlibabaClient, AlibabaCallResult } from './alibaba-client';
import { ProductReferenceClient } from './product-reference';
import { GatewayException } from './errors';
type ProductMaintenancePlatformValidator = (
  method: string,
  value: unknown
) => Promise<readonly { instancePath: string; keyword: string }[]>;
import type { GatewayClient, OperationId, RequestOf, ResponseOf } from './types';
import { PRODUCT_MAINTENANCE_METHODS } from './product-maintenance-api';
import type { KnownProductDraft } from './product-maintenance-api';
import type { ProductMaintenanceRuntime } from './product-maintenance-service';
import type { ProductOperationContext } from './product-operation-context';

const mutations = new Set<string>(Object.values(PRODUCT_MAINTENANCE_METHODS));
function contractInvalid(): never {
  // After dispatch this is an unknown outcome, not an explicit rejection. The adapter records ambiguous.
  // Never include the invalid provider response, validation details, messages or credential data.
  throw new GatewayException({
    code: 'PRODUCT_MAINTENANCE_RESPONSE_CONTRACT_INVALID',
    message: 'PRODUCT_MAINTENANCE_RESPONSE_CONTRACT_INVALID',
    retryable: false
  });
}
async function checkedResponse(
  method: string,
  result: AlibabaCallResult,
  validateResponse: ProductMaintenancePlatformValidator
): Promise<AlibabaCallResult> {
  if (result.method !== method || (await validateResponse(method, result.data)).length)
    return contractInvalid();
  return result;
}

/** One already-validated IOP configuration handles mutation and readback alike. */
export function createProductMaintenancePlatform(options: {
  context: ProductOperationContext;
  client: Pick<AlibabaClient, 'call'>;
  enabled: boolean;
  validateRequest: ProductMaintenancePlatformValidator;
  validateResponse: ProductMaintenancePlatformValidator;
  knownDrafts?: readonly KnownProductDraft[];
}): ProductMaintenanceRuntime {
  const gateway: Pick<GatewayClient, 'request'> = {
    async request<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
      if (operation !== 'callCapability') throw new Error('PRODUCT_MAINTENANCE_READ_ONLY');
      const input = payload as RequestOf<'callCapability'>;
      if (input.method !== '/alibaba/icbu/product/get/v2') throw new Error('PRODUCT_MAINTENANCE_READ_ONLY');
      const result = await checkedResponse(
        input.method,
        await options.client.call(input.method, input.parameters),
        options.validateResponse
      );
      return {
        method: input.method,
        data: result.data,
        traceId: result.traceId ?? '',
        contractValid: true,
        contractIssues: []
      } as ResponseOf<K>;
    }
  };
  const reference = new ProductReferenceClient(gateway);
  const client: Pick<AlibabaClient, 'call'> = {
    async call(method, parameters) {
      if (!mutations.has(method))
        throw new GatewayException({
          code: 'CAPABILITY_RESTRICTED',
          message: 'CAPABILITY_RESTRICTED',
          retryable: false
        });
      if ((await options.validateRequest(method, parameters)).length)
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: 'REQUEST_CONTRACT_INVALID',
          retryable: false
        });
      // Do not normalize/rewrite an error root into an apparent success response.
      return checkedResponse(method, await options.client.call(method, parameters), options.validateResponse);
    }
  };
  return {
    context: options.context,
    protocol: 'iop',
    enabled: options.enabled,
    client,
    readProduct: async (productId) => reference.getProduct(productId),
    ...(options.knownDrafts ? { knownDrafts: options.knownDrafts } : {})
  };
}
