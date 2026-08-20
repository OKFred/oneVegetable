import { browser } from 'wxt/browser';

import {
  AlibabaClient,
  ALIBABA_GATEWAY,
  createCredentialVault,
  CredentialVaultError,
  CredentialVaultSession,
  downloadPhotoForUpload,
  findCapability,
  GatewayException,
  getCapabilityDefinition,
  InsightsAdapter,
  isAlibabaLanguage,
  isRequestId,
  listCapabilities,
  LogisticsAdapter,
  normalizeGatewayError,
  inspectCredentialStorage,
  resealCredentialVault,
  sanitizeDiagnosticMessage,
  SETTINGS_STORAGE_KEY,
  unlockCredentialVault,
  PhotoAdapter,
  ProductAdapter,
  RfqAdapter,
  TradeAdapter,
  validateCapabilityRequest,
  validateCapabilityResponse,
  type ApiCapability,
  type AlibabaLanguage,
  type CredentialVaultRequest,
  type CredentialVaultResponse,
  type CredentialVaultStatus,
  type DiagnosticEntry,
  type DiagnosticsSnapshot,
  type GatewaySettings,
  type OperationId,
  type RequestOf,
  type RuntimeRequest,
  type RuntimeResponse
} from '@one-vegetable/core';

const OPERATIONS = new Set<OperationId>([
  'getDashboard',
  'getDiagnostics',
  'clearDiagnostics',
  'listProducts',
  'getProduct',
  'getProductSchema',
  'renderProductSchema',
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'listPhotoGroups',
  'operatePhotoGroup',
  'listPhotos',
  'uploadPhoto',
  'transferPhotoFromUrl',
  'listOrders',
  'getOrderFund',
  'getOrderLogistics',
  'listCapabilities',
  'getCapabilityDefinition',
  'listProductCategories',
  'mapProductCategory',
  'getProductLevelSchema',
  'getProductDraft',
  'listProductGroups',
  'createProductGroup',
  'getProductScore',
  'listRfqs',
  'listRecommendedRfqs',
  'getRfq',
  'getRfqEquity',
  'getRfqReadStatus',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'listTradeOrders',
  'getTradeOrderAggregate',
  'getTradeOrderFund',
  'getTradeOrderLogistics',
  'listTradeFulfillmentChannels',
  'getTradeServiceCharge',
  'getTradeTtAccount',
  'getTradeAddressSchema',
  'listTradeAddresses',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createTradeOrder',
  'modifyTradeOrder',
  'listLogisticsAddressNodes',
  'listLogisticsSpecialProductTypes',
  'listLogisticsProducts',
  'calculateLogisticsQuote',
  'listLogisticsOrders',
  'getLogisticsOrder',
  'listShippingTemplates',
  'createLogisticsOrder',
  'getInsightsSupplierRank',
  'listInsightsSuppliers',
  'listInsightsSupplierProducts',
  'callCapability'
]);

const MUTATION_OPERATIONS = new Set<OperationId>([
  'publishProduct',
  'saveProductDraft',
  'updateProduct',
  'updateProductDisplay',
  'uploadPhoto',
  'operatePhotoGroup',
  'transferPhotoFromUrl',
  'createProductGroup',
  'uploadRfqAttachment',
  'submitRfqQuotation',
  'saveTradeAddress',
  'deleteTradeAddress',
  'createTradeOrder',
  'modifyTradeOrder',
  'createLogisticsOrder'
]);

const QUALIFICATION_GATED_LOGISTICS_OPERATIONS = new Set<OperationId>([
  'listLogisticsAddressNodes',
  'listLogisticsSpecialProductTypes',
  'listLogisticsProducts',
  'calculateLogisticsQuote',
  'listLogisticsOrders',
  'getLogisticsOrder',
  'createLogisticsOrder'
]);

export default defineBackground(() => {
  const storageAccessReady = restrictStorageToTrustedContexts();
  // WebExtension runtime listeners support returning a promise for the response.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  browser.runtime.onMessage.addListener((value: unknown) => {
    const vaultMessage = asCredentialVaultRequest(value);
    if (vaultMessage) return handleCredentialVaultRequest(vaultMessage, storageAccessReady);
    const message = asRuntimeRequest(value);
    if (!message) return undefined;
    return handleRequestAfterStorageReady(message, storageAccessReady);
  });
});

