import type { OperationId } from './types';

const OPERATION_ID_RECORD = {
  getDashboard: true,
  getDiagnostics: true,
  clearDiagnostics: true,
  listProducts: true,
  getProduct: true,
  getProductSchema: true,
  renderProductSchema: true,
  publishProduct: true,
  saveProductDraft: true,
  updateProduct: true,
  updateProductDisplay: true,
  listPhotoGroups: true,
  operatePhotoGroup: true,
  listPhotos: true,
  uploadPhoto: true,
  transferPhotoFromUrl: true,
  listOrders: true,
  getOrderFund: true,
  getOrderLogistics: true,
  listCapabilities: true,
  getCapabilityDefinition: true,
  callCapability: true,
  listProductCategories: true,
  mapProductCategory: true,
  getProductLevelSchema: true,
  getProductDraft: true,
  listProductGroups: true,
  createProductGroup: true,
  getProductScore: true,
  listRfqs: true,
  listRecommendedRfqs: true,
  getRfq: true,
  getRfqEquity: true,
  getRfqReadStatus: true,
  uploadRfqAttachment: true,
  submitRfqQuotation: true,
  listTradeOrders: true,
  getTradeOrderAggregate: true,
  getTradeOrderFund: true,
  getTradeOrderLogistics: true,
  listTradeFulfillmentChannels: true,
  getTradeServiceCharge: true,
  getTradeTtAccount: true,
  getTradeAddressSchema: true,
  listTradeAddresses: true,
  saveTradeAddress: true,
  deleteTradeAddress: true,
  createTradeOrder: true,
  modifyTradeOrder: true,
  listLogisticsAddressNodes: true,
  listLogisticsSpecialProductTypes: true,
  listLogisticsProducts: true,
  calculateLogisticsQuote: true,
  listLogisticsOrders: true,
  getLogisticsOrder: true,
  listShippingTemplates: true,
  createLogisticsOrder: true,
  getInsightsSupplierRank: true,
  listInsightsSuppliers: true,
  listInsightsSupplierProducts: true
} as const satisfies Record<OperationId, true>;

export const OPERATION_IDS: readonly OperationId[] = Object.freeze(
  Object.keys(OPERATION_ID_RECORD) as OperationId[]
);

export const QUALIFICATION_GATED_OPERATION_IDS: ReadonlySet<OperationId> = new Set([
  'listLogisticsAddressNodes',
  'listLogisticsSpecialProductTypes',
  'listLogisticsProducts',
  'calculateLogisticsQuote',
  'listLogisticsOrders',
  'getLogisticsOrder',
  'createLogisticsOrder'
]);

const OPERATION_ID_SET: ReadonlySet<string> = new Set(OPERATION_IDS);

export function isOperationId(value: unknown): value is OperationId {
  return typeof value === 'string' && OPERATION_ID_SET.has(value);
}
