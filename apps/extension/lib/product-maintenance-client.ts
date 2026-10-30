import { browser } from 'wxt/browser';
import { GatewayException } from '@one-vegetable/core/errors';
import {
  validateProductMaintenanceServiceResult,
  type ProductMaintenanceControl
} from '@one-vegetable/core/product-maintenance-control';

export const requestProductMaintenance: ProductMaintenanceControl['productMaintenance'] = async (
  command,
  context,
  id
) => {
  const requestId = id ?? crypto.randomUUID();
  const result: unknown = await browser.runtime.sendMessage({
    kind: 'product-maintenance-request',
    requestId,
    context,
    command
  });
  if (
    !result ||
    typeof result !== 'object' ||
    !('requestId' in result) ||
    result.requestId !== requestId ||
    !('ok' in result)
  )
    throw new Error('PRODUCT_MAINTENANCE_RESPONSE_INVALID');
  if (result.ok !== true) {
    const error = 'error' in result ? result.error : null;
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z_]{1,128}$/u.test(error.code)
        ? error.code
        : 'PRODUCT_MAINTENANCE_FAILED';
    throw new GatewayException({ code, message: code, retryable: false }, requestId);
  }
  return validateProductMaintenanceServiceResult('data' in result ? result.data : null);
};