async function restrictStorageToTrustedContexts(): Promise<void> {
  await Promise.all([
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]);
}

const vaultSession = new CredentialVaultSession();

async function handleCredentialVaultRequest(
  message: CredentialVaultRequest,
  storageAccessReady: Promise<void>
): Promise<CredentialVaultResponse> {
  try {
    await storageAccessReady;
    const data = await executeCredentialVaultOperation(message.operation, message.payload);
    return { requestId: message.requestId, ok: true, data };
  } catch (error: unknown) {
    return { requestId: message.requestId, ok: false, error: normalizeVaultError(error) };
  }
}

async function executeCredentialVaultOperation(operation: string, payload: unknown): Promise<unknown> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const present = Object.prototype.hasOwnProperty.call(stored, SETTINGS_STORAGE_KEY);
  const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY], present);

  switch (operation) {
    case 'status':
      return credentialVaultStatus(state);
    case 'get-settings':
      return editableSettings(state);
    case 'unlock': {
      if (state.kind !== 'vault') throw vaultStateError(state.kind);
      const unlocked = await unlockCredentialVault(state.record, requiredVaultString(payload, 'passphrase'));
      vaultSession.activate({ ...unlocked, record: state.record });
      return credentialVaultStatus(state);
    }
    case 'lock':
      vaultSession.lock('manual');
      return credentialVaultStatus(state);
    case 'create': {
      if (state.kind !== 'empty') throw new Error('只有空保险库可以创建新凭证');
      const request = asRecord(payload);
      const settings = requiredGatewaySettings(request.settings);
      const created = await createCredentialVault(settings, requiredString(request, 'passphrase'));
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: created.record });
      vaultSession.activate({ ...created, settings });
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'migrate': {
      if (state.kind !== 'legacy') throw new Error('当前没有待迁移的旧版明文凭证');
      const created = await createCredentialVault(state.settings, requiredVaultString(payload, 'passphrase'));
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: created.record });
      vaultSession.activate({ ...created, settings: state.settings });
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'save': {
      const current = getUnlockedVault(state);
      const patch = asRecord(payload);
      const settings: GatewaySettings = {
        appKey: optionalVaultString(patch.appKey) ?? current.settings.appKey,
        appSecret: optionalVaultString(patch.appSecret) ?? current.settings.appSecret,
        accessToken: optionalVaultString(patch.accessToken) ?? current.settings.accessToken,
        endpoint: requiredString(patch, 'endpoint'),
        signMethod: requiredSignMethod(patch.signMethod)
      };
      const record = await resealCredentialVault(current.record, settings, current.key, current.policy);
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: record });
      vaultSession.activate({ ...current, record, settings });
      return credentialVaultStatus({ kind: 'vault', record });
    }
    case 'rotate': {
      const current = getUnlockedVault(state);
      const created = await createCredentialVault(
        current.settings,
        requiredVaultString(payload, 'newPassphrase'),
        current.policy
      );
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: created.record });
      vaultSession.activate({ ...created, settings: current.settings });
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'update-policy': {
      const current = getUnlockedVault(state);
      const policy = { idleTimeoutMinutes: requiredNumber(asRecord(payload), 'idleTimeoutMinutes') };
      const record = await resealCredentialVault(current.record, current.settings, current.key, policy);
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: record });
      vaultSession.activate({ ...current, record, policy });
      return credentialVaultStatus({ kind: 'vault', record });
    }
    default:
      throw new Error('不支持的保险库操作');
  }
}

function credentialVaultStatus(state: ReturnType<typeof inspectCredentialStorage>): CredentialVaultStatus {
  const activeSession = state.kind === 'vault' ? vaultSession.read(state.record) : undefined;
  const activeVault = activeSession?.value;
  const settings = state.kind === 'legacy' ? state.settings : activeVault?.settings;
  const effectiveState = state.kind === 'vault' ? (activeSession ? 'unlocked' : 'locked') : state.kind;
  return {
    state: effectiveState,
    hasAppKey: Boolean(settings?.appKey),
    hasAppSecret: Boolean(settings?.appSecret),
    hasAccessToken: Boolean(settings?.accessToken),
    appKey: settings?.appKey ?? '',
    endpoint: settings?.endpoint ?? ALIBABA_GATEWAY,
    signMethod: settings?.signMethod ?? 'hmac',
    idleTimeoutMinutes: activeVault?.policy.idleTimeoutMinutes ?? null,
    lastActivityAt: activeSession ? new Date(activeSession.lastActivityAt).toISOString() : null,
    idleRemainingSeconds: activeSession?.remainingSeconds ?? null,
    lockReason: effectiveState === 'locked' ? vaultSession.lockReason : null
  };
}

