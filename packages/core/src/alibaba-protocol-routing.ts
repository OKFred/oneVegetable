import { GatewayException } from './errors';
import { isProductReferenceMethod } from './product-reference-methods';
import { PRODUCT_MAINTENANCE_METHODS } from './product-maintenance-api';
import { iopMethodReason, isAccountVerifiedIopMethod } from './alibaba-iop-business';
import { getIopOperationSupport, iopOperationMethods } from './alibaba-iop-registry';
import type { GatewayCredentials, OperationId } from './types';

export type AlibabaProtocol = 'top' | 'iop';
export interface AlibabaProtocolAvailability {
  top: boolean;
  iop: boolean;
  defaultProtocol: AlibabaProtocol;
  /** Legacy confirmation metadata. Routing now activates whenever both profiles are configured. */
  bindingConfirmed: boolean;
}

/** Decide before dispatch. Never call this in an error handler to retry on another protocol. */
export function selectAlibabaOperationProtocol(
  operation: OperationId,
  payload: unknown,
  available: AlibabaProtocolAvailability
): AlibabaProtocol {
  const input = record(payload);
  // These native paths have no TOP counterpart, regardless of the configured default.
  if (
    operation === 'callCapability' &&
    (isProductReferenceMethod(input.method) ||
      (typeof input.method === 'string' &&
        (Object.values(PRODUCT_MAINTENANCE_METHODS) as string[]).includes(input.method)))
  ) {
    if (!available.iop)
      throw new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        retryable: false
      });
    return 'iop';
  }
  if (operation === 'updateProductDisplay' && (input.protocol === 'top' || input.protocol === 'iop')) {
    if (!available[input.protocol])
      throw new GatewayException({
        code: 'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
        message: 'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
        retryable: false
      });
    return input.protocol;
  }
  if (!available.top || !available.iop)
    return available[available.defaultProtocol]
      ? available.defaultProtocol
      : available.top
        ? 'top'
        : available.iop
          ? 'iop'
          : available.defaultProtocol;
  // Preserve existing composite routing until all dependencies and parameter variants are accepted.
  if (
    operation === 'getProduct' ||
    (operation !== 'callCapability' &&
      getIopOperationSupport(operation).state === 'partial' &&
      operation !== 'operatePhotoGroup')
  )
    return 'top';
  if (operation === 'operatePhotoGroup' && input.operation === 'delete') return 'top';
  if (
    operation === 'listPhotos' &&
    (input.ungrouped === true || input.groupId === undefined || input.groupId === '-1')
  )
    return 'top';
  if (operation === 'getProductInventory' && input.source === 'sku') return 'top';
  // TOP can render a draft by ID alone; the verified IOP path requires its category.
  if (operation === 'getProductDraft' && input.categoryId === undefined) return 'top';
  if (operation === 'getProductSchema' && input.market !== undefined && input.market !== 'wholesale')
    return 'top';
  const methods =
    operation === 'callCapability'
      ? typeof input.method === 'string'
        ? [input.method]
        : []
      : iopOperationMethods(operation);
  const method = methods[0];
  // The generic TOP contract takes an obfuscated ID, even when its text happens to be numeric.
  // The workbench operation has a canonical plaintext ID and may still use the verified IOP read.
  if (operation === 'callCapability' && method === 'alibaba.icbu.product.score.get') return 'top';
  if (operation === 'callCapability' && method === 'alibaba.icbu.photobank.list') {
    const parameters = record(input.parameters);
    if (parameters.location_type !== 'SUB_GROUP' || parameters.group_id === undefined) return 'top';
  }
  if (operation === 'callCapability' && method === 'alibaba.icbu.product.schema.get') {
    const schemaRequest = record(record(input.parameters).param_product_top_publish_request);
    if (
      schemaRequest.product_id !== undefined ||
      (schemaRequest.market !== undefined && schemaRequest.market !== 'wholesale')
    )
      return 'top';
  }
  return methods.length > 0 &&
    methods.every(
      (target) =>
        isAccountVerifiedIopMethod(target) &&
        iopMethodReason(target, operation === 'callCapability' ? record(input.parameters) : undefined) ===
          null
    )
    ? 'iop'
    : 'top';
}

export interface AlibabaAuthorizationBinding {
  topConfigurationId: string;
  iopConfigurationId: string;
  confirmedAtUtc: number;
}

export function authorizationBindingMatches(
  binding: AlibabaAuthorizationBinding | null | undefined,
  ids: { top: string | null; iop: string | null }
): boolean {
  return Boolean(
    binding &&
    ids.top &&
    ids.iop &&
    Number.isSafeInteger(binding.confirmedAtUtc) &&
    binding.confirmedAtUtc >= 0 &&
    binding.topConfigurationId === ids.top &&
    binding.iopConfigurationId === ids.iop
  );
}

export function assertAuthorizationProtocol(
  credentials: GatewayCredentials,
  protocol: AlibabaProtocol
): void {
  if ((credentials.protocol ?? 'top') !== protocol)
    throw new GatewayException({
      code: 'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
      message: 'ALIBABA_PROTOCOL_ENDPOINT_MISMATCH',
      retryable: false
    });
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
