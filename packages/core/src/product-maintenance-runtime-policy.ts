import { PRODUCT_MAINTENANCE_METHODS } from './product-workbench-methods';

export type ProductMaintenanceExecutionRuntime = 'node' | 'worker' | 'extension';
export type ProductMaintenanceNativeMethod =
  (typeof PRODUCT_MAINTENANCE_METHODS)[keyof typeof PRODUCT_MAINTENANCE_METHODS];

/**
 * Runtime-scoped live acceptance is separate from documentation, adaptation, registry accountVerified,
 * permissions and feature flags. No live acceptance has been granted here. No TOP equivalent exists.
 * Future entries require explicit reviewed evidence for that exact runtime and native method.
 */
export const PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE: Readonly<
  Record<ProductMaintenanceExecutionRuntime, readonly ProductMaintenanceNativeMethod[]>
> = Object.freeze({
  node: Object.freeze([] as ProductMaintenanceNativeMethod[]),
  worker: Object.freeze([] as ProductMaintenanceNativeMethod[]),
  extension: Object.freeze([] as ProductMaintenanceNativeMethod[])
});

export function isProductMaintenanceRuntimeAccepted(method: unknown, runtime: unknown): boolean {
  if (
    typeof method !== 'string' ||
    typeof runtime !== 'string' ||
    !Object.hasOwn(PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE, runtime) ||
    !(Object.values(PRODUCT_MAINTENANCE_METHODS) as string[]).includes(method)
  )
    return false;
  // An acknowledgement is not absence proof. Keep deletion disabled until reliable draft readback exists.
  if (method === PRODUCT_MAINTENANCE_METHODS.deleteDraft) return false;
  return PRODUCT_MAINTENANCE_RUNTIME_ACCEPTANCE[runtime as ProductMaintenanceExecutionRuntime].includes(
    method as ProductMaintenanceNativeMethod
  );
}

/** Both independent authorization and emergency-pause state must be explicitly available and permissive. */
export function productMaintenanceRuntimeWriteEnabled(options: {
  method: unknown;
  runtime: unknown;
  methodEnabled: unknown;
  mutationsPaused: unknown;
}): boolean {
  return (
    options.methodEnabled === true &&
    options.mutationsPaused === false &&
    isProductMaintenanceRuntimeAccepted(options.method, options.runtime)
  );
}