function editableSettings(state: ReturnType<typeof inspectCredentialStorage>): GatewaySettings {
  const settings =
    state.kind === 'legacy'
      ? state.settings
      : state.kind === 'vault'
        ? getUnlockedVault(state).settings
        : undefined;
  return {
    appKey: settings?.appKey ?? '',
    appSecret: '',
    accessToken: '',
    endpoint: settings?.endpoint ?? ALIBABA_GATEWAY,
    signMethod: settings?.signMethod ?? 'hmac'
  };
}

function getUnlockedVault(state: ReturnType<typeof inspectCredentialStorage>) {
  if (state.kind !== 'vault') throw vaultStateError(state.kind);
  const activeSession = vaultSession.read(state.record, true);
  if (!activeSession) throw vaultStateError(state.kind);
  return activeSession.value;
}

function vaultStateError(kind: ReturnType<typeof inspectCredentialStorage>['kind']): GatewayException {
  const details =
    kind === 'legacy'
      ? ['CREDENTIAL_VAULT_MIGRATION_REQUIRED', '旧版明文凭证必须先迁移到加密保险库']
      : kind === 'invalid'
        ? ['CREDENTIAL_VAULT_INVALID', '凭证存储格式无效，请清除本地数据后重新配置']
        : kind === 'empty'
          ? ['CREDENTIAL_VAULT_EMPTY', '请先创建凭证保险库']
          : vaultSession.lockReason === 'idle'
            ? ['CREDENTIAL_VAULT_IDLE_TIMEOUT', '凭证保险库因空闲超时已自动锁定，请重新解锁']
            : ['CREDENTIAL_VAULT_LOCKED', '凭证保险库已锁定，请先在设置中解锁'];
  const [code, message] = details as [string, string];
  return new GatewayException({ code, message, retryable: false });
}

