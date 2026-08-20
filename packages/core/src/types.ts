import type { components } from './generated/api';
import type {
  ProductCapabilityRequestMap,
  ProductCapabilityResponseMap
} from './generated/product-capabilities';
import type { RfqCapabilityRequestMap, RfqCapabilityResponseMap } from './generated/rfq-capabilities';
import type { TradeCapabilityRequestMap, TradeCapabilityResponseMap } from './generated/trade-capabilities';
import type {
  LogisticsCapabilityRequestMap,
  LogisticsCapabilityResponseMap
} from './generated/logistics-capabilities';
import type {
  InsightsCapabilityRequestMap,
  InsightsCapabilityResponseMap
} from './generated/insights-capabilities';
import type { PhotoCapabilityRequestMap, PhotoCapabilityResponseMap } from './generated/photo-capabilities';
import type {
  PlatformCapabilityRequestMap,
  PlatformCapabilityResponseMap
} from './generated/platform-capabilities';

export type DashboardSummary = components['schemas']['DashboardSummary'];
export type DiagnosticEntry = components['schemas']['DiagnosticEntry'];
export type DiagnosticsSnapshot = components['schemas']['DiagnosticsSnapshot'];
export type Product = components['schemas']['Product'];
export type ProductDetail = components['schemas']['ProductDetail'];
export type ProductPage = components['schemas']['ProductPage'];
export type ProductSchemaRequest = components['schemas']['ProductSchemaRequest'];
export type ProductSchemaRenderRequest = components['schemas']['ProductSchemaRenderRequest'];
export type ProductSchema = components['schemas']['ProductSchema'];
export type SchemaPublishRequest = components['schemas']['SchemaPublishRequest'];
export type ProductMutationResult = components['schemas']['ProductMutationResult'];
export type Photo = components['schemas']['Photo'];
export type PhotoGroup = components['schemas']['PhotoGroup'];
export type PhotoPage = components['schemas']['PhotoPage'];
export type PhotoTransferRequest = components['schemas']['PhotoTransferRequest'];
export type PhotoGroupOperationRequest = components['schemas']['PhotoGroupOperationRequest'];
export type ProductDescriptionQualityIssue = components['schemas']['ProductDescriptionQualityIssue'];
export type Order = components['schemas']['Order'];
export type OrderPage = components['schemas']['OrderPage'];
export type OrderFund = components['schemas']['OrderFund'];
export type OrderLogistics = components['schemas']['OrderLogistics'];
export type ApiCapability = components['schemas']['ApiCapability'];
export type CapabilityCallRequest = components['schemas']['CapabilityCallRequest'];
export type CapabilityDefinition = components['schemas']['CapabilityDefinition'];
export type CapabilityContractIssue = components['schemas']['CapabilityContractIssue'];
export type CapabilityResponseEnvelope<T = unknown> = Omit<
  components['schemas']['CapabilityResponseEnvelope'],
  'data'
