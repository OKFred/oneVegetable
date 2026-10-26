import { OPERATION_IDS } from './operation-id';
import { IOP_REFERENCE_METHODS } from './product-reference-methods';
import type { OperationId } from './types';

export type IopBusinessPath = `/alibaba/${string}` | `/icbu/${string}` | `/order/${string}`;
export type IopSupportState =
  'supported' | 'partial' | 'local' | 'not-adapted' | 'not-public' | 'unverified-write';
export interface IopMethodDefinition {
  path: IopBusinessPath;
  risk: 'read' | 'mutation';
  adapted: boolean;
  accountVerified: boolean;
  authorizationRequired: boolean;
  verifiedActions?: readonly string[];
}
export interface IopOperationSupport {
  state: IopSupportState;
  methods: readonly string[];
  constraints: readonly string[];
  verification: 'account-verified' | 'documented' | 'not-applicable';
  fallbackProtocol: 'top' | null;
}

const read = (
  path: IopBusinessPath,
  accountVerified = false,
  authorizationRequired = true
): IopMethodDefinition => ({ path, risk: 'read', adapted: true, accountVerified, authorizationRequired });
const write = (path: IopBusinessPath, accountVerified = false): IopMethodDefinition => ({
  path,
  risk: 'mutation',
  adapted: accountVerified,
  accountVerified,
  authorizationRequired: true
});

/** Explicit public paths and separate IOP acceptance. Never infer paths or inherit TOP verification. */
export const IOP_METHODS: Readonly<Record<string, Readonly<IopMethodDefinition>>> = Object.freeze({
  // Remote Node BFF and formal MV3 read acceptance, 2026-10-26; not an application-permission guarantee.
  [IOP_REFERENCE_METHODS.predictCategory]: read(IOP_REFERENCE_METHODS.predictCategory, true),
  [IOP_REFERENCE_METHODS.listCategories]: read(IOP_REFERENCE_METHODS.listCategories, true),
  [IOP_REFERENCE_METHODS.getAttributes]: read(IOP_REFERENCE_METHODS.getAttributes, true),
  [IOP_REFERENCE_METHODS.getProduct]: read(IOP_REFERENCE_METHODS.getProduct, true),
  [IOP_REFERENCE_METHODS.listShippingTemplates]: read(IOP_REFERENCE_METHODS.listShippingTemplates, true),
  'alibaba.icbu.product.list': read('/alibaba/icbu/product/list', true),
  // Live accepted legacy alias; absent from the current menu, not an advertised catalog guarantee.
  'alibaba.icbu.product.group.get': read('/alibaba/icbu/product/group/get', true),
  'alibaba.icbu.product.schema.render': read('/icbu/product/schema/render', true),
  'alibaba.icbu.product.schema.render.draft': read('/icbu/product/schema/render/draft', true),
  'alibaba.icbu.photobank.group.list': read('/icbu/product/photobank/group/list', true),
  // Live reads returned photos from another group. Transport is adapted, scope is not verified.
  'alibaba.icbu.photobank.list': read('/icbu/product/photobank/list'),
  'alibaba.icbu.category.get.new': read('/icbu/product/category/get', true),
  'alibaba.icbu.category.id.mapping': read('/alibaba/icbu/category/id/mapping', false, false),
  'alibaba.icbu.category.schema.level.get': read('/icbu/product/schema/level/get', false, false),
  'alibaba.icbu.product.schema.get': read('/alibaba/icbu/product/schema/get', true),
  'alibaba.icbu.product.score.get': read('/icbu/product/score/get', true),
  'alibaba.icbu.product.type.available.get': read('/icbu/product/other/available/get', true),
  'alibaba.icbu.product.inventory.get': read('/icbu/product/inventory/get', true),
  'alibaba.icbu.product.id.encrypt': read('/alibaba/icbu/product/id/encrypt'),
  'alibaba.seller.order.list': read('/alibaba/order/list', true),
  'alibaba.seller.order.logistics.get': read('/order/logistics/query', true),
  '/alibaba/order/get': read('/alibaba/order/get', true),
  'alibaba.icbu.product.schema.add': write('/icbu/product/schema/add', true),
  'alibaba.icbu.product.schema.add.draft': write('/icbu/product/schema/add/draft', true),
  'alibaba.icbu.product.schema.update': write('/icbu/product/schema/update', true),
  'alibaba.icbu.photobank.group.operate': {
    ...write('/icbu/product/photobank/group/operate', true),
    verifiedActions: ['add', 'rename']
  },
  'alibaba.icbu.photobank.upload': write('/alibaba/icbu/photobank/upload', true),
  'alibaba.icbu.product.group.add': { ...write('/icbu/product/group/add'), adapted: true },
  'alibaba.icbu.product.batch.update.display': write('/icbu/product/update/display', true),
  'alibaba.icbu.product.inventory.update': write('/icbu/product/inventory/update', true),
  'alibaba.icbu.video.query': read('/alibaba/icbu/video/query'),
  'alibaba.icbu.video.upload': write('/alibaba/icbu/video/upload'),
  'alibaba.icbu.video.upload.result': { ...read('/alibaba/icbu/video/upload/result'), adapted: false },
  'alibaba.icbu.video.relation.product.main': write('/alibaba/icbu/video/relation/product/main')
});