function normalizeVaultError(error: unknown): ReturnType<typeof normalizeGatewayError> {
  if (error instanceof CredentialVaultError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  return normalizeGatewayError(error);
}

async function handleRequest(message: RuntimeRequest): Promise<RuntimeResponse> {
  if (message.operation === 'getDiagnostics' || message.operation === 'clearDiagnostics') {
    try {
      const data = await executeOperation(message.operation, message.payload);
      return { requestId: message.requestId, ok: true, data } as RuntimeResponse;
    } catch (error: unknown) {
      return { requestId: message.requestId, ok: false, error: normalizeGatewayError(error) };
    }
  }
  const startedAt = performance.now();
  try {
    const data = await executeOperation(message.operation, message.payload);
    await safelyRecordDiagnostic({
      operation: message.operation,
      method: diagnosticMethod(message.operation, message.payload),
      outcome: 'success',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: null,
      errorMessage: null,
      traceId: readResultTraceId(data)
    });
    return { requestId: message.requestId, ok: true, data } as RuntimeResponse;
  } catch (error: unknown) {
    const normalized = normalizeGatewayError(error);
    await safelyRecordDiagnostic({
      operation: message.operation,
      method: diagnosticMethod(message.operation, message.payload),
      outcome: 'error',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: normalized.code,
      errorMessage: sanitizeDiagnosticMessage(normalized.message),
      traceId: normalized.traceId ?? null
    });
    return { requestId: message.requestId, ok: false, error: normalized };
  }
}

async function handleRequestAfterStorageReady(
  message: RuntimeRequest,
  storageAccessReady: Promise<void>
): Promise<RuntimeResponse> {
  try {
    await storageAccessReady;
  } catch (error: unknown) {
    return { requestId: message.requestId, ok: false, error: normalizeGatewayError(error) };
  }
  return handleRequest(message);
}

async function executeOperation(operation: OperationId, payload: unknown): Promise<unknown> {
  if (operation === 'getDiagnostics') return getDiagnostics();
  if (operation === 'clearDiagnostics') {
    await clearDiagnostics();
    return undefined;
  }
  if (operation === 'listCapabilities') return listCapabilities();
  if (operation === 'getCapabilityDefinition') {
    const definition = getCapabilityDefinition(requiredString(asRecord(payload), 'method'));
    if (!definition) throw new Error('该能力尚无类型化定义');
    return definition;
  }

  const settings = await loadSettings();
  assertCredentials(settings);
  if (MUTATION_OPERATIONS.has(operation)) {
    throw new GatewayException({
      code: 'REAL_MUTATION_DISABLED',
      message: '真实写操作尚未通过账号 smoke test，当前扩展版本保持禁用',
      retryable: false
    });
  }
  if (QUALIFICATION_GATED_LOGISTICS_OPERATIONS.has(operation)) {
    throw new GatewayException({
      code: 'LOGISTICS_QUALIFICATION_REQUIRED',
      message: 'OneTouch 国际物流能力需要业务资格，当前账号尚未完成资格与真实接口验收',
      retryable: false
    });
  }
  const client = AlibabaClient.create(settings, {
    maxAttempts: 3,
    shouldRetry: (method, error) => error.retryable && findCapability(method)?.risk === 'read'
  });
  const products = new ProductAdapter(client);
  const rfqs = new RfqAdapter(client);
  const trades = new TradeAdapter(client);
  const logistics = new LogisticsAdapter(client);
  const insights = new InsightsAdapter(client);
  const photos = new PhotoAdapter(client);
  const request = asRecord(payload);

  switch (operation) {
    case 'getDashboard': {
      const [products, photos, orders] = await Promise.all([
        client.call('alibaba.icbu.product.list', { language: 'ENGLISH', current_page: 1, page_size: 1 }),
        client.call('alibaba.icbu.photobank.list', {
          current_page: 1,
          page_size: 1,
          location_type: 'ALL_GROUP'
        }),
        trades.list({ page: 1, pageSize: 1 })
      ]);
      return {
        productCount: readNumber(unwrap(products.data, products.method), ['total_count', 'total']) ?? 0,
        photoCount: readNumber(unwrap(photos.data, photos.method), ['total_count', 'total']) ?? 0,
        pendingOrderCount: orders.total,
        enabledCapabilityCount: listCapabilities().filter((item) => item.enabled).length
      };
    }
    case 'listProducts':
      return products.list(payload as RequestOf<'listProducts'>);
    case 'getProduct':
      return products.get(requiredString(request, 'productId'));
    case 'getProductSchema':
      return products.getSchema(payload as RequestOf<'getProductSchema'>);
    case 'renderProductSchema':
      return products.renderSchema(payload as RequestOf<'renderProductSchema'>);
    case 'publishProduct':
      return products.mutate('alibaba.icbu.product.schema.add', payload as RequestOf<'publishProduct'>);
    case 'saveProductDraft':
      return products.mutate(
        'alibaba.icbu.product.schema.add.draft',
        payload as RequestOf<'saveProductDraft'>
      );
    case 'updateProduct':
      return products.mutate('alibaba.icbu.product.schema.update', payload as RequestOf<'updateProduct'>);
    case 'updateProductDisplay':
      return products.updateDisplay(payload as RequestOf<'updateProductDisplay'>);
    case 'listProductCategories':
      return products.listCategories(readNumber(request, ['parentId']));
    case 'mapProductCategory':
      return products.mapCategory(requiredNumber(request, 'categoryId'));
    case 'getProductLevelSchema':
      return products.getLevelSchema(payload as RequestOf<'getProductLevelSchema'>);
    case 'getProductDraft':
      return products.get(
        requiredString(request, 'productId'),
        true,
        requiredAlibabaLanguage(request, 'language')
      );
    case 'listProductGroups':
      return products.listGroups(readNumber(request, ['parentId']));
    case 'createProductGroup':
      return products.createGroup(payload as RequestOf<'createProductGroup'>);
    case 'getProductScore':
      return products.getScore(requiredString(request, 'productId'));
    case 'listRfqs':
      return rfqs.list(payload as RequestOf<'listRfqs'>);
    case 'listRecommendedRfqs':
      return rfqs.listRecommended(payload as RequestOf<'listRecommendedRfqs'>);
    case 'getRfq':
      return rfqs.get(requiredString(request, 'rfqId'));
    case 'getRfqEquity':
      return rfqs.getEquity();
    case 'getRfqReadStatus':
      return rfqs.getReadStatus(requiredStringArray(request, 'rfqIds'));
    case 'uploadRfqAttachment':
      return rfqs.uploadAttachment(payload as RequestOf<'uploadRfqAttachment'>);
    case 'submitRfqQuotation':
      return rfqs.submitQuotation(payload as RequestOf<'submitRfqQuotation'>);
    case 'listTradeOrders':
      return trades.list(payload as RequestOf<'listTradeOrders'>);
    case 'getTradeOrderAggregate':
      return trades.getAggregate((payload as RequestOf<'getTradeOrderAggregate'>).order);
    case 'getTradeOrderFund':
      return trades.getFund(requiredString(request, 'orderId'));
    case 'getTradeOrderLogistics':
      return trades.getLogistics(requiredString(request, 'orderId'));
    case 'listTradeFulfillmentChannels':
      return trades.listFulfillmentChannels(readString(request, ['language']));
    case 'getTradeServiceCharge':
      return trades.getServiceCharge(requiredString(request, 'currency'));
    case 'getTradeTtAccount':
      return trades.getTtAccount(requiredString(request, 'orderId'));
    case 'getTradeAddressSchema':
      return trades.getAddressSchema(
        requiredString(request, 'countryCode'),
        readString(request, ['language'])
      );
    case 'listTradeAddresses':
      return trades.listAddresses(requiredString(request, 'buyerEmail'));
    case 'saveTradeAddress':
      return trades.saveAddress(payload as RequestOf<'saveTradeAddress'>);
    case 'deleteTradeAddress':
      return trades.deleteAddress(requiredString(request, 'addressId'));
    case 'createTradeOrder':
    case 'modifyTradeOrder':
      throw new Error('信保订单写入需要真实账号逐方法验收，当前保持禁用');
    case 'listLogisticsAddressNodes':
      return logistics.listAddressNodes(payload as RequestOf<'listLogisticsAddressNodes'>);
    case 'listLogisticsSpecialProductTypes':
      return logistics.listSpecialProductTypes();
    case 'listLogisticsProducts':
      return logistics.listProducts();
    case 'calculateLogisticsQuote':
      return logistics.calculateQuote(payload as RequestOf<'calculateLogisticsQuote'>);
    case 'listLogisticsOrders':
      return logistics.listOrders(payload as RequestOf<'listLogisticsOrders'>);
    case 'getLogisticsOrder':
      return logistics.getOrder(requiredString(request, 'orderNumber'));
    case 'listShippingTemplates':
      return logistics.listShippingTemplates();
    case 'createLogisticsOrder':
      return logistics.createOrder(payload as RequestOf<'createLogisticsOrder'>);
    case 'getInsightsSupplierRank':
      return insights.getSupplierRank();
    case 'listInsightsSuppliers':
      return insights.listSuppliers(payload as RequestOf<'listInsightsSuppliers'>);
    case 'listInsightsSupplierProducts':
      return insights.listSupplierProducts(payload as RequestOf<'listInsightsSupplierProducts'>);
    case 'listPhotoGroups':
      return photos.listGroups(readString(request, ['parentId']));
    case 'operatePhotoGroup':
      return photos.operateGroup(payload as RequestOf<'operatePhotoGroup'>);
    case 'listPhotos':
      return photos.list(payload as RequestOf<'listPhotos'>);
    case 'uploadPhoto':
      return photos.upload(payload as RequestOf<'uploadPhoto'>);
    case 'transferPhotoFromUrl': {
      const downloaded = await downloadPhotoForUpload(payload as RequestOf<'transferPhotoFromUrl'>);
      return photos.upload({
        contentBase64: downloaded.contentBase64,
        fileName: downloaded.fileName,
        contentType: downloaded.contentType,
        byteLength: downloaded.byteLength,
        ...(downloaded.groupId ? { groupId: downloaded.groupId } : {})
      });
    }
    case 'listOrders': {
      const status = readString(request, ['status']);
      const page = await trades.list({
        page: readNumber(request, ['page']) ?? 1,
        pageSize: readNumber(request, ['pageSize']) ?? 20,
        ...(status ? { status } : {})
      });
      return {
        items: page.items.map((item) => ({
          id: item.id,
          buyerName: item.buyerLoginId ?? '未知买家',
          amount: Number(item.amount),
          currency: item.currency,
          status: item.status,
          createdAt: item.createdAt ?? '',
          detailAvailability: 'summary_only'
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total
      };
    }
    case 'getOrderFund': {
      const orderId = requiredString(request, 'orderId');
      const call = await client.call('alibaba.seller.order.fund.get', { e_trade_id: orderId });
      const root = unwrap(call.data, call.method);
      return {
        orderId,
        paidAmount: readNumber(root, ['paid_amount', 'amount']) ?? 0,
        currency: readString(root, ['currency']) ?? 'USD',
        status: readString(root, ['status']) ?? 'unknown'
      };
    }
    case 'getOrderLogistics': {
      const orderId = requiredString(request, 'orderId');
      const call = await client.call('alibaba.seller.order.logistics.get', { e_trade_id: orderId });
      const root = unwrap(call.data, call.method);
      return {
        orderId,
        status: readString(root, ['status']) ?? 'unknown',
        carrier: readString(root, ['carrier', 'logistics_company']) ?? null,
        trackingNumber: readString(root, ['tracking_number', 'logistics_no']) ?? null
      };
    }
    case 'callCapability': {
      const method = requiredString(request, 'method');
      const capability = findCapability(method);
      assertCallable(capability);
      const parameters = asRecord(request.parameters);
      const requestIssues = await validateCapabilityRequest(method, parameters);
      if (requestIssues.length > 0) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: requestIssues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；'),
          retryable: false
        });
      }
      const call = await client.call(method, parameters);
      const data = unwrap(call.data, method);
      const contractIssues = await validateCapabilityResponse(method, data);
      return {
        method,
        traceId: readTraceId(call.data) ?? crypto.randomUUID(),
        data,
        contractValid: contractIssues.length === 0,
        contractIssues
      };
    }
  }
}

const DIAGNOSTICS_KEY = 'diagnosticEntries';
const MAX_DIAGNOSTIC_ENTRIES = 100;
let diagnosticsWrite = Promise.resolve();

type DiagnosticInput = Omit<DiagnosticEntry, 'id' | 'timestamp'>;

async function safelyRecordDiagnostic(input: DiagnosticInput): Promise<void> {
  try {
    await recordDiagnostic(input);
  } catch (error: unknown) {
    console.warn('[oneVegetable] diagnostic write failed', normalizeGatewayError(error).code);
  }
}

function recordDiagnostic(input: DiagnosticInput): Promise<void> {
  diagnosticsWrite = diagnosticsWrite
    .catch(() => undefined)
    .then(async () => {
      const stored = await browser.storage.session.get(DIAGNOSTICS_KEY);
      const entries = diagnosticEntries(stored[DIAGNOSTICS_KEY]);
      entries.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input });
      await browser.storage.session.set({
        [DIAGNOSTICS_KEY]: entries.slice(-MAX_DIAGNOSTIC_ENTRIES)
      });
    });
  return diagnosticsWrite;
}

