import {
  getCapabilityDefinition,
  listCapabilities,
  validateCapabilityRequest,
  validateCapabilityResponse
} from './capability-registry';
import { PHOTO_MOCK_DATA, PRODUCT_MOCK_DATA } from './generated/mock-data';

import type {
  CapabilityCallRequest,
  DiagnosticEntry,
  GatewayClient,
  LogisticsOrderSummary,
  OperationId,
  OperationMap,
  PhotoGroup,
  RequestOf,
  ResponseOf,
  RfqSummary,
  TradeOrderSummary
} from './types';
import { validateLogisticsOrderInput, validateLogisticsQuoteInput } from './validation';

const PRIMARY_RFQ: RfqSummary = {
  id: 'RFQ-20260812-001',
  subject: 'Portable solar power stations for outdoor retail',
  description: 'Looking for 1000W portable stations with EU and US plugs for a seasonal order.',
  quantity: 300,
  quantityUnit: 'Pieces',
  countryCode: 'DE',
  categoryId: 100003109,
  categoryName: 'Portable Power Stations',
  imageUrl: 'https://placehold.co/640x480/0f766e/ffffff?text=RFQ+Solar',
  remainingQuotes: 6,
  openAt: '2026-08-12T02:00:00.000Z',
  expiresAt: '2026-08-20T15:59:59.000Z',
  read: false,
  recommended: true
};

const RFQS: RfqSummary[] = [
  PRIMARY_RFQ,
  {
    id: 'RFQ-20260811-014',
    subject: 'Recycled cotton canvas tote bags',
    description: 'Custom logo printing, natural color, 12 oz fabric preferred.',
    quantity: 5000,
    quantityUnit: 'Pieces',
    countryCode: 'CA',
    categoryId: 100001589,
    categoryName: 'Shopping Bags',
    imageUrl: null,
    remainingQuotes: 3,
    openAt: '2026-08-11T06:30:00.000Z',
    expiresAt: '2026-08-18T15:59:59.000Z',
    read: true,
    recommended: false
  },
  {
    id: 'RFQ-20260810-021',
    subject: 'Commercial food dehydrator 24 trays',
    description: 'Stainless steel dehydrator for a food processing pilot line.',
    quantity: 12,
    quantityUnit: 'Sets',
    countryCode: 'AU',
    categoryId: 100006001,
    categoryName: 'Food Processing Machinery',
    imageUrl: 'https://placehold.co/640x480/334155/ffffff?text=RFQ+Dehydrator',
    remainingQuotes: 1,
    openAt: '2026-08-10T09:45:00.000Z',
    expiresAt: '2026-08-16T15:59:59.000Z',
    read: false,
    recommended: true
  }
];

const PRIMARY_TRADE_ORDER: TradeOrderSummary = {
  id: '24668306501026709',
  buyerLoginId: 'northwind-buyer',
  status: 'undeliver',
  amount: '2450.50',
  currency: 'USD',
  createdAt: '2026-08-09T08:30:00.000Z',
  modifiedAt: '2026-08-12T02:15:00.000Z'
};

const TRADE_ORDERS: TradeOrderSummary[] = [
  PRIMARY_TRADE_ORDER,
  {
    id: '24668306501026710',
    buyerLoginId: 'contoso-retail',
    status: 'paid',
    amount: '980',
    currency: 'USD',
    createdAt: '2026-08-08T02:10:00.000Z',
    modifiedAt: '2026-08-10T06:40:00.000Z'
  },
  {
    id: '24668306501026711',
    buyerLoginId: 'adventure-works',
    status: 'trade_success',
    amount: '12780.75',
    currency: 'EUR',
    createdAt: '2026-08-05T11:20:00.000Z',
    modifiedAt: '2026-08-12T09:05:00.000Z'
  }
];

const PRIMARY_LOGISTICS_ORDER: LogisticsOrderSummary = {
  orderNumber: 'ALS00201756002',
  status: 'created',
  freightAmount: '109.20',
  currency: 'CNY',
  placedAt: '2026-08-12T03:20:00.000Z'
};

