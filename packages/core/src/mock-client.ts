import { API_CAPABILITIES } from './generated/capabilities';

import type { GatewayClient, OperationId, OperationMap, Product, RequestOf, ResponseOf } from './types';

const PRIMARY_PRODUCT: Product = {
  id: '10000001',
  subject: 'Portable solar power station 1000W',
  groupName: 'Energy storage',
  status: 'online',
  score: 92,
  updatedAt: '2026-08-11T03:20:00Z'
};

const PRODUCTS: Product[] = [
  PRIMARY_PRODUCT,
  {
    id: '10000002',
    subject: 'Custom recycled cotton canvas tote bag',
    groupName: 'Packaging',
    status: 'draft',
    score: 76,
    updatedAt: '2026-08-10T09:12:00Z'
  },
  {
    id: '10000003',
    subject: 'Commercial stainless steel food dehydrator',
    groupName: 'Food machinery',
    status: 'auditing',
    score: 84,
    updatedAt: '2026-08-09T11:03:00Z'
  }
];

const MOCK_DATA: { [K in OperationId]: OperationMap[K]['response'] } = {
  getDashboard: {
    productCount: 128,
    photoCount: 436,
    pendingOrderCount: 6,
    enabledCapabilityCount: API_CAPABILITIES.filter((item) => item.enabled).length
  },
  listProducts: { items: PRODUCTS, page: 1, pageSize: 20, total: 128 },
  getProduct: {
    ...PRIMARY_PRODUCT,
    categoryId: 100003109,
    language: 'en_US',
    schemaXml:
      '<itemSchema><field id="productTitle"><value>Portable solar power station 1000W</value></field></itemSchema>'
  },
  getProductSchema: {
    categoryId: 100003109,
    language: 'en_US',
    market: 'wholesale',
    xml: '<itemSchema><field id="productTitle" name="Product name" type="input"><rules><rule name="requiredRule" value="true"/></rules></field></itemSchema>'
  },
  publishProduct: { productId: '10000999', traceId: 'mock-publish-trace', success: true },
  saveProductDraft: { productId: '10000998', traceId: 'mock-draft-trace', success: true },
  updateProduct: { productId: '10000001', traceId: 'mock-update-trace', success: true },
  updateProductDisplay: undefined,
  listPhotoGroups: [
    { id: '-1', name: '全部图片', photoCount: 436 },
    { id: '2001', name: '商品主图', photoCount: 84 },
    { id: '2002', name: '详情素材', photoCount: 137 }
  ],
  listPhotos: {
    items: [
      {
        id: 'ph_001',
        name: 'solar-station-front.jpg',
        url: 'https://placehold.co/800x800/0f172a/f8fafc?text=Solar+Station',
        groupId: '2001',
        width: 1200,
        height: 1200
      },
      {
        id: 'ph_002',
        name: 'canvas-bag-natural.jpg',
        url: 'https://placehold.co/800x800/166534/f8fafc?text=Canvas+Bag',
        groupId: '2001',
        width: 1200,
        height: 1200
      },
      {
        id: 'ph_003',
        name: 'dehydrator-detail.jpg',
        url: 'https://placehold.co/800x800/334155/f8fafc?text=Dehydrator',
        groupId: '2002',
        width: 1600,
        height: 1200
      }
    ],
    page: 1,
    pageSize: 24,
    total: 436
  },
  uploadPhoto: {
    id: 'ph_new',
    name: 'uploaded-image.jpg',
    url: 'https://placehold.co/800x800/155e75/f8fafc?text=Uploaded',
    groupId: '-1',
    width: 800,
    height: 800
  },
  listOrders: {
    items: [
      {
        id: 'ORD-202608-0012',
        buyerName: 'Northwind Trading',
        amount: 2450.5,
        currency: 'USD',
        status: 'awaiting_shipment',
        createdAt: '2026-08-09T08:30:00Z',
        detailAvailability: 'summary_only'
      },
      {
        id: 'ORD-202608-0011',
        buyerName: 'Contoso Retail',
        amount: 980,
        currency: 'USD',
        status: 'paid',
        createdAt: '2026-08-08T02:10:00Z',
        detailAvailability: 'summary_only'
      }
    ],
    page: 1,
    pageSize: 20,
    total: 24
  },
  getOrderFund: {
    orderId: 'ORD-202608-0012',
    paidAmount: 2450.5,
    currency: 'USD',
    status: 'paid'
  },
  getOrderLogistics: {
    orderId: 'ORD-202608-0012',
    status: 'awaiting_shipment',
    carrier: null,
    trackingNumber: null
  },
  listCapabilities: [...API_CAPABILITIES],
  callCapability: {
    method: 'alibaba.icbu.product.list',
    traceId: 'mock-capability-trace',
    data: { message: 'Mock 调用成功；真实扩展会由 service worker 发起请求。' }
  }
};

export class MockGatewayClient implements GatewayClient {
  constructor(private readonly latency = 160) {}

  async request<K extends OperationId>(operation: K, _request: RequestOf<K>): Promise<ResponseOf<K>> {
    await new Promise<void>((resolve) => setTimeout(resolve, this.latency));
    return structuredClone(MOCK_DATA[operation]);
  }
}
