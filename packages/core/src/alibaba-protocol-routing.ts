import { GatewayException } from './errors';
import { iopMethodReason, isAccountVerifiedIopMethod } from './alibaba-iop-business';
import type { GatewayCredentials, OperationId } from './types';

export type AlibabaProtocol = 'top' | 'iop';
export interface AlibabaProtocolAvailability {
  top: boolean;
  iop: boolean;
  defaultProtocol: AlibabaProtocol;
  /** Legacy confirmation metadata. Routing now activates whenever both profiles are configured. */
  bindingConfirmed: boolean;
}

const VERIFIED_OPERATIONS: Partial<Record<OperationId, string>> = {
  listProducts: 'alibaba.icbu.product.list',
  listProductGroups: 'alibaba.icbu.product.group.get',
  renderProductSchema: 'alibaba.icbu.product.schema.render',
  getProductDraft: 'alibaba.icbu.product.schema.render.draft',
  getProductSchema: 'alibaba.icbu.product.schema.get',
  getProductScore: 'alibaba.icbu.product.score.get',
  listProductCategories: 'alibaba.icbu.category.get.new',
  listPhotoGroups: 'alibaba.icbu.photobank.group.list',
  listPhotos: 'alibaba.icbu.photobank.list',
  getProductInventory: 'alibaba.icbu.product.inventory.get',
  listTradeOrders: 'alibaba.seller.order.list',
  getTradeOrderLogistics: 'alibaba.seller.order.logistics.get',
  publishProduct: 'alibaba.icbu.product.schema.add',
  saveProductDraft: 'alibaba.icbu.product.schema.add.draft',
  updateProduct: 'alibaba.icbu.product.schema.update'
};

/** Decide before dispatch. Never call this in an error handler to retry on another protocol. */
export function selectAlibabaOperationProtocol(
  operation: OperationId,
  payload: unknown,
  available: AlibabaProtocolAvailability
): AlibabaProtocol {
  if (!available.top || !available.iop)
    return available[available.defaultProtocol]
      ? available.defaultProtocol
      : available.top
        ? 'top'
        : available.iop
          ? 'iop'
          : available.defaultProtocol;
  const input = record(payload);
  if (
    operation === 'listPhotos' &&
    (input.ungrouped === true || input.groupId === undefined || input.groupId === '-1')
  )
    return 'top';
  if (operation === 'listPhotoGroups' && input.parentId !== undefined) return 'top';
  if (operation === 'getProductInventory' && input.source === 'sku') return 'top';
  // TOP can render a draft by ID alone; the verified IOP path requires its category.
  if (operation === 'getProductDraft' && input.categoryId === undefined) return 'top';
  if (operation === 'getProductSchema' && input.market !== undefined && input.market !== 'wholesale')
    return 'top';
  const method =
    operation === 'callCapability'
      ? typeof input.method === 'string'
        ? input.method
        : ''
      : VERIFIED_OPERATIONS[operation];
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
  return method && isAccountVerifiedIopMethod(method) && iopMethodReason(method) === null ? 'iop' : 'top';
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
