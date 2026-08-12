import {
  getCapabilityDefinition,
  listCapabilities,
  validateCapabilityRequest,
  validateCapabilityResponse
} from './capability-registry';

import type {
  CapabilityCallRequest,
  GatewayClient,
  OperationId,
  OperationMap,
  Product,
  RequestOf,
  ResponseOf,
  RfqSummary
} from './types';

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

const MOCK_PRODUCT_SCHEMA_XML = `<itemSchema version="2">
  <field id="productTitle" name="商品标题" type="input"><rules><rule name="requiredRule" value="true"/><rule name="minLengthRule" value="5"/><rule name="maxLengthRule" value="128"/><rule name="tipRule" value="面向买家的英文商品标题"/></rules><values><value>Portable solar power station 1000W</value></values></field>
  <field id="scImages" name="商品主图" type="multiInput"><rules><rule name="requiredRule" value="true"/><rule name="maxInputNumRule" value="6"/><rule name="minTargetSizeRule" value="750x750"/></rules><value fileId="ph_001">https://sc04.alicdn.com/kf/mock-solar-station.jpg</value></field>
  <field id="productDescType" name="详情类型" type="label"><value>2</value></field>
  <field id="superText" name="商品详情" type="input"><rules><rule name="requiredRule" value="true"/><rule name="valueTypeRule" value="html"/><rule name="tipRule" value="API 仅支持维护普通详情"/></rules><value>&lt;h2&gt;Portable power for every scenario&lt;/h2&gt;&lt;p&gt;Reliable energy storage for camping, emergency backup, and mobile workstations.&lt;/p&gt;&lt;img src=&quot;https://sc04.alicdn.com/kf/mock-solar-station.jpg&quot; alt=&quot;Portable solar power station front view&quot; data-photobank-file-id=&quot;ph_001&quot;&gt;</value></field>
  <field id="keywords" name="关键词" type="multiInput"><rules><rule name="minInputNumRule" value="2"/><rule name="maxInputNumRule" value="3"/></rules><values><value>solar generator</value><value>portable power station</value></values></field>
  <field id="condition" name="商品状态" type="singleCheck"><options><option displayName="全新" value="new"/><option displayName="翻新" value="refurbished"/></options><values><value>new</value></values></field>
  <field id="certifications" name="认证" type="multiCheck"><options><option displayName="CE" value="ce"/><option displayName="RoHS" value="rohs"/><option displayName="FCC" value="fcc"/></options><values><value>ce</value><value>rohs</value></values></field>
  <field id="dimensions" name="包装尺寸" type="complex"><complex-values><complex-value><field id="length" name="长（cm）" type="input"><rules><rule name="minValueRule" value="1"/><rule name="maxDecimalDigitsRule" value="1"/></rules><values><value>45.5</value></values></field><field id="width" name="宽（cm）" type="input"><values><value>30</value></values></field></complex-value></complex-values></field>
  <field id="variants" name="销售规格" type="multiComplex"><rules><rule name="serverPriceRule" value="required"/></rules><complex-values><complex-value><field id="model" name="型号" type="input"><rules><rule name="requiredRule" value="true"/></rules><values><value>OV-1000</value></values></field><field id="price" name="价格（USD）" type="input"><rules><rule name="minValueRule" value="1"/><rule name="maxDecimalDigitsRule" value="2"/></rules><values><value>599.00</value></values></field></complex-value></complex-values></field>
  <field id="notice" name="发布说明" type="label"><values><value>业务规则由提交接口执行最终校验，本地不执行文档返回的代码。</value></values></field>
  <extension keep="true">Mock 中保留的未知节点</extension>
</itemSchema>`;

