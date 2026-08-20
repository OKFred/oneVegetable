import {
  getCapabilityDefinition,
  listCapabilities,
  validateCapabilityRequest,
  validateCapabilityResponse
} from './capability-registry';
import {
  INSIGHTS_MOCK_DATA,
  LOGISTICS_MOCK_DATA,
  PHOTO_MOCK_DATA,
  PRODUCT_MOCK_DATA,
  RFQ_MOCK_DATA,
  SYSTEM_MOCK_DATA,
  TRADE_MOCK_DATA
} from './generated/mock-data';

import type {
  CapabilityCallRequest,
  DiagnosticEntry,
  GatewayClient,
  OperationId,
  OperationMap,
  PhotoGroup,
  RequestOf,
  ResponseOf
} from './types';
import { validateLogisticsOrderInput, validateLogisticsQuoteInput } from './validation';

const PRIMARY_RFQ = RFQ_MOCK_DATA.primaryRfq;
const RFQS = RFQ_MOCK_DATA.rfqs;
const TRADE_ORDERS = TRADE_MOCK_DATA.tradeOrders;
const PRIMARY_LOGISTICS_ORDER = LOGISTICS_MOCK_DATA.primaryLogisticsOrder;
const MOCK_PRODUCT_SCHEMA_XML = PRODUCT_MOCK_DATA.responses.getProductSchema.xml;

const MOCK_DATA: { [K in OperationId]: OperationMap[K]['response'] } = {
  ...PRODUCT_MOCK_DATA.responses,
  ...PHOTO_MOCK_DATA.responses,
  ...RFQ_MOCK_DATA.responses,
  ...TRADE_MOCK_DATA.responses,
  ...LOGISTICS_MOCK_DATA.responses,
  ...INSIGHTS_MOCK_DATA.responses,
  ...SYSTEM_MOCK_DATA.responses,
  updateProductDisplay: undefined,
  deleteTradeAddress: undefined,
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
  listCapabilities: listCapabilities(),
  getCapabilityDefinition: requireCapabilityDefinition('alibaba.icbu.product.list'),
  callCapability: {
    method: 'alibaba.icbu.product.list',
    traceId: 'mock-capability-trace',
    data: { message: 'Mock 调用成功；真实扩展会由 service worker 发起请求。' },
    contractValid: true,
    contractIssues: []
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