const MOCK_PRODUCT_SCHEMA_XML = PRODUCT_MOCK_DATA.responses.getProductSchema.xml;

const MOCK_DATA: { [K in OperationId]: OperationMap[K]['response'] } = {
  ...PRODUCT_MOCK_DATA.responses,
  ...PHOTO_MOCK_DATA.responses,
  updateProductDisplay: undefined,
  getDashboard: {
    productCount: 128,
    photoCount: 436,
    pendingOrderCount: 6,
    enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length
  },
  getDiagnostics: {
    generatedAt: '2026-08-13T04:00:00.000Z',
    extensionVersion: '2.0.0-mock',
    entries: [
      {
        id: 'mock-diagnostic-1',
        timestamp: '2026-08-13T03:59:59.000Z',
        operation: 'listProducts',
        method: 'alibaba.icbu.product.list',
        outcome: 'success',
        durationMs: 42,
        errorCode: null,
        errorMessage: null,
        traceId: 'mock-trace-products'
      }
    ]
  },
  clearDiagnostics: undefined,
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
  listCapabilities: listCapabilities(),
  getCapabilityDefinition: requireCapabilityDefinition('alibaba.icbu.product.list'),
  callCapability: {
    method: 'alibaba.icbu.product.list',
    traceId: 'mock-capability-trace',
    data: { message: 'Mock 调用成功；真实扩展会由 service worker 发起请求。' },
    contractValid: true,
    contractIssues: []
  },
  listRfqs: { items: RFQS, page: 1, pageSize: 20, total: 38, source: 'search' },
  listRecommendedRfqs: {
    items: RFQS.filter((rfq) => rfq.recommended),
    page: 1,
    pageSize: 20,
    total: 2,
    source: 'recommend'
  },
  getRfq: {
    ...PRIMARY_RFQ,
    paymentTerms: 'L/C or T/T',
    destinationPort: 'Hamburg',
    shippingTerms: 'FOB',
    attachments: [{ name: 'target-specification.pdf', url: 'https://example.com/mock-rfq-spec.pdf' }]
  },
  getRfqEquity: {
    remainingQuotes: 12,
    remainingTopQuotes: 2,
    score: 86,
    beatSupplierPercent: '72%',
    expiresAt: '2026-12-31'
  },
  getRfqReadStatus: {
    statuses: Object.fromEntries(RFQS.map((rfq) => [rfq.id, rfq.read]))
  },
  uploadRfqAttachment: {
    filesString: 'fileId:0|fileSavePath:mock-rfq-attachment.pdf|fileFlag:add'
  },
  submitRfqQuotation: { quotationId: 'QT-20260812-001', success: true },
  listTradeOrders: {
    items: TRADE_ORDERS,
    page: 1,
    pageSize: 20,
    total: TRADE_ORDERS.length,
    documentTimeZoneUnverified: true
  },
  getTradeOrderAggregate: {
    order: PRIMARY_TRADE_ORDER,
    fund: {
      orderId: PRIMARY_TRADE_ORDER.id,
      paidAmount: '2450.50',
      currency: 'USD',
      status: 'PAID'
    },
    logistics: {
      orderId: PRIMARY_TRADE_ORDER.id,
      status: 'UNDELIVERED',
      carrier: null,
      trackingNumber: null
    },
    availability: {
      order: 'available',
      fund: 'available',
      logistics: 'available',
      fullDetail: 'jushita-only'
    }
  },
  getTradeOrderFund: {
    orderId: PRIMARY_TRADE_ORDER.id,
    paidAmount: '2450.50',
    currency: 'USD',
    status: 'PAID'
  },
  getTradeOrderLogistics: {
    orderId: PRIMARY_TRADE_ORDER.id,
    status: 'UNDELIVERED',
    carrier: null,
    trackingNumber: null
  },
  listTradeFulfillmentChannels: [
    { code: 'TAO', name: '一达通', enabled: true, unavailableReason: null },
    { code: 'TAD', name: '小单履约', enabled: false, unavailableReason: '当前订单金额不符合策略' }
  ],
  getTradeServiceCharge: {
    currency: 'USD',
    items: [
      {
        ratio: '0.01',
        maxFee: '100',
        exportServiceType: 'onetouch_service',
        logisticsType: 'useCaiNiaoLogistics'
      }
    ]
  },
  getTradeTtAccount: {
    orderId: PRIMARY_TRADE_ORDER.id,
    payableAmount: '2450.50',
    currency: 'USD',
    accountName: 'Alibaba.com Singapore E-Commerce Private Limited',
    accountNumber: '1029200038060',
    bankName: 'Citibank, N.A., Hong Kong Branch',
    guideContent: '汇款附言中请填写订单号。'
  },
  getTradeAddressSchema: {
    fields: [
      {
        id: 'contact.fullName',
        label: '联系人',
        type: 'text',
        required: true,
        readOnly: false,
        pattern: '^.+$',
        maxLength: 128,
        options: []
      },
      {
        id: 'address.country.code',
        label: '国家/地区',
        type: 'select',
        required: true,
        readOnly: false,
        pattern: null,
        maxLength: null,
        options: [{ label: 'United States', value: 'US' }]
      },
      {
        id: 'address.address',
        label: '地址',
        type: 'textarea',
        required: true,
        readOnly: false,
        pattern: null,
        maxLength: 256,
        options: []
      }
    ]
  },
  listTradeAddresses: [
    {
      id: '120384173001',
      label: 'Northwind warehouse',
      values: {
        'contact.fullName': 'Alex Morgan',
        'contact.mobileNo': '3534534251',
        'address.country.code': 'US',
        'address.city.name': 'Seattle',
        'address.address': '1st Avenue 700'
      }
    }
  ],
  saveTradeAddress: {
    id: '120384173001',
    label: 'Northwind warehouse',
    values: {
      'contact.fullName': 'Alex Morgan',
      'address.country.code': 'US',
      'address.address': '1st Avenue 700'
    }
  },
  deleteTradeAddress: undefined,
  createTradeOrder: { id: '24668306501026999', success: true },
  modifyTradeOrder: { id: PRIMARY_TRADE_ORDER.id, success: true },
  listLogisticsAddressNodes: [
    { id: '330000', code: '330000', name: '浙江省', level: 'province' },
    { id: '310000', code: '310000', name: '上海市', level: 'province' }
  ],
  listLogisticsSpecialProductTypes: [
    {
      code: 'battery',
      name: '电池',
      children: [
        {
          code: 'inlayBattery',
          name: '内置/配置电池',
          children: [{ code: 'oneLessHundredWh', name: '单块电池≤100Wh', children: [] }]
        }
      ]
    }
  ],
  listLogisticsProducts: [
    {
      code: 'EX_ASP_ePacket',
      name: '邮政 e 邮宝',
      warehouseCode: 'ASP_YH_SZJC',
      enabled: true,
      unavailableReason: null
    },
    {
      code: 'EX_ASP_standard3C',
      name: '标准快递（带电）',
      warehouseCode: 'ASP_YH_SZJC',
      enabled: false,
      unavailableReason: '当前目的国暂不可用'
    }
  ],
  calculateLogisticsQuote: {
    options: [
      {
        productCode: 'EX_ASP_ePacket',
        productName: '邮政 e 邮宝',
        totalAmount: '109.20',
        currency: 'CNY',
        estimatedDays: '7-12 business days',
        warehouseCode: 'ASP_YH_SZJC',
        available: true,
        unavailableReason: null
      }
    ],
    issues: []
  },
  listLogisticsOrders: {
    items: [PRIMARY_LOGISTICS_ORDER],
    page: 1,
    pageSize: 20,
    total: 1
  },
  getLogisticsOrder: {
    order: PRIMARY_LOGISTICS_ORDER,
    warehouseName: '越航深圳仓',
    warehouseAddress: '深圳市龙岗区坂田仓库',
    labelUrl: null,
    labelBase64: 'JVBERi0xLjQKJU1vY2sgbGFiZWw=',
    trackingNumber: 'YT202608120001'
  },
  listShippingTemplates: [
    { id: '123', name: '快捷模板' },
    { id: '124', name: '北美包邮模板' }
  ],
  createLogisticsOrder: { orderNumber: 'ALS00201756999', success: true },
  getInsightsSupplierRank: {
    items: [
      { statDate: '2026/08/10', percent: 22.4 },
      { statDate: '2026/08/11', percent: 20.1 },
      { statDate: '2026/08/12', percent: 18.6 }
    ],
    latestPercent: 18.6
  },
  listInsightsSuppliers: {
    supplierIds: ['supplier-enc-001', 'supplier-enc-002'],
    page: 1,
    pageSize: 10,
    total: 2
  },
  listInsightsSupplierProducts: {
    items: [
      {
        id: '10000001',
        subject: 'Portable solar power station 1000W',
        description: 'Portable backup power for outdoor retail and emergency use.',
        categoryId: '100003109',
        priceRange: '599~699',
        priceUnit: '1',
        productUrl: 'https://www.alibaba.com/product-detail/mock.html',
        publishedAt: '2026-08-01',
        attributes: [
          {
            attributeId: '1',
            attributeName: 'Color',
            valueId: '2',
            valueName: 'Black',
            imageUrl: null,
            customValueName: null
          }
        ]
      }
    ],
    page: 1,
    pageSize: 10,
    total: 1
  }
};