interface OperationDefinition {
  methods: readonly string[];
  local?: boolean;
  partial?: boolean;
  constraints?: readonly string[];
}
const OPERATIONS: Partial<Record<OperationId, OperationDefinition>> = {
  getDashboard: {
    methods: ['alibaba.icbu.product.list', 'alibaba.icbu.photobank.list', 'alibaba.seller.order.list'],
    partial: true,
    constraints: ['photo-group-required']
  },
  getDiagnostics: { methods: [], local: true },
  clearDiagnostics: { methods: [], local: true },
  listCapabilities: { methods: [], local: true },
  getCapabilityDefinition: { methods: [], local: true },
  callCapability: { methods: [], partial: true, constraints: ['target-method-required'] },
  downloadProductAsset: { methods: [], local: true },
  listProducts: { methods: ['alibaba.icbu.product.list'] },
  getProduct: { methods: ['alibaba.icbu.product.list', 'alibaba.icbu.product.schema.render'] },
  listProductGroups: { methods: ['alibaba.icbu.product.group.get'] },
  renderProductSchema: { methods: ['alibaba.icbu.product.schema.render'] },
  getProductDraft: {
    methods: ['alibaba.icbu.product.schema.render.draft'],
    constraints: ['draft-category-required']
  },
  getProductSchema: { methods: ['alibaba.icbu.product.schema.get'], constraints: ['wholesale-only'] },
  getProductLevelSchema: { methods: ['alibaba.icbu.category.schema.level.get'] },
  listProductCategories: { methods: ['alibaba.icbu.category.get.new'] },
  mapProductCategory: { methods: ['alibaba.icbu.category.id.mapping'] },
  getProductScore: { methods: ['alibaba.icbu.product.score.get'] },
  getProductInventory: {
    methods: ['alibaba.icbu.product.inventory.get'],
    constraints: ['product-inventory-only']
  },
  listPhotoGroups: { methods: ['alibaba.icbu.photobank.group.list'] },
  listPhotos: {
    methods: ['alibaba.icbu.photobank.list'],
    partial: true,
    constraints: ['photo-group-required', 'photo-group-scope-unverified']
  },
  operatePhotoGroup: {
    methods: ['alibaba.icbu.photobank.group.operate'],
    partial: true,
    constraints: ['photo-group-delete-unverified']
  },
  uploadPhoto: { methods: ['alibaba.icbu.photobank.upload'] },
  transferPhotoFromUrl: { methods: ['alibaba.icbu.photobank.upload'] },
  createProductGroup: { methods: ['alibaba.icbu.product.group.add'] },
  updateProductDisplay: { methods: ['alibaba.icbu.product.batch.update.display'] },
  publishProduct: { methods: ['alibaba.icbu.product.schema.add'] },
  saveProductDraft: { methods: ['alibaba.icbu.product.schema.add.draft'] },
  updateProduct: { methods: ['alibaba.icbu.product.schema.update'] },
  listVideos: { methods: ['alibaba.icbu.video.query'], constraints: ['video-title-page-filter-only'] },
  associateProductVideo: { methods: ['alibaba.icbu.video.relation.product.main'] },
  listOrders: { methods: ['alibaba.seller.order.list'], constraints: ['buyer-filter-unsupported'] },
  listTradeOrders: { methods: ['alibaba.seller.order.list'], constraints: ['buyer-filter-unsupported'] },
  getOrderLogistics: { methods: ['alibaba.seller.order.logistics.get'] },
  getTradeOrderLogistics: { methods: ['alibaba.seller.order.logistics.get'] },
  getTradeOrderAggregate: {
    methods: ['/alibaba/order/get', 'alibaba.seller.order.fund.get', 'alibaba.seller.order.logistics.get'],
    partial: true,
    constraints: ['paid-amount-unavailable']
  }
};

