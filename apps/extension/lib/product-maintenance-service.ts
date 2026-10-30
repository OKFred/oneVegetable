import { AlibabaClient, GatewayException, isRequestId, type GatewaySettings } from '@one-vegetable/core';
import { createProductOperationContext } from '@one-vegetable/core/product-operation-context';
import { isAccountVerifiedIopMethod } from '@one-vegetable/core/alibaba-iop-business';
import { productMaintenanceRuntimeWriteEnabled } from '@one-vegetable/core/product-maintenance-runtime-policy';
import { ProductMaintenanceService } from '@one-vegetable/core/product-maintenance-service';
import { createProductMaintenancePlatform } from '@one-vegetable/core/product-maintenance-platform';
import type {
  KnownProductDraft,
  ProductMaintenanceRequest
} from '@one-vegetable/core/product-maintenance-api';
import { ExtensionProductMaintenanceRepository } from './product-maintenance-repository';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core/capability-validation-worker';
import { validateProductValueMaintenanceRequest } from '../../../packages/core/src/generated/validators-product-maintenance';

export async function handleProductMaintenance(
  value: unknown,
  trusted: boolean,
  loadSettings: (intent: ProductMaintenanceRequest, expectedGateway: string) => Promise<GatewaySettings>,
  knownDrafts: (gateway: string) => Promise<readonly KnownProductDraft[]>
): Promise<unknown> {
  let requestId: string = crypto.randomUUID();
  try {
    if (!trusted) throw new Error('PRODUCT_MAINTENANCE_UNTRUSTED_SENDER');
    if (
      !value ||
      typeof value !== 'object' ||
      !('requestId' in value) ||
      !isRequestId(value.requestId) ||
      !('context' in value) ||
      !('command' in value)
    )
      throw new Error('REQUEST_CONTRACT_INVALID');
    requestId = value.requestId;
    if (
      !validateProductValueMaintenanceRequest({
        requestId,
        context: value.context,
        command: value.command
      })
    )
      throw new Error('REQUEST_CONTRACT_INVALID');
    const ownerId = 'extension:local-admin';
    const service = new ProductMaintenanceService(
      new ExtensionProductMaintenanceRepository(),
      async (expected, id, intent) => {
        const settings = await loadSettings(intent, expected.gateway);
        if (settings.protocol !== 'iop') throw new Error('ALIBABA_IOP_AUTHORIZATION_REQUIRED');
        const actual = await createProductOperationContext(ownerId, settings);
        return createProductMaintenancePlatform({
          context: actual,
          validateRequest: validateCapabilityRequest,
          validateResponse: validateCapabilityResponse,
          client: AlibabaClient.create(settings, { maxAttempts: 1, requestId: id }),
          // Independent fixed runtime acceptance is mandatory; a registry metadata
          // change alone must never enable a new mutation in the extension.
          enabled: productMaintenanceRuntimeWriteEnabled({
            method: intent.method,
            runtime: 'extension',
            methodEnabled: isAccountVerifiedIopMethod(intent.method),
            mutationsPaused: false
          }),
          knownDrafts: await knownDrafts(actual.gateway)
        });
      }
    );
    const data = await service.execute(ownerId, {
      requestId,
      context: value.context,
      command: value.command
    });
    return { requestId, ok: true, data };
  } catch (error) {
    const code =
      error instanceof GatewayException
        ? error.gatewayError.code
        : error instanceof Error && /^[A-Z_]{1,128}$/u.test(error.message)
          ? error.message
          : 'PRODUCT_MAINTENANCE_FAILED';
    return { requestId, ok: false, error: { code, message: code, retryable: false } };
  }
}