async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  await diagnosticsWrite;
  const stored = await browser.storage.session.get(DIAGNOSTICS_KEY);
  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: browser.runtime.getManifest().version,
    entries: diagnosticEntries(stored[DIAGNOSTICS_KEY])
  };
}

async function clearDiagnostics(): Promise<void> {
  await diagnosticsWrite;
  await browser.storage.session.remove(DIAGNOSTICS_KEY);
}

function diagnosticEntries(value: unknown): DiagnosticEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (isDiagnosticEntry(entry) ? [entry] : [])).slice(-MAX_DIAGNOSTIC_ENTRIES);
}

function isDiagnosticEntry(value: unknown): value is DiagnosticEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.operation === 'string' &&
    (typeof value.method === 'string' || value.method === null) &&
    (value.outcome === 'success' || value.outcome === 'error') &&
    typeof value.durationMs === 'number' &&
    (typeof value.errorCode === 'string' || value.errorCode === null) &&
    (typeof value.errorMessage === 'string' || value.errorMessage === null) &&
    (typeof value.traceId === 'string' || value.traceId === null)
  );
}

function diagnosticMethod(operation: OperationId, payload: unknown): string | null {
  if (operation === 'callCapability') return readString(asRecord(payload), ['method']) ?? null;
  const methods: Partial<Record<OperationId, string>> = {
    listProducts: 'alibaba.icbu.product.list',
    renderProductSchema: 'alibaba.icbu.product.schema.render',
    listPhotoGroups: 'alibaba.icbu.photobank.group.list',
    listPhotos: 'alibaba.icbu.photobank.list',
    listTradeOrders: 'alibaba.seller.order.list',
    listRfqs: 'alibaba.icbu.rfq.search'
  };
  return methods[operation] ?? null;
}

