import type { components } from './generated/api';
import type {
  ProductCapabilityRequestMap,
  ProductCapabilityResponseMap
} from './generated/product-capabilities';
import type { RfqCapabilityRequestMap, RfqCapabilityResponseMap } from './generated/rfq-capabilities';
import type { TradeCapabilityRequestMap, TradeCapabilityResponseMap } from './generated/trade-capabilities';

export type DashboardSummary = components['schemas']['DashboardSummary'];
export type Product = components['schemas']['Product'];
export type ProductDetail = components['schemas']['ProductDetail'];
export type ProductPage = components['schemas']['ProductPage'];
export type ProductSchemaRequest = components['schemas']['ProductSchemaRequest'];
export type ProductSchema = components['schemas']['ProductSchema'];
export type SchemaPublishRequest = components['schemas']['SchemaPublishRequest'];
export type ProductMutationResult = components['schemas']['ProductMutationResult'];
export type Photo = components['schemas']['Photo'];
export type PhotoGroup = components['schemas']['PhotoGroup'];
export type PhotoPage = components['schemas']['PhotoPage'];
export type PhotoTransferRequest = components['schemas']['PhotoTransferRequest'];
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
export type { ProductCapabilityRequestMap, ProductCapabilityResponseMap };
export type { RfqCapabilityRequestMap, RfqCapabilityResponseMap };
export type { TradeCapabilityRequestMap, TradeCapabilityResponseMap };
export interface CapabilityRequestMap
  extends ProductCapabilityRequestMap, RfqCapabilityRequestMap, TradeCapabilityRequestMap {}
export interface CapabilityResponseMap
  extends ProductCapabilityResponseMap, RfqCapabilityResponseMap, TradeCapabilityResponseMap {}
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

export interface ProductDisplayRequest {
  productIds: string[];
  display: 'online' | 'offline';
}

export interface PhotoUploadRequest {
  file: string;
  fileName: string;
  groupId?: string;
}

export interface OperationMap {
  getDashboard: { request: undefined; response: DashboardSummary };
  listProducts: { request: ProductListQuery; response: ProductPage };
  getProduct: { request: { productId: string }; response: ProductDetail };
  getProductSchema: { request: ProductSchemaRequest; response: ProductSchema };
  publishProduct: { request: SchemaPublishRequest; response: ProductMutationResult };
  saveProductDraft: { request: SchemaPublishRequest; response: ProductMutationResult };
  updateProduct: {
    request: SchemaPublishRequest & { productId: string };
    response: ProductMutationResult;
  };
  updateProductDisplay: { request: ProductDisplayRequest; response: undefined };
  listPhotoGroups: { request: undefined; response: PhotoGroup[] };
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
}

export type OperationId = keyof OperationMap;
export type RequestOf<K extends OperationId> = OperationMap[K]['request'];
export type ResponseOf<K extends OperationId> = OperationMap[K]['response'];

export interface GatewayClient {
  request<K extends OperationId>(operation: K, request: RequestOf<K>): Promise<ResponseOf<K>>;
}

export interface RuntimeRequest<K extends OperationId = OperationId> {
  id: string;
  kind: 'gateway-request';
  operation: K;
  payload: RequestOf<K>;
}

export type RuntimeResponse<K extends OperationId = OperationId> =
  { id: string; ok: true; data: ResponseOf<K> } | { id: string; ok: false; error: GatewayError };

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