> & { data: T };
export type CapabilityCallResult = CapabilityResponseEnvelope;
export type ProductCategory = components['schemas']['ProductCategory'];
export type ProductCategoryMapping = components['schemas']['ProductCategoryMapping'];
export type ProductGroup = components['schemas']['ProductGroup'];
export type ProductScore = components['schemas']['ProductScore'];
export type RfqSummary = components['schemas']['RfqSummary'];
export type RfqPage = components['schemas']['RfqPage'];
export type RfqDetail = components['schemas']['RfqDetail'];
export type RfqEquity = components['schemas']['RfqEquity'];
export type RfqReadStatus = components['schemas']['RfqReadStatus'];
export type RfqQuotationRequest = components['schemas']['RfqQuotationRequest'];
export type RfqQuotationResult = components['schemas']['RfqQuotationResult'];
export type RfqAttachmentUploadRequest = components['schemas']['RfqAttachmentUploadRequest'];
export type RfqAttachmentUploadResult = components['schemas']['RfqAttachmentUploadResult'];
export type TradeOrderSummary = components['schemas']['TradeOrderSummary'];
export type TradeOrderPage = components['schemas']['TradeOrderPage'];
export type TradeFund = components['schemas']['TradeFund'];
export type TradeLogistics = components['schemas']['TradeLogistics'];
export type TradeOrderAggregate = components['schemas']['TradeOrderAggregate'];
export type TradeFulfillmentChannel = components['schemas']['TradeFulfillmentChannel'];
export type TradeServiceCharge = components['schemas']['TradeServiceCharge'];
export type TradeTtAccount = components['schemas']['TradeTtAccount'];
export type TradeAddressSchema = components['schemas']['TradeAddressSchema'];
export type TradeAddress = components['schemas']['TradeAddress'];
export type TradeOrderDraft = components['schemas']['TradeOrderDraft'];
export type TradeMutationResult = components['schemas']['TradeMutationResult'];
export type LogisticsAddressNode = components['schemas']['LogisticsAddressNode'];
export type LogisticsSpecialProductType = components['schemas']['LogisticsSpecialProductType'];
export type LogisticsProduct = components['schemas']['LogisticsProduct'];
export type LogisticsContact = components['schemas']['LogisticsContact'];
export type LogisticsAddress = components['schemas']['LogisticsAddress'];
export type LogisticsCargo = components['schemas']['LogisticsCargo'];
export type LogisticsPackage = components['schemas']['LogisticsPackage'];
export type LogisticsCustoms = components['schemas']['LogisticsCustoms'];
export type LogisticsQuoteRequest = components['schemas']['LogisticsQuoteRequest'];
export type LogisticsQuoteResult = components['schemas']['LogisticsQuoteResult'];
export type LogisticsOrderDraft = components['schemas']['LogisticsOrderDraft'];
export type LogisticsOrderSummary = components['schemas']['LogisticsOrderSummary'];
export type LogisticsOrderPage = components['schemas']['LogisticsOrderPage'];
export type LogisticsOrderDetail = components['schemas']['LogisticsOrderDetail'];
export type LogisticsOrderMutationResult = components['schemas']['LogisticsOrderMutationResult'];
export type ShippingTemplate = components['schemas']['ShippingTemplate'];
export type InsightsSupplierRankPoint = components['schemas']['InsightsSupplierRankPoint'];
export type InsightsSupplierRankTrend = components['schemas']['InsightsSupplierRankTrend'];
export type InsightsSupplierPage = components['schemas']['InsightsSupplierPage'];
export type InsightsSupplierProductAttribute = components['schemas']['InsightsSupplierProductAttribute'];
export type InsightsSupplierProduct = components['schemas']['InsightsSupplierProduct'];
export type InsightsSupplierProductPage = components['schemas']['InsightsSupplierProductPage'];
export type { ProductCapabilityRequestMap, ProductCapabilityResponseMap };
export type { RfqCapabilityRequestMap, RfqCapabilityResponseMap };
export type { TradeCapabilityRequestMap, TradeCapabilityResponseMap };
export type { LogisticsCapabilityRequestMap, LogisticsCapabilityResponseMap };
export type { InsightsCapabilityRequestMap, InsightsCapabilityResponseMap };
export type { PhotoCapabilityRequestMap, PhotoCapabilityResponseMap };
export type { PlatformCapabilityRequestMap, PlatformCapabilityResponseMap };
export interface CapabilityRequestMap
  extends
    ProductCapabilityRequestMap,
    RfqCapabilityRequestMap,
    TradeCapabilityRequestMap,
    LogisticsCapabilityRequestMap,
    InsightsCapabilityRequestMap,
    PhotoCapabilityRequestMap,
    PlatformCapabilityRequestMap {}
export interface CapabilityResponseMap
  extends
    ProductCapabilityResponseMap,
    RfqCapabilityResponseMap,
    TradeCapabilityResponseMap,
    LogisticsCapabilityResponseMap,
    InsightsCapabilityResponseMap,
    PhotoCapabilityResponseMap,
    PlatformCapabilityResponseMap {}
export type GatewayError = components['schemas']['GatewayError'];

export interface ProductListQuery {
  page?: number;
  pageSize?: number;
  subject?: string;
  groupId?: number;
}

export interface PhotoListQuery {
  page?: number;
  pageSize?: number;
  groupId?: string;
}

export interface OrderListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
}

export interface RfqListQuery {
  page?: number;
  pageSize?: number;
  keywords?: string;
  categoryId?: string;
  country?: string;
  unquotedOnly?: boolean;
}

export interface TradeOrderListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  buyerLoginId?: string;
  createDateStart?: string;
  createDateEnd?: string;
  modifiedDateStart?: string;
  modifiedDateEnd?: string;
}

export interface LogisticsAddressNodeQuery {
  level: 'province' | 'city' | 'division' | 'street';
  parentId?: string;
  countryCode?: string;
  searchText?: string;
}

export interface LogisticsOrderListQuery {
  page?: number;
  pageSize?: number;
  orderNumber?: string;
}

export interface InsightsSupplierListQuery {
  page?: number;
  pageSize?: number;
}

export interface InsightsSupplierProductListQuery extends InsightsSupplierListQuery {
  supplierId: string;
  dateStart?: string;
  dateEnd?: string;
}

export interface ProductDisplayRequest {
  productIds: string[];
  display: 'online' | 'offline';
}