function readResultTraceId(value: unknown): string | null {
  return readString(asRecord(value), ['traceId', 'trace_id', 'request_id']) ?? null;
}

async function loadSettings(): Promise<GatewaySettings> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const present = Object.prototype.hasOwnProperty.call(stored, SETTINGS_STORAGE_KEY);
  const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY], present);
  return getUnlockedVault(state).settings;
}

function asCredentialVaultRequest(value: unknown): CredentialVaultRequest | null {
  if (!isRecord(value) || value.kind !== 'credential-vault-request' || !isRequestId(value.requestId)) {
    return null;
  }
  if (
    value.operation !== 'status' &&
    value.operation !== 'get-settings' &&
    value.operation !== 'create' &&
    value.operation !== 'migrate' &&
    value.operation !== 'unlock' &&
    value.operation !== 'lock' &&
    value.operation !== 'save' &&
    value.operation !== 'rotate' &&
    value.operation !== 'update-policy'
  ) {
    return null;
  }
  return value as unknown as CredentialVaultRequest;
}

function requiredVaultString(value: unknown, key: string): string {
  return requiredString(asRecord(value), key);
}

function optionalVaultString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function requiredGatewaySettings(value: unknown): GatewaySettings {
  const record = asRecord(value);
  return {
    appKey: requiredString(record, 'appKey'),
    appSecret: requiredString(record, 'appSecret'),
    accessToken: requiredString(record, 'accessToken'),
    endpoint: requiredString(record, 'endpoint'),
    signMethod: requiredSignMethod(record.signMethod)
  };
}