export const OPERATION_IDS = Object.freeze(Object.keys(MOCK_DATA) as OperationId[]);
const OPERATION_ID_SET: ReadonlySet<string> = new Set(OPERATION_IDS);

export function isOperationId(value: unknown): value is OperationId {
  return typeof value === 'string' && OPERATION_ID_SET.has(value);
}

export class MockGatewayClient implements GatewayClient {
  private photoGroups: PhotoGroup[] = structuredClone(MOCK_DATA.listPhotoGroups);
  private diagnostics: DiagnosticEntry[] = structuredClone(MOCK_DATA.getDiagnostics.entries);

  constructor(private readonly latency = 160) {}

  async request<K extends OperationId>(operation: K, _request: RequestOf<K>): Promise<ResponseOf<K>> {
    await new Promise<void>((resolve) => setTimeout(resolve, this.latency));
    if (operation === 'getProductSchema') {
      const payload = _request as OperationMap['getProductSchema']['request'];
      if (payload.productId === 'mock-smart') {
        return {
          ...structuredClone(MOCK_DATA.getProductSchema),
          xml: descriptionSchemaVariant('smart')
        } as ResponseOf<K>;
      }
      if (payload.productId === 'mock-legacy') {
        return {
          ...structuredClone(MOCK_DATA.getProductSchema),
          xml: descriptionSchemaVariant('legacy')
        } as ResponseOf<K>;
      }
    }
    if (operation === 'getDiagnostics') {
      return {
        generatedAt: new Date().toISOString(),
        extensionVersion: '2.0.0-mock',
        entries: structuredClone(this.diagnostics)
      };
    }
    if (operation === 'clearDiagnostics') {
      this.diagnostics = [];
      return undefined;
    }
    if (operation === 'getCapabilityDefinition') {
      const payload = _request as OperationMap['getCapabilityDefinition']['request'];
      return structuredClone(requireCapabilityDefinition(payload.method));
    }
    if (operation === 'listPhotoGroups') {
      return structuredClone(this.photoGroups);
    }
    if (operation === 'callCapability') {
      const payload = _request as CapabilityCallRequest;
      const requestIssues = await validateCapabilityRequest(payload.method, payload.parameters);
      if (requestIssues.length > 0) {
        throw new Error(
          `请求契约不通过：${requestIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；')}`
        );
      }
      const definition = requireCapabilityDefinition(payload.method);
      const data = structuredClone(definition.responseExample);
      const contractIssues = await validateCapabilityResponse(payload.method, data);
      return {
        method: payload.method,
        traceId: `mock-${payload.method.replaceAll('.', '-')}`,
        data,
        contractValid: contractIssues.length === 0,
        contractIssues
      } as ResponseOf<K>;
    }
    if (operation === 'uploadPhoto') {
      const payload = _request as OperationMap['uploadPhoto']['request'];
      return {
        id: `ph_upload_${Date.now()}`,
        name: payload.fileName,
        url: `https://sc04.alicdn.com/kf/mock-${encodeURIComponent(payload.fileName)}`,
        groupId: payload.groupId ?? '-1',
        width: 1200,
        height: 1200,
        fileSize: payload.byteLength,
        referenceCount: 0,
        modifiedAt: new Date().toISOString()
      } as ResponseOf<K>;
    }
    if (operation === 'operatePhotoGroup') {
      const payload = _request as OperationMap['operatePhotoGroup']['request'];
      const current = this.photoGroups.find((group) => group.id === payload.groupId);
      const result: PhotoGroup = {
        ...(current ?? MOCK_DATA.operatePhotoGroup),
        id: payload.operation === 'add' ? `group_${Date.now()}` : (payload.groupId ?? '2003'),
        name: payload.groupName ?? current?.name ?? '已删除分组',
        parentId: payload.operation === 'add' ? payload.groupId : (current?.parentId ?? null),
        level: payload.operation === 'add' ? Math.min((current?.level ?? 0) + 1, 3) : (current?.level ?? 1)
      };
      if (payload.operation === 'add') this.photoGroups.push(result);
      if (payload.operation === 'rename' && current) Object.assign(current, result);
      if (payload.operation === 'delete') {
        this.photoGroups = this.photoGroups.filter((group) => group.id !== payload.groupId);
      }
      return structuredClone(result);
    }
    if (operation === 'transferPhotoFromUrl') {
      const payload = _request as OperationMap['transferPhotoFromUrl']['request'];
      const sourceName = new URL(payload.url).pathname.split('/').at(-1);
      return {
        ...structuredClone(MOCK_DATA.transferPhotoFromUrl),
        name: payload.fileName ?? sourceName ?? 'transferred-image.jpg',
        groupId: payload.groupId
      } as ResponseOf<K>;
    }
    if (operation === 'listRfqs' || operation === 'listRecommendedRfqs') {
      const payload = _request as OperationMap['listRfqs']['request'];
      const source = operation === 'listRfqs' ? 'search' : 'recommend';
      const candidates = operation === 'listRfqs' ? RFQS : RFQS.filter((rfq) => rfq.recommended);
      const keywords = payload.keywords?.toLowerCase();
      const items = candidates.filter((rfq) => {
        if (keywords && !`${rfq.subject} ${rfq.description}`.toLowerCase().includes(keywords)) {
          return false;
        }
        if (payload.country && rfq.countryCode !== payload.country) return false;
        return payload.unquotedOnly !== true || (rfq.remainingQuotes ?? 0) > 0;
      });
      return {
        items,
        page: payload.page ?? 1,
        pageSize: payload.pageSize ?? 20,
        total: items.length,
        source
      } as ResponseOf<K>;
    }
    if (operation === 'getRfq') {
      const payload = _request as OperationMap['getRfq']['request'];
      const rfq = RFQS.find((candidate) => candidate.id === payload.rfqId) ?? PRIMARY_RFQ;
      return {
        ...structuredClone(MOCK_DATA.getRfq),
        ...rfq
      };
    }
    if (operation === 'getRfqReadStatus') {
      const payload = _request as OperationMap['getRfqReadStatus']['request'];
      return {
        statuses: Object.fromEntries(
          payload.rfqIds.map((rfqId) => [
            rfqId,
            RFQS.find((candidate) => candidate.id === rfqId)?.read ?? false
          ])
        )
      } as ResponseOf<K>;
    }
    if (operation === 'listTradeOrders') {
      const payload = _request as OperationMap['listTradeOrders']['request'];
      const page = payload.page ?? 1;
      const pageSize = payload.pageSize ?? 20;
      const candidates = TRADE_ORDERS.filter((order) => {
        if (payload.status && order.status !== payload.status) return false;
        if (payload.buyerLoginId && order.buyerLoginId !== payload.buyerLoginId) return false;
        return true;
      });
      return {
        items: candidates.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: candidates.length,
        documentTimeZoneUnverified: true
      } as ResponseOf<K>;
    }
    if (operation === 'getTradeOrderAggregate') {
      const payload = _request as OperationMap['getTradeOrderAggregate']['request'];
      return {
        ...structuredClone(MOCK_DATA.getTradeOrderAggregate),
        order: payload.order,
        fund: { ...structuredClone(MOCK_DATA.getTradeOrderFund), orderId: payload.order.id },
        logistics: {
          ...structuredClone(MOCK_DATA.getTradeOrderLogistics),
          orderId: payload.order.id
        }
      } as ResponseOf<K>;
    }
    if (operation === 'getTradeOrderFund') {
      const payload = _request as { orderId: string };
      return {
        ...structuredClone(MOCK_DATA.getTradeOrderFund),
        orderId: payload.orderId
      };
    }
    if (operation === 'getTradeOrderLogistics') {
      const payload = _request as { orderId: string };
      return {
        ...structuredClone(MOCK_DATA.getTradeOrderLogistics),
        orderId: payload.orderId
      };
    }
    if (operation === 'getTradeTtAccount') {
      const payload = _request as { orderId: string };
      return {
        ...structuredClone(MOCK_DATA.getTradeTtAccount),
        orderId: payload.orderId
      };
    }
    if (operation === 'getTradeServiceCharge') {
      const payload = _request as OperationMap['getTradeServiceCharge']['request'];
      return {
        ...structuredClone(MOCK_DATA.getTradeServiceCharge),
        currency: payload.currency
      } as ResponseOf<K>;
    }
    if (operation === 'saveTradeAddress') {
      const payload = _request as OperationMap['saveTradeAddress']['request'];
      return structuredClone(payload.address);
    }
    if (operation === 'createTradeOrder' || operation === 'modifyTradeOrder') {
      const payload = _request as OperationMap['createTradeOrder']['request'];
      return {
        id: payload.orderId ?? `mock-trade-${Date.now()}`,
        success: true
      } as ResponseOf<K>;
    }
    if (operation === 'listLogisticsAddressNodes') {
      const payload = _request as OperationMap['listLogisticsAddressNodes']['request'];
      const names: Record<typeof payload.level, string[]> = {
        province: ['浙江省', '上海市'],
        city: ['杭州市', '宁波市'],
        division: ['余杭区', '滨江区'],
        street: ['仓前街道', '长河街道']
      };
      return names[payload.level].map((name, index) => ({
        id: `${payload.level}-${index + 1}`,
        code: `${payload.level}-${index + 1}`,
        name,
        level: payload.level
      }));
    }
    if (operation === 'calculateLogisticsQuote') {
      const payload = _request as OperationMap['calculateLogisticsQuote']['request'];
      const validation = validateLogisticsQuoteInput(payload);
      if (!validation.valid) throw new Error(`物流试算参数不合法：${validation.errors.join('；')}`);
      return {
        ...structuredClone(MOCK_DATA.calculateLogisticsQuote),
        options: MOCK_DATA.calculateLogisticsQuote.options.map((option) => ({
          ...option,
          productCode: payload.productCode,
          warehouseCode: payload.warehouseCode
        }))
      } as ResponseOf<K>;
    }
    if (operation === 'listLogisticsOrders') {
      const payload = _request as OperationMap['listLogisticsOrders']['request'];
      const items = payload.orderNumber
        ? [PRIMARY_LOGISTICS_ORDER].filter((item) => item.orderNumber.includes(payload.orderNumber ?? ''))
        : [PRIMARY_LOGISTICS_ORDER];
      return {
        items,
        page: payload.page ?? 1,
        pageSize: payload.pageSize ?? 20,
        total: items.length
      } as ResponseOf<K>;
    }
    if (operation === 'getLogisticsOrder') {
      const payload = _request as OperationMap['getLogisticsOrder']['request'];
      return {
        ...structuredClone(MOCK_DATA.getLogisticsOrder),
        order: { ...PRIMARY_LOGISTICS_ORDER, orderNumber: payload.orderNumber }
      } as ResponseOf<K>;
    }
    if (operation === 'createLogisticsOrder') {
      const payload = _request as OperationMap['createLogisticsOrder']['request'];
      const validation = validateLogisticsOrderInput(payload);
      if (!validation.valid) throw new Error(`物流下单参数不合法：${validation.errors.join('；')}`);
      if (payload.confirmedProductCode !== payload.quoteRequest.productCode) {
        throw new Error('确认的物流产品与最近试算产品不一致，请重新试算');
      }
      return structuredClone(MOCK_DATA.createLogisticsOrder);
    }
    if (operation === 'listInsightsSuppliers') {
      const payload = _request as OperationMap['listInsightsSuppliers']['request'];
      return {
        ...structuredClone(MOCK_DATA.listInsightsSuppliers),
        page: payload.page ?? 1,
        pageSize: payload.pageSize ?? 10
      } as ResponseOf<K>;
    }
    if (operation === 'listInsightsSupplierProducts') {
      const payload = _request as OperationMap['listInsightsSupplierProducts']['request'];
      return {
        ...structuredClone(MOCK_DATA.listInsightsSupplierProducts),
        page: payload.page ?? 1,
        pageSize: payload.pageSize ?? 10
      } as ResponseOf<K>;
    }
    if (operation === 'uploadRfqAttachment') {
      const payload = _request as OperationMap['uploadRfqAttachment']['request'];
      return {
        filesString: `fileId:0|fileSavePath:mock-${encodeURIComponent(payload.fileName)}|fileFlag:add`
      } as ResponseOf<K>;
    }
    return structuredClone(MOCK_DATA[operation]);
  }
}

