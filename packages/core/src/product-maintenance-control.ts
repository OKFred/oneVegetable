import { GatewayException } from './errors';
import { createProductMaintenanceIntent } from './product-maintenance-api';
import { parseProductMaintenanceRecord } from './product-maintenance-service';
import type {
  ProductMaintenanceCommand,
  ProductMaintenanceServiceResult
} from './product-maintenance-service';
import type { ProductOperationContext } from './product-operation-context';

export interface ProductMaintenanceControl {
  productMaintenance(
    command: ProductMaintenanceCommand,
    context: ProductOperationContext,
    requestId?: string
  ): Promise<ProductMaintenanceServiceResult>;
}
export async function validateProductMaintenanceServiceResult(
  value: unknown
): Promise<ProductMaintenanceServiceResult> {
  const { validateProductValueMaintenanceResult } =
    await import('./generated/validators-product-maintenance');
  const fail = (): never => {
    throw new GatewayException({
      code: 'PRODUCT_MAINTENANCE_RESPONSE_INVALID',
      message: 'PRODUCT_MAINTENANCE_RESPONSE_INVALID',
      retryable: false
    });
  };
  if (!validateProductValueMaintenanceResult(value)) return fail();
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('tasks' in value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 100
  )
    return fail();
  try {
    for (const task of value.tasks as unknown[]) {
      const parsed = parseProductMaintenanceRecord({ ownerId: 'response-validation', task });
      const intent = await createProductMaintenanceIntent(parsed.task.intent.draft);
      if (JSON.stringify(intent) !== JSON.stringify(parsed.task.intent)) return fail();
    }
    return structuredClone(value) as ProductMaintenanceServiceResult;
  } catch {
    return fail();
  }
}