function requiredSignMethod(value: unknown): GatewaySettings['signMethod'] {
  if (value === 'hmac' || value === 'md5' || value === 'hmac-sha256') return value;
  throw new Error('签名算法无效');
}

function asRuntimeRequest(value: unknown): RuntimeRequest | null {
  if (!isRecord(value) || value.kind !== 'gateway-request' || !isRequestId(value.requestId)) {
    return null;
  }
  if (typeof value.operation !== 'string' || !OPERATIONS.has(value.operation as OperationId)) return null;
  return value as unknown as RuntimeRequest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(record[`${method.replaceAll('.', '_')}_response`]);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      return Number(value);
  }
  return undefined;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = readString(record, [key]);
  if (!value) throw new Error(`缺少必填参数 ${key}`);
  return value;
}

function requiredAlibabaLanguage(record: Record<string, unknown>, key: string): AlibabaLanguage {
  const value = requiredString(record, key);
  if (isAlibabaLanguage(value)) return value;
  throw new Error(`${key} 仅支持 zh_CN 或 en_US`);
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, [key]);
  if (value === undefined) throw new Error(`缺少必填参数 ${key}`);
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`缺少必填参数 ${key}`);
  }
  return value;
}

function readTraceId(value: unknown): string | undefined {
  const record = asRecord(value);
  return readString(record, ['trace_id', 'request_id']);
}

function assertCredentials(settings: GatewaySettings): void {
  if (!settings.appKey || !settings.appSecret || !settings.accessToken) {
    throw new GatewayException({
      code: 'MISSING_CREDENTIALS',
      message: '请先在设置中填写 App Key、App Secret 和 Access Token',
      retryable: false
    });
  }
}

function assertCallable(capability: ApiCapability | undefined): asserts capability is ApiCapability {
  if (!capability) throw new Error('API 不在已审计的免费非聚石塔目录中');
  if (capability.restricted) throw new Error(capability.restrictionReason ?? 'API 需要额外业务权限');
  if (!capability.enabled) throw new Error('API 尚未完成契约、适配器与测试，当前不可调用');
  if (!capability.realCallEnabled) {
    throw new Error('该写能力尚未通过真实账号 smoke test，扩展中的真实调用保持禁用');
  }
}