const MOCK_DATA: { [K in OperationId]: OperationMap[K]['response'] } = {
  getDashboard: {
    productCount: 128,
    photoCount: 436,
    pendingOrderCount: 6,
    enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length
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
    xml: MOCK_PRODUCT_SCHEMA_XML
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
        url: 'https://sc04.alicdn.com/kf/mock-solar-station.jpg',
        groupId: '2001',
        width: 1200,
        height: 1200,
        fileSize: 286720,
        referenceCount: 4,
        modifiedAt: '2026-08-11T03:20:00Z'
      },
      {
        id: 'ph_002',
        name: 'canvas-bag-natural.jpg',
        url: 'https://sc04.alicdn.com/kf/mock-canvas-bag.jpg',
        groupId: '2001',
        width: 1200,
        height: 1200,
        fileSize: 198400,
        referenceCount: 1,
        modifiedAt: '2026-08-10T09:12:00Z'
      },
      {
        id: 'ph_003',
        name: 'dehydrator-detail.jpg',
        url: 'https://sc04.alicdn.com/kf/mock-dehydrator-detail.jpg',
        groupId: '2002',
        width: 1600,
        height: 1200,
        fileSize: 348160,
        referenceCount: 2,
        modifiedAt: '2026-08-09T11:03:00Z'
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
    height: 800,
    fileSize: 153600,
    referenceCount: 0,
    modifiedAt: '2026-08-12T04:00:00Z'
  },
  transferPhotoFromUrl: {
    id: 'ph_transferred',
    name: 'transferred-image.jpg',
    url: 'https://sc04.alicdn.com/kf/mock-transferred-image.jpg',
    groupId: '2002',
    width: 1200,
    height: 1200,
    fileSize: 245760,
    referenceCount: 0,
    modifiedAt: '2026-08-12T04:01:00Z'
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
  listCapabilities: listCapabilities(),
  getCapabilityDefinition: requireCapabilityDefinition('alibaba.icbu.product.list'),
  callCapability: {
    method: 'alibaba.icbu.product.list',
    traceId: 'mock-capability-trace',
    data: { message: 'Mock 调用成功；真实扩展会由 service worker 发起请求。' },
    contractValid: true,
    contractIssues: []
  },
  listProductCategories: [
    {
      id: 100003109,
      name: 'Consumer Electronics',
      leaf: false,
      children: [
        { id: 100009999, name: 'Portable Power Stations', leaf: true, children: [] },
        { id: 100009998, name: 'Solar Energy Systems', leaf: true, children: [] }
      ]
    },
    {
      id: 100001589,
      name: 'Luggage, Bags & Cases',
      leaf: true,
      children: []
    }
  ],
  mapProductCategory: { sourceCategoryId: 100003109, targetCategoryId: 100009999 },
  getProductLevelSchema: {
    categoryId: 100009999,
    language: 'en_US',
    market: 'wholesale',
    xml: '<itemSchema><field id="model" name="层级型号" type="singleCheck"><rules><rule name="requiredRule" value="true"/></rules><options><option displayName="标准版" value="standard"/><option displayName="专业版" value="pro"/></options><values><value>standard</value></values></field><field id="voltage" name="电压" type="singleCheck"><options><option displayName="110V" value="110"/><option displayName="220V" value="220"/></options><values><value>220</value></values></field></itemSchema>'
  },
  getProductDraft: {
    ...PRIMARY_PRODUCT,
    status: 'draft',
    categoryId: 100003109,
    language: 'en_US',
    schemaXml:
      '<itemSchema><field id="productTitle" name="Product name" type="input"><values><value>Draft portable station</value></values></field></itemSchema>'
  },
  listProductGroups: [
    { id: 1001, name: 'Energy storage', children: [] },
    { id: 1002, name: 'Packaging', children: [] }
  ],
  createProductGroup: { id: 1003, name: 'New group', children: [] },
  getProductScore: {
    productId: '10000001',
    score: 92,
    issues: ['建议补充更多应用场景图片', '建议完善商品关键词']
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
  submitRfqQuotation: { quotationId: 'QT-20260812-001', success: true }
};

export class MockGatewayClient implements GatewayClient {
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
    if (operation === 'getCapabilityDefinition') {
      const payload = _request as OperationMap['getCapabilityDefinition']['request'];
      return structuredClone(requireCapabilityDefinition(payload.method));
    }
    if (operation === 'callCapability') {
      const payload = _request as CapabilityCallRequest;
      const requestIssues = validateCapabilityRequest(payload.method, payload.parameters);
      if (requestIssues.length > 0) {
        throw new Error(
          `请求契约不通过：${requestIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；')}`
        );
      }
      const definition = requireCapabilityDefinition(payload.method);
      const data = structuredClone(definition.responseExample);
      const contractIssues = validateCapabilityResponse(payload.method, data);
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
        fileSize: Math.floor((payload.file.length * 3) / 4),
        referenceCount: 0,
        modifiedAt: new Date().toISOString()
      } as ResponseOf<K>;
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
