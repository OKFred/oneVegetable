import type { components } from './generated/api';

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
export type Order = components['schemas']['Order'];
export type OrderPage = components['schemas']['OrderPage'];
export type OrderFund = components['schemas']['OrderFund'];
export type OrderLogistics = components['schemas']['OrderLogistics'];
export type ApiCapability = components['schemas']['ApiCapability'];
export type CapabilityCallRequest = components['schemas']['CapabilityCallRequest'];
export type CapabilityCallResult = components['schemas']['CapabilityCallResult'];
export type CapabilityDefinition = components['schemas']['CapabilityDefinition'];
export type CapabilityContractIssue = components['schemas']['CapabilityContractIssue'];
export type CapabilityResponseEnvelope = components['schemas']['CapabilityResponseEnvelope'];
export type ProductCategory = components['schemas']['ProductCategory'];
export type ProductCategoryMapping = components['schemas']['ProductCategoryMapping'];
export type ProductGroup = components['schemas']['ProductGroup'];
export type ProductScore = components['schemas']['ProductScore'];
export type { CapabilityRequestMap, CapabilityResponseMap } from './generated/product-capabilities';
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