export function getIopMethod(method: string): Readonly<IopMethodDefinition> | undefined {
  return Object.hasOwn(IOP_METHODS, method) ? IOP_METHODS[method] : undefined;
}

export function iopMethodAvailabilityReason(
  method: unknown,
  parameters?: Readonly<Record<string, unknown>>
): string | null {
  const definition = typeof method === 'string' ? getIopMethod(method) : undefined;
  if (!definition) return 'ALIBABA_IOP_METHOD_UNSUPPORTED';
  if (
    method === 'alibaba.icbu.product.score.get' &&
    parameters &&
    ((typeof parameters.product_id !== 'string' && typeof parameters.product_id !== 'number') ||
      !/^[1-9][0-9]*$/u.test(String(parameters.product_id)) ||
      !Number.isSafeInteger(Number(parameters.product_id)))
  )
    return 'ALIBABA_IOP_PARAMETER_UNSUPPORTED';
  if (definition.verifiedActions && parameters) {
    const request = parameters.photo_group_operation_request;
    if (
      typeof request === 'object' &&
      request !== null &&
      'operation' in request &&
      request.operation === 'delete' &&
      !definition.verifiedActions.includes('delete')
    )
      return 'ALIBABA_IOP_MUTATION_UNVERIFIED';
  }
  if (definition.risk === 'mutation' && !definition.accountVerified) return 'ALIBABA_IOP_MUTATION_UNVERIFIED';
  return definition.adapted ? null : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
}

export function iopOperationMethods(operation: OperationId): readonly string[] {
  return OPERATIONS[operation]?.methods ?? [];
}

/** Protocol coverage only: never claims the current application has a permission or business qualification. */
export function getIopOperationSupport(operation: OperationId): IopOperationSupport {
  const operationDefinition = OPERATIONS[operation];
  const methods = operationDefinition?.methods ?? [];
  const definitions = methods.map(getIopMethod);
  const constraints = operationDefinition?.constraints ?? [];
  const allAvailable =
    methods.length > 0 && methods.every((method) => iopMethodAvailabilityReason(method) === null);
  const state: IopSupportState = operationDefinition?.local
    ? 'local'
    : operationDefinition?.partial
      ? 'partial'
      : allAvailable
        ? 'supported'
        : definitions.some((definition) => definition?.risk === 'mutation' && !definition.accountVerified)
          ? 'unverified-write'
          : definitions.some(Boolean)
            ? 'not-adapted'
            : 'not-public';
  return {
    state,
    methods,
    constraints,
    verification:
      state === 'local'
        ? 'not-applicable'
        : definitions.length > 0 && definitions.every((definition) => definition?.accountVerified)
          ? 'account-verified'
          : 'documented',
    fallbackProtocol: state === 'local' || (state === 'supported' && constraints.length === 0) ? null : 'top'
  };
}

export function iopRegisteredOperationReason(operation: OperationId, method?: unknown): string | null {
  if (operation === 'callCapability') return iopMethodAvailabilityReason(method);
  const support = getIopOperationSupport(operation);
  if (['supported', 'partial', 'local'].includes(support.state)) return null;
  return support.state === 'unverified-write'
    ? 'ALIBABA_IOP_MUTATION_UNVERIFIED'
    : 'ALIBABA_IOP_METHOD_UNSUPPORTED';
}

/** Every existing operation has a conclusion, including public-method gaps and local-only functionality. */
export function listIopOperationCoverage(): ({ operation: OperationId } & IopOperationSupport)[] {
  return OPERATION_IDS.map((operation) => ({ operation, ...getIopOperationSupport(operation) }));
}