export type PhotoUploadRequest = components['schemas']['PhotoUploadRequest'];

export interface OperationMap {
  getDashboard: { request: undefined; response: DashboardSummary };
  getDiagnostics: { request: undefined; response: DiagnosticsSnapshot };
  clearDiagnostics: { request: undefined; response: undefined };
  listProducts: { request: ProductListQuery; response: ProductPage };
  getProduct: { request: { productId: string }; response: ProductDetail };
  getProductSchema: { request: ProductSchemaRequest; response: ProductSchema };
  renderProductSchema: { request: ProductSchemaRenderRequest; response: ProductSchema };
  publishProduct: { request: SchemaPublishRequest; response: ProductMutationResult };
  saveProductDraft: { request: SchemaPublishRequest; response: ProductMutationResult };
  updateProduct: {
    request: SchemaPublishRequest & { productId: string };
    response: ProductMutationResult;
  };
  updateProductDisplay: { request: ProductDisplayRequest; response: undefined };
  listPhotoGroups: { request: undefined; response: PhotoGroup[] };
  operatePhotoGroup: { request: PhotoGroupOperationRequest; response: PhotoGroup };
  listPhotos: { request: PhotoListQuery; response: PhotoPage };
  uploadPhoto: { request: PhotoUploadRequest; response: Photo };
  transferPhotoFromUrl: { request: PhotoTransferRequest; response: Photo };
  listOrders: { request: OrderListQuery; response: OrderPage };
  getOrderFund: { request: { orderId: string }; response: OrderFund };
  getOrderLogistics: { request: { orderId: string }; response: OrderLogistics };
  listCapabilities: { request: undefined; response: ApiCapability[] };
  getCapabilityDefinition: { request: { method: string }; response: CapabilityDefinition };
  callCapability: { request: CapabilityCallRequest; response: CapabilityCallResult };
  listProductCategories: { request: { parentId?: number }; response: ProductCategory[] };
  mapProductCategory: {
    request: { categoryId: number };
    response: ProductCategoryMapping;
  };
  getProductLevelSchema: {
    request: { categoryId: number; language: string; xml: string };
    response: ProductSchema;
  };
  getProductDraft: {
    request: { productId: string; language: string };
    response: ProductDetail;
  };
  listProductGroups: { request: undefined; response: ProductGroup[] };
  createProductGroup: {
    request: { name: string; parentId?: number };
    response: ProductGroup;
  };
  getProductScore: { request: { productId: string }; response: ProductScore };
  listRfqs: { request: RfqListQuery; response: RfqPage };
  listRecommendedRfqs: {
    request: Pick<RfqListQuery, 'page' | 'pageSize'>;
    response: RfqPage;
  };
  getRfq: { request: { rfqId: string }; response: RfqDetail };
  getRfqEquity: { request: undefined; response: RfqEquity };
  getRfqReadStatus: { request: { rfqIds: string[] }; response: RfqReadStatus };
  uploadRfqAttachment: {
    request: RfqAttachmentUploadRequest;
    response: RfqAttachmentUploadResult;
  };
  submitRfqQuotation: { request: RfqQuotationRequest; response: RfqQuotationResult };
  listTradeOrders: { request: TradeOrderListQuery; response: TradeOrderPage };
  getTradeOrderAggregate: {
    request: { order: TradeOrderSummary };
    response: TradeOrderAggregate;
  };
  getTradeOrderFund: { request: { orderId: string }; response: TradeFund };
  getTradeOrderLogistics: { request: { orderId: string }; response: TradeLogistics };
  listTradeFulfillmentChannels: {
    request: { language?: string };
    response: TradeFulfillmentChannel[];
  };
  getTradeServiceCharge: { request: { currency: string }; response: TradeServiceCharge };
  getTradeTtAccount: { request: { orderId: string }; response: TradeTtAccount };
  getTradeAddressSchema: {
    request: { countryCode: string; language?: string };
    response: TradeAddressSchema;
  };
  listTradeAddresses: { request: { buyerEmail: string }; response: TradeAddress[] };
  saveTradeAddress: {
    request: { buyerEmail: string; address: TradeAddress };
    response: TradeAddress;
  };
  deleteTradeAddress: { request: { addressId: string }; response: undefined };
  createTradeOrder: { request: TradeOrderDraft; response: TradeMutationResult };
  modifyTradeOrder: { request: TradeOrderDraft; response: TradeMutationResult };
  listLogisticsAddressNodes: {
    request: LogisticsAddressNodeQuery;
    response: LogisticsAddressNode[];
  };
  listLogisticsSpecialProductTypes: {
    request: undefined;
    response: LogisticsSpecialProductType[];
  };
  listLogisticsProducts: { request: undefined; response: LogisticsProduct[] };
  calculateLogisticsQuote: { request: LogisticsQuoteRequest; response: LogisticsQuoteResult };
  listLogisticsOrders: { request: LogisticsOrderListQuery; response: LogisticsOrderPage };
  getLogisticsOrder: { request: { orderNumber: string }; response: LogisticsOrderDetail };
  listShippingTemplates: { request: undefined; response: ShippingTemplate[] };
  createLogisticsOrder: {
    request: LogisticsOrderDraft;
    response: LogisticsOrderMutationResult;
  };
  getInsightsSupplierRank: { request: undefined; response: InsightsSupplierRankTrend };
  listInsightsSuppliers: { request: InsightsSupplierListQuery; response: InsightsSupplierPage };
  listInsightsSupplierProducts: {
    request: InsightsSupplierProductListQuery;
    response: InsightsSupplierProductPage;
  };
}

