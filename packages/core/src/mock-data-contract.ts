import type {
  LogisticsOrderSummary,
  OperationId,
  OperationMap,
  PhotoGroup,
  RfqSummary,
  TradeOrderSummary
} from './types';

type OperationResponses<K extends OperationId> = {
  [P in K]: OperationMap[P]['response'];
};

export interface ProductMockData {
  responses: OperationResponses<
    | 'listProducts'
    | 'getProduct'
    | 'getProductSchema'
    | 'publishProduct'
    | 'saveProductDraft'
    | 'updateProduct'
    | 'listProductCategories'
    | 'mapProductCategory'
    | 'getProductLevelSchema'
    | 'getProductDraft'
    | 'listProductGroups'
    | 'createProductGroup'
    | 'getProductScore'
  >;
}

export interface PhotoMockData {
  photoGroups: PhotoGroup[];
  responses: OperationResponses<
    'listPhotoGroups' | 'operatePhotoGroup' | 'listPhotos' | 'uploadPhoto' | 'transferPhotoFromUrl'
  >;
}

export interface RfqMockData {
  primaryRfq: RfqSummary;
  rfqs: RfqSummary[];
  responses: OperationResponses<
    | 'listRfqs'
    | 'listRecommendedRfqs'
    | 'getRfq'
    | 'getRfqEquity'
    | 'getRfqReadStatus'
    | 'uploadRfqAttachment'
    | 'submitRfqQuotation'
  >;
}

export interface TradeMockData {
  tradeOrders: TradeOrderSummary[];
  responses: OperationResponses<
    | 'listTradeOrders'
    | 'getTradeOrderAggregate'
    | 'getTradeOrderFund'
    | 'getTradeOrderLogistics'
    | 'listTradeFulfillmentChannels'
    | 'getTradeServiceCharge'
    | 'getTradeTtAccount'
    | 'getTradeAddressSchema'
    | 'listTradeAddresses'
    | 'saveTradeAddress'
    | 'createTradeOrder'
    | 'modifyTradeOrder'
  >;
}

export interface LogisticsMockData {
  primaryLogisticsOrder: LogisticsOrderSummary;
  responses: OperationResponses<
    | 'listLogisticsAddressNodes'
    | 'listLogisticsSpecialProductTypes'
    | 'listLogisticsProducts'
    | 'calculateLogisticsQuote'
    | 'listLogisticsOrders'
    | 'getLogisticsOrder'
    | 'listShippingTemplates'
    | 'createLogisticsOrder'
  >;
}

export interface InsightsMockData {
  responses: OperationResponses<
    'getInsightsSupplierRank' | 'listInsightsSuppliers' | 'listInsightsSupplierProducts'
  >;
}

export interface SystemMockData {
  responses: OperationResponses<'listOrders' | 'getOrderFund' | 'getOrderLogistics'>;
}