function descriptionSchemaVariant(variant: 'smart' | 'legacy'): string {
  if (variant === 'smart') {
    return MOCK_PRODUCT_SCHEMA_XML.replace(
      '<field id="productDescType" name="详情类型" type="label"><value>2</value></field>',
      '<field id="productDescType" name="详情类型" type="label"><value>1</value></field>'
    );
  }
  return MOCK_PRODUCT_SCHEMA_XML.replace(
    '&lt;h2&gt;Portable power for every scenario&lt;/h2&gt;&lt;p&gt;Reliable energy storage for camping, emergency backup, and mobile workstations.&lt;/p&gt;&lt;img src=&quot;https://sc04.alicdn.com/kf/mock-solar-station.jpg&quot; alt=&quot;Portable solar power station front view&quot; data-photobank-file-id=&quot;ph_001&quot;&gt;',
    '&lt;div class=&quot;legacy-detail&quot;&gt;&lt;h1 style=&quot;color:red&quot;&gt;Legacy detail&lt;/h1&gt;&lt;p onclick=&quot;track()&quot;&gt;Existing content stays untouched until conversion.&lt;/p&gt;&lt;iframe src=&quot;https://example.com&quot;&gt;&lt;/iframe&gt;&lt;/div&gt;'
  );
}

function requireCapabilityDefinition(method: string) {
  const definition = getCapabilityDefinition(method);
  if (!definition) throw new Error(`能力 ${method} 尚无类型化定义`);
  return definition;
}
