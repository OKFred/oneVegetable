import { GatewayException } from './errors';
import {
  createProductMaintenanceIntent,
  validateProductMaintenanceDiagnostics
} from './product-maintenance-api';
import {
  parseProductMaintenanceRecord,
  createProductMaintenanceBaselineFingerprint
} from './product-maintenance-service';
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
  const fail = (): never => {
    throw new GatewayException({
      code: 'PRODUCT_MAINTENANCE_RESPONSE_INVALID',
      message: 'PRODUCT_MAINTENANCE_RESPONSE_INVALID',
      retryable: false
    });
  };
  // Snapshot before the first await that uses caller data; later mutations cannot alter validated evidence.
  let snapshot: unknown;
  try {
    snapshot = structuredClone(value);
  } catch {
    return fail();
  }
  const { validateProductValueMaintenanceResult } =
    await import('./generated/validators-product-maintenance');
  if (!validateProductValueMaintenanceResult(snapshot)) return fail();
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    Object.keys(snapshot).length !== 1 ||
    !('tasks' in snapshot) ||
    !Array.isArray(snapshot.tasks) ||
    snapshot.tasks.length > 100
  )
    return fail();
  try {
    const tasks: ProductMaintenanceServiceResult['tasks'] = [];
    for (const task of snapshot.tasks as unknown[]) {
      const parsed = parseProductMaintenanceRecord({ ownerId: 'response-validation', task });
      const current = parsed.task;
      if (current.receipt && !validateProductMaintenanceDiagnostics(current.receipt)) return fail();
      const intent = await createProductMaintenanceIntent(current.intent.draft);
      if (JSON.stringify(intent) !== JSON.stringify(current.intent)) return fail();
      const baseline = current.baseline;
      if (baseline) {
        if (
          intent.draft.operation === 'deleteDraft' ||
          baseline.productId !== intent.draft.productId ||
          baseline.fingerprint !==
            (await createProductMaintenanceBaselineFingerprint(baseline.productId, baseline.fields))
        )
          return fail();
      }
      const readback = current.readback;
      if (readback) {
        const mismatched = readback.mismatchedFields.length;
        const unavailable = readback.unavailableFields.length;
        if (
          (readback.status === 'matched' && (mismatched !== 0 || unavailable !== 0)) ||
          (readback.status === 'mismatched' && mismatched === 0) ||
          (readback.status === 'unavailable' && (mismatched !== 0 || unavailable === 0))
        )
          return fail();
      }
      if (
        current.status === 'verified' &&
        (readback?.status !== 'matched' ||
          readback.mismatchedFields.length !== 0 ||
          readback.unavailableFields.length !== 0 ||
          current.reasonCode !== null)
      )
        return fail();
      // Return the parsed snapshot, never the mutable caller-owned task. Preserve evidence as read-only.
      if (current.baseline) {
        Object.freeze(current.baseline.fields);
        Object.freeze(current.baseline);
      }
      tasks.push(current);
    }
    return { tasks };
  } catch {
    return fail();
  }
}