export type OperationId = keyof OperationMap;
export type RequestOf<K extends OperationId> = OperationMap[K]['request'];
export type ResponseOf<K extends OperationId> = OperationMap[K]['response'];

export interface GatewayClient {
  request<K extends OperationId>(operation: K, request: RequestOf<K>): Promise<ResponseOf<K>>;
}

export interface RuntimeRequest<K extends OperationId = OperationId> {
  requestId: string;
  kind: 'gateway-request';
  operation: K;
  payload: RequestOf<K>;
}

export type RuntimeResponse<K extends OperationId = OperationId> =
  | { requestId: string; ok: true; data: ResponseOf<K> }
  | { requestId: string; ok: false; error: GatewayError };

export interface GatewayCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
  signMethod: SignMethod;
  endpoint: string;
}

export type SignMethod = 'hmac' | 'md5' | 'hmac-sha256';

export interface GatewaySettings {
  appKey: string;
  appSecret: string;
  accessToken: string;
  endpoint: string;
  signMethod: SignMethod;
}

export interface SettingsRepository {
  load(): Promise<GatewaySettings>;
  save(settings: GatewaySettings): Promise<void>;
}

export type CredentialVaultState = 'empty' | 'legacy' | 'locked' | 'unlocked' | 'invalid';
export type CredentialVaultLockReason = 'idle' | 'manual' | null;

export interface CredentialVaultPolicy {
  idleTimeoutMinutes: number;
}

export interface CredentialVaultStatus {
  state: CredentialVaultState;
  hasAppKey: boolean;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
  appKey: string;
  endpoint: string;
  signMethod: SignMethod;
  idleTimeoutMinutes: number | null;
  lastActivityAt: string | null;
  idleRemainingSeconds: number | null;
  lockReason: CredentialVaultLockReason;
}

export interface CredentialVaultRepository {
  status(): Promise<CredentialVaultStatus>;
  create(passphrase: string, settings: GatewaySettings): Promise<CredentialVaultStatus>;
  migrate(passphrase: string): Promise<CredentialVaultStatus>;
  unlock(passphrase: string): Promise<CredentialVaultStatus>;
  lock(): Promise<CredentialVaultStatus>;
  rotate(newPassphrase: string): Promise<CredentialVaultStatus>;
  updatePolicy(idleTimeoutMinutes: number): Promise<CredentialVaultStatus>;
}

export type CredentialVaultOperation =
  'status' | 'get-settings' | 'create' | 'migrate' | 'unlock' | 'lock' | 'save' | 'rotate' | 'update-policy';

export interface CredentialVaultRequest {
  requestId: string;
  kind: 'credential-vault-request';
  operation: CredentialVaultOperation;
  payload?: unknown;
}

export type CredentialVaultResponse =
  { requestId: string; ok: true; data: unknown } | { requestId: string; ok: false; error: GatewayError };

export interface HostPermissionsRepository {
  list(): Promise<string[]>;
  revoke(origin: string): Promise<boolean>;
}

export interface OnboardingState {
  version: 1;
  completedAt: string | null;
}

export interface OnboardingRepository {
  load(): Promise<OnboardingState>;
  complete(): Promise<OnboardingState>;
}

export interface LocalDataCategory {
  id: 'credentials' | 'drafts' | 'diagnostics' | 'preferences';
  label: string;
  storage: 'chrome.storage.local' | 'chrome.storage.session' | 'localStorage';
  itemCount: number;
  approximateBytes: number;
  sensitive: boolean;
  retention: string;
}

export interface LocalDataInventory {
  generatedAt: string;
  totalApproximateBytes: number;
  categories: LocalDataCategory[];
}

export interface LocalDataRepository {
  inspect(): Promise<LocalDataInventory>;
  clearAll(): Promise<void>;
}
