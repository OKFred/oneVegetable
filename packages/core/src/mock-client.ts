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
export { isOperationId, OPERATION_IDS } from './operation-id';

import type {
  CapabilityCallRequest,
  DiagnosticEntry,
  GatewayClient,
  OperationId,
  OperationMap,
  Photo,
  PhotoGroup,
  ProductGroup,
  RequestOf,
  ResponseOf
} from './types';
import { validateLogisticsOrderInput, validateLogisticsQuoteInput } from './validation';
import { APP_VERSION } from './version';

const PRIMARY_RFQ = RFQ_MOCK_DATA.primaryRfq;
const RFQS = RFQ_MOCK_DATA.rfqs;
const TRADE_ORDERS = TRADE_MOCK_DATA.tradeOrders;
const PRIMARY_LOGISTICS_ORDER = LOGISTICS_MOCK_DATA.primaryLogisticsOrder;
const MOCK_PRODUCT_SCHEMA_XML = PRODUCT_MOCK_DATA.responses.getProductSchema.xml;
const PRODUCTS = PRODUCT_MOCK_DATA.responses.listProducts.items;
const PHOTOS = PHOTO_MOCK_DATA.responses.listPhotos.items;

const MOCK_DATA: { [K in OperationId]: OperationMap[K]['response'] } = {
  ...PRODUCT_MOCK_DATA.responses,
  ...PHOTO_MOCK_DATA.responses,
  ...RFQ_MOCK_DATA.responses,
  ...TRADE_MOCK_DATA.responses,
  ...LOGISTICS_MOCK_DATA.responses,
  ...INSIGHTS_MOCK_DATA.responses,
  ...SYSTEM_MOCK_DATA.responses,
  renderProductSchema: structuredClone(PRODUCT_MOCK_DATA.responses.getProductSchema),
  deleteTradeAddress: undefined,
  getDashboard: {
    productCount: PRODUCTS.length,
    photoCount: PHOTOS.length,
    orderCount: 6,
    enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length,
    metricStatuses: {
      productCount: { state: 'available', source: 'gateway', reasonCode: null },
      photoCount: { state: 'available', source: 'gateway', reasonCode: null },
      orderCount: { state: 'available', source: 'gateway', reasonCode: null },
      enabledCapabilityCount: { state: 'available', source: 'catalog', reasonCode: null }
    }
  },
  getDiagnostics: {
    generatedAt: '2026-08-13T04:00:00.000Z',
    extensionVersion: `${APP_VERSION}-mock`,
    entries: [
      {
        id: 'mock-diagnostic-1',
        requestId: '3d7c8523-93cc-48b7-a615-a23d2976c516',
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

export class MockGatewayClient implements GatewayClient {
  private photoGroups: PhotoGroup[] = structuredClone(MOCK_DATA.listPhotoGroups);
  private photos: Photo[] = structuredClone(PHOTOS);
  private diagnostics: DiagnosticEntry[] = structuredClone(MOCK_DATA.getDiagnostics.entries);

  constructor(private readonly latency = 160) {}

  async request<K extends OperationId>(operation: K, _request: RequestOf<K>): Promise<ResponseOf<K>> {
    await new Promise<void>((resolve) => setTimeout(resolve, this.latency));
    if (operation === 'listProducts') {
      const payload = _request as OperationMap['listProducts']['request'];
      const { page, pageSize, start, end } = paginationWindow(payload.page, payload.pageSize, 20);
      const subject = payload.subject?.trim().toLocaleLowerCase();
      const groupName = payload.groupId
        ? findProductGroup(MOCK_DATA.listProductGroups, payload.groupId)?.name
        : undefined;
      const candidates = PRODUCTS.filter((product) => {
        if (subject && !product.subject.toLocaleLowerCase().includes(subject)) return false;
        return !groupName || product.groupName === groupName;
      });
      return {
        items: structuredClone(candidates.slice(start, end)),
        page,
        pageSize,
        total: candidates.length
      } as ResponseOf<K>;
    }
    if (operation === 'listPhotos') {
      const payload = _request as OperationMap['listPhotos']['request'];
      const { page, pageSize, start, end } = paginationWindow(payload.page, payload.pageSize, 24);
      const candidates =
        !payload.groupId || payload.groupId === '-1'
          ? this.photos
          : this.photos.filter((photo) => photo.groupId === payload.groupId);
      return {
        items: structuredClone(candidates.slice(start, end)),
        page,
        pageSize,
        total: candidates.length
      } as ResponseOf<K>;
    }
    if (operation === 'getProductSchema' || operation === 'renderProductSchema') {
      const payload = _request as
        OperationMap['getProductSchema']['request'] | OperationMap['renderProductSchema']['request'];
      if (payload.productId === 'mock-smart' || payload.productId === '10000002') {
        return {
          ...structuredClone(MOCK_DATA.getProductSchema),
          xml: descriptionSchemaVariant('smart')
        } as ResponseOf<K>;
      }
      if (payload.productId === 'mock-legacy' || payload.productId === '10000003') {
        return {
          ...structuredClone(MOCK_DATA.getProductSchema),
          xml: descriptionSchemaVariant('legacy')
        } as ResponseOf<K>;
      }
    }
    if (operation === 'getDiagnostics') {
      return {
        generatedAt: new Date().toISOString(),
        extensionVersion: `${APP_VERSION}-mock`,
        entries: structuredClone(this.diagnostics)
      };
    }
    if (operation === 'getDashboard') {
      return {
        ...structuredClone(MOCK_DATA.getDashboard),
        photoCount: this.photos.length
      } as ResponseOf<K>;
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
      const payload = _request as OperationMap['listPhotoGroups']['request'];
      if (!payload?.parentId) {
        return structuredClone(this.photoGroups.filter((group) => group.parentId === null));
      }
      const parentId = payload.parentId;
      return structuredClone(
        this.photoGroups.filter(
          (group) => group.id === parentId || isPhotoGroupDescendant(this.photoGroups, group, parentId)
        )
      );
    }
    if (operation === 'listProductGroups') {
      const payload = _request as OperationMap['listProductGroups']['request'];
      if (payload?.parentId === undefined) return structuredClone(MOCK_DATA.listProductGroups);
      const parent = findProductGroup(MOCK_DATA.listProductGroups, payload.parentId);
      return structuredClone(parent?.children ?? []);
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
      const photo: Photo = {
        id: `ph_upload_${Date.now()}`,
        name: payload.fileName,
        url: MOCK_DATA.uploadPhoto.url,
        groupId: payload.groupId ?? '-1',
        width: 1200,
        height: 1200,
        fileSize: payload.byteLength,
        referenceCount: 0,
        modifiedAt: new Date().toISOString()
      };
      this.photos.unshift(photo);
      this.incrementPhotoGroupCount(photo.groupId);
      return structuredClone(photo);
    }
    if (operation === 'operatePhotoGroup') {
      const payload = _request as OperationMap['operatePhotoGroup']['request'];
      const current = this.photoGroups.find((group) => group.id === payload.groupId);
      const result: PhotoGroup = {
        ...(current ??
          MOCK_DATA.operatePhotoGroup.group ?? {
            id: '2003',
            name: '新建分组',
            photoCount: 0,
            parentId: null,
            level: 1
          }),
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
      return structuredClone({
        operation: payload.operation,
        groupId: result.id,
        group: payload.operation === 'delete' ? null : result
      });
    }
    if (operation === 'transferPhotoFromUrl') {
      const payload = _request as OperationMap['transferPhotoFromUrl']['request'];
      const sourceName = new URL(payload.url).pathname.split('/').at(-1);
      const photo: Photo = {
        ...structuredClone(MOCK_DATA.transferPhotoFromUrl),
        id: `ph_transfer_${Date.now()}`,
        name: payload.fileName ?? sourceName ?? 'transferred-image.jpg',
        groupId: payload.groupId
      };
      this.photos.unshift(photo);
      this.incrementPhotoGroupCount(photo.groupId);
      return structuredClone(photo);
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

  private incrementPhotoGroupCount(groupId: string): void {
    for (const group of this.photoGroups) {
      if (group.id === '-1' || group.id === groupId) group.photoCount += 1;
    }
  }
}

function isPhotoGroupDescendant(groups: PhotoGroup[], group: PhotoGroup, ancestorId: string): boolean {
  let parentId = group.parentId;
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = groups.find((candidate) => candidate.id === parentId)?.parentId ?? null;
  }
  return false;
}

function findProductGroup(groups: readonly ProductGroup[], groupId: number): ProductGroup | null {
  for (const group of groups) {
    if (group.id === groupId) return group;
    const nested = findProductGroup(group.children, groupId);
    if (nested) return nested;
  }
  return null;
}

function paginationWindow(
  requestedPage: number | undefined,
  requestedPageSize: number | undefined,
  defaultPageSize: number
): { page: number; pageSize: number; start: number; end: number } {
  const page = normalizePositiveInteger(requestedPage, 1);
  const pageSize = normalizePositiveInteger(requestedPageSize, defaultPageSize);
  const start = (page - 1) * pageSize;
  return { page, pageSize, start, end: start + pageSize };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
