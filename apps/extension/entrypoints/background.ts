import { browser } from 'wxt/browser';

import {
  AlibabaClient,
  ALIBABA_GATEWAY,
  ALIBABA_SYNC_GATEWAY,
  createCredentialVault,
  CredentialVaultError,
  DashboardAdapter,
  downloadProductAsset,
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
  validateProductDisplayInput,
  validateSchemaPublishInput,
  type ApiCapability,
  type AlibabaLanguage,
  type CredentialVaultRequest,
  type CredentialVaultResponse,
  type CredentialVaultStatus,
  type DiagnosticEntry,
  type DiagnosticsSnapshot,
  type ExtensionAlibabaCredentialAcquisitionRequest,
  type ExtensionAlibabaCredentialAcquisitionResponse,
  type ExtensionProductMutationJobRequest,
  type ExtensionProductMutationJobResponse,
  type GatewaySettings,
  type OperationId,
  type ProductMutationJobListInput,
  type RequestOf,
  type RuntimeRequest,
  type RuntimeResponse
} from '@one-vegetable/core';
import { ExtensionAlibabaCredentialAcquisitionController } from '../lib/alibaba-credential-acquisition';
import { ExtensionCredentialVaultSession } from '../lib/credential-vault-session';
import { resolveExtensionOperationAvailability } from '../lib/operation-policy';
import { ExtensionProductDisplayMutationLifecycle } from '../lib/product-display-mutation-lifecycle';

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
  'downloadProductAsset',
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

export default defineBackground({
  type: 'module',
  main() {
    const storageAccessReady = restrictStorageToTrustedContexts();
    // WebExtension runtime listeners support returning a promise for the response.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    browser.runtime.onMessage.addListener((value: unknown) => {
      const acquisitionMessage = asAlibabaCredentialAcquisitionRequest(value);
      if (acquisitionMessage) {
        return handleAlibabaCredentialAcquisitionRequest(acquisitionMessage, storageAccessReady);
      }
      const vaultMessage = asCredentialVaultRequest(value);
      if (vaultMessage) return handleCredentialVaultRequest(vaultMessage, storageAccessReady);
      const productMutationMessage = asProductMutationJobRequest(value);
      if (productMutationMessage) {
        return handleProductMutationJobRequest(productMutationMessage, storageAccessReady);
      }
      const message = asRuntimeRequest(value);
      if (!message) return undefined;
      return handleRequestAfterStorageReady(message, storageAccessReady);
    });
  }
});

async function restrictStorageToTrustedContexts(): Promise<void> {
  await Promise.all([
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]);
}

const vaultSession = new ExtensionCredentialVaultSession({
  get: (key) => browser.storage.session.get(key),
  set: (items) => browser.storage.session.set(items),
  remove: (key) => browser.storage.session.remove(key)
});
const alibabaCredentialAcquisition = new ExtensionAlibabaCredentialAcquisitionController();
const productMutations = new ExtensionProductDisplayMutationLifecycle({
  get: (key) => browser.storage.local.get(key),
  set: (items) => browser.storage.local.set(items)
});

async function handleProductMutationJobRequest(
  message: ExtensionProductMutationJobRequest,
  storageAccessReady: Promise<void>
): Promise<ExtensionProductMutationJobResponse> {
  const startedAt = performance.now();
  try {
    await storageAccessReady;
    const payload = asRecord(message.payload);
    let data: unknown;
    switch (message.operation) {
      case 'list':
        data = await productMutations.list(productMutationListInput(payload));
        break;
      case 'get':
        data = await productMutations.get(requiredString(payload, 'id'));
        break;
      case 'refresh':
        data = await productMutations.refresh(
          await loadProductAdapter(),
          requiredString(payload, 'id'),
          requiredNumber(payload, 'revision')
        );
        break;
      case 'recover':
        data = await productMutations.recover(
          await loadProductAdapter(),
          requiredString(payload, 'id'),
          requiredNumber(payload, 'revision')
        );
        break;
    }
    await safelyRecordDiagnostic({
      requestId: message.requestId,
      operation: `product-mutation-job.${message.operation}`,
      method:
        message.operation === 'refresh'
          ? 'alibaba.icbu.product.list'
          : message.operation === 'recover'
            ? 'alibaba.icbu.product.batch.update.display'
            : null,
      outcome: 'success',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: null,
      errorMessage: null,
      traceId: readResultTraceId(data)
    });
    return { requestId: message.requestId, ok: true, data };
  } catch (error: unknown) {
    const normalized = normalizeGatewayError(error);
    await safelyRecordDiagnostic({
      requestId: message.requestId,
      operation: `product-mutation-job.${message.operation}`,
      method: null,
      outcome: 'error',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      errorCode: normalized.code,
      errorMessage: sanitizeDiagnosticMessage(normalized.message),
      traceId: normalized.traceId ?? null
    });
    return { requestId: message.requestId, ok: false, error: normalized };
  }
}

async function handleAlibabaCredentialAcquisitionRequest(
  message: ExtensionAlibabaCredentialAcquisitionRequest,
  storageAccessReady: Promise<void>
): Promise<ExtensionAlibabaCredentialAcquisitionResponse> {
  try {
    await storageAccessReady;
    const payload = asRecord(message.payload);
    let data: unknown;
    switch (message.operation) {
      case 'start':
        data = await alibabaCredentialAcquisition.start(nullableString(payload.callbackUrl));
        break;
      case 'continue':
        data = await alibabaCredentialAcquisition.continue(
          requiredString(payload, 'jobId'),
          requiredAcquisitionContinueCommand(payload.command)
        );
        break;
      case 'status':
        data = await alibabaCredentialAcquisition.status(requiredString(payload, 'jobId'));
        break;
      case 'cancel':
        data = await alibabaCredentialAcquisition.cancel(requiredString(payload, 'jobId'));
        break;
      case 'save-to-vault': {
        const bundle = await alibabaCredentialAcquisition.completedBundle();
        data = await saveAcquiredCredentialsToVault(bundle, optionalVaultString(payload.passphrase));
        break;
      }
      case 'export-bundle':
        data = await alibabaCredentialAcquisition.exportBundle();
        break;
      case 'read-prerequisite':
        data = await alibabaCredentialAcquisition.readPrerequisite();
        break;
      case 'locate-prerequisite-field':
        data = await alibabaCredentialAcquisition.locatePrerequisiteField();
        break;
      case 'focus-prerequisite-page':
        await alibabaCredentialAcquisition.focusPrerequisitePage();
        data = null;
        break;
    }
    return { requestId: message.requestId, ok: true, data };
  } catch (error: unknown) {
    return { requestId: message.requestId, ok: false, error: normalizeVaultError(error) };
  }
}

async function saveAcquiredCredentialsToVault(
  bundle: Awaited<ReturnType<ExtensionAlibabaCredentialAcquisitionController['completedBundle']>>,
  passphrase: string | undefined
): Promise<CredentialVaultStatus> {
  const settings: GatewaySettings = {
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: ALIBABA_GATEWAY,
    signMethod: 'hmac'
  };
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const present = Object.prototype.hasOwnProperty.call(stored, SETTINGS_STORAGE_KEY);
  const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY], present);
  if (state.kind === 'empty') {
    if (!passphrase) {
      throw gatewayFailure(
        'CREDENTIAL_VAULT_PASSPHRASE_REQUIRED',
        'A local passphrase is required before saving credentials for the first time.'
      );
    }
    return (await executeCredentialVaultOperation('create', {
      passphrase,
      settings
    })) as CredentialVaultStatus;
  }
  if (state.kind !== 'vault' || !(await vaultSession.read(state.record))) throw vaultStateError(state.kind);
  return (await executeCredentialVaultOperation('save', settings)) as CredentialVaultStatus;
}

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
      await vaultSession.activate({ ...unlocked, record: state.record }, unlocked.sessionKeyMaterial);
      return credentialVaultStatus(state);
    }
    case 'lock':
      await vaultSession.lock('manual');
      return credentialVaultStatus(state);
    case 'create': {
      if (state.kind !== 'empty') {
        throw gatewayFailure('CREDENTIAL_VAULT_ALREADY_CONFIGURED', 'Credentials already exist.');
      }
      const request = asRecord(payload);
      const settings = requiredGatewaySettings(request.settings);
      const created = await createCredentialVault(settings, requiredString(request, 'passphrase'));
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: created.record });
      await vaultSession.activate({ ...created, settings }, created.sessionKeyMaterial);
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'migrate': {
      if (state.kind !== 'legacy') {
        throw gatewayFailure(
          'CREDENTIAL_VAULT_MIGRATION_NOT_AVAILABLE',
          'No legacy plaintext credentials are available to migrate.'
        );
      }
      const created = await createCredentialVault(state.settings, requiredVaultString(payload, 'passphrase'));
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: created.record });
      await vaultSession.activate({ ...created, settings: state.settings }, created.sessionKeyMaterial);
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'save': {
      const current = await getUnlockedVault(state);
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
      await vaultSession.update({ ...current, record, settings });
      return credentialVaultStatus({ kind: 'vault', record });
    }
    case 'rotate': {
      const current = await getUnlockedVault(state);
      const created = await createCredentialVault(
        current.settings,
        requiredVaultString(payload, 'newPassphrase'),
        current.policy
      );
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: created.record });
      await vaultSession.activate({ ...created, settings: current.settings }, created.sessionKeyMaterial);
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'update-policy': {
      const current = await getUnlockedVault(state);
      const policy = { idleTimeoutMinutes: requiredNumber(asRecord(payload), 'idleTimeoutMinutes') };
      const record = await resealCredentialVault(current.record, current.settings, current.key, policy);
      await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: record });
      await vaultSession.update({ ...current, record, policy });
      return credentialVaultStatus({ kind: 'vault', record });
    }
    default:
      throw gatewayFailure(
        'INVALID_CREDENTIAL_VAULT_OPERATION',
        'The credential protection operation is not supported.'
      );
  }
}

async function credentialVaultStatus(
  state: ReturnType<typeof inspectCredentialStorage>
): Promise<CredentialVaultStatus> {
  const activeSession = state.kind === 'vault' ? await vaultSession.read(state.record) : undefined;
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
    lockReason: effectiveState === 'locked' ? (vaultSession.lockReason ?? 'session-ended') : null
  };
}

async function editableSettings(
  state: ReturnType<typeof inspectCredentialStorage>
): Promise<GatewaySettings> {
  const settings =
    state.kind === 'legacy'
      ? state.settings
      : state.kind === 'vault'
        ? (await getUnlockedVault(state)).settings
        : undefined;
  return {
    appKey: settings?.appKey ?? '',
    appSecret: '',
    accessToken: '',
    endpoint: settings?.endpoint ?? ALIBABA_GATEWAY,
    signMethod: settings?.signMethod ?? 'hmac'
  };
}

async function getUnlockedVault(state: ReturnType<typeof inspectCredentialStorage>) {
  if (state.kind !== 'vault') throw vaultStateError(state.kind);
  const activeSession = await vaultSession.read(state.record, true);
  if (!activeSession) throw vaultStateError(state.kind);
  return activeSession.value;
}

function vaultStateError(kind: ReturnType<typeof inspectCredentialStorage>['kind']): GatewayException {
  const details =
    kind === 'legacy'
      ? [
          'CREDENTIAL_VAULT_MIGRATION_REQUIRED',
          'Legacy plaintext credentials must be encrypted locally first.'
        ]
      : kind === 'invalid'
        ? [
            'CREDENTIAL_VAULT_INVALID',
            'Credential storage is invalid. Clear local data and configure it again.'
          ]
        : kind === 'empty'
          ? ['CREDENTIAL_VAULT_EMPTY', 'Configure Open Platform credentials in Settings first.']
          : vaultSession.lockReason === 'idle'
            ? ['CREDENTIAL_VAULT_IDLE_TIMEOUT', 'Open Platform credentials were locked after being idle.']
            : vaultSession.lockReason === 'manual'
              ? ['CREDENTIAL_VAULT_LOCKED', 'Open Platform credentials were manually locked.']
              : ['CREDENTIAL_VAULT_SESSION_ENDED', 'The Chrome session ended or the extension was updated.'];
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
      const data = await executeOperation(message.operation, message.payload, message.requestId);
      return { requestId: message.requestId, ok: true, data } as RuntimeResponse;
    } catch (error: unknown) {
      return { requestId: message.requestId, ok: false, error: normalizeGatewayError(error) };
    }
  }
  const startedAt = performance.now();
  try {
    const data = await executeOperation(message.operation, message.payload, message.requestId);
    await safelyRecordDiagnostic({
      requestId: message.requestId,
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
      requestId: message.requestId,
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

async function executeOperation(
  operation: OperationId,
  payload: unknown,
  requestId: string
): Promise<unknown> {
  if (operation === 'getDiagnostics') return getDiagnostics();
  if (operation === 'clearDiagnostics') {
    await clearDiagnostics();
    return undefined;
  }
  if (operation === 'listCapabilities') return listCapabilities();
  if (operation === 'getCapabilityDefinition') {
    const definition = getCapabilityDefinition(requiredString(asRecord(payload), 'method'));
    if (!definition) {
      throw gatewayFailure('CAPABILITY_DEFINITION_MISSING', 'This capability has no typed definition.');
    }
    return definition;
  }

  const settings = await loadSettings();
  assertCredentials(settings);
  const availability = resolveExtensionOperationAvailability(operation);
  if (!availability.allowed) {
    throw new GatewayException({
      code: availability.reasonCode,
      message: availability.message,
      retryable: false
    });
  }
  const client = AlibabaClient.create(settings, {
    maxAttempts: 3,
    shouldRetry: (method, error) => error.retryable && findCapability(method)?.risk === 'read'
  });
  const mutationClient = AlibabaClient.create(
    { ...settings, endpoint: ALIBABA_SYNC_GATEWAY, signMethod: 'hmac-sha256' },
    {
      maxAttempts: 1,
      protocol: 'sync',
      shouldRetry: () => false
    }
  );
  const products = new ProductAdapter(client, mutationClient);
  const dashboard = new DashboardAdapter(client);
  const rfqs = new RfqAdapter(client);
  const trades = new TradeAdapter(client);
  const logistics = new LogisticsAdapter(client);
  const insights = new InsightsAdapter(client);
  const photos = new PhotoAdapter(client);
  const request = asRecord(payload);

  switch (operation) {
    case 'getDashboard': {
      return dashboard.get();
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
    case 'saveProductDraft': {
      const validation = validateSchemaPublishInput(payload);
      if (!validation.valid || !validation.data) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: validation.errors.join('; ') || 'The product creation request is invalid.',
          retryable: false
        });
      }
      return productMutations.submitCreation(products, requestId, operation, validation.data);
    }
    case 'updateProduct':
      return products.update(payload as RequestOf<'updateProduct'>);
    case 'updateProductDisplay': {
      const validation = validateProductDisplayInput(payload);
      if (!validation.valid || !validation.data) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: validation.errors.join('; ') || 'The product display request is invalid.',
          retryable: false
        });
      }
      return productMutations.submit(products, requestId, validation.data);
    }
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
      throw gatewayFailure(
        'TRADE_MUTATION_UNVERIFIED',
        'Trade Assurance order writes require per-operation real-account verification.'
      );
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
    case 'downloadProductAsset':
      return downloadProductAsset(payload as RequestOf<'downloadProductAsset'>);
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
          buyerName: item.buyerLoginId ?? '—',
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
    isRequestId(value.requestId) &&
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
  return (await getUnlockedVault(state)).settings;
}

async function loadProductAdapter(): Promise<ProductAdapter> {
  const settings = await loadSettings();
  assertCredentials(settings);
  const client = AlibabaClient.create(settings, {
    maxAttempts: 3,
    shouldRetry: (_method, error) => error.retryable
  });
  const mutationClient = AlibabaClient.create(
    { ...settings, endpoint: ALIBABA_SYNC_GATEWAY, signMethod: 'hmac-sha256' },
    { maxAttempts: 1, protocol: 'sync', shouldRetry: () => false }
  );
  return new ProductAdapter(client, mutationClient);
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

function asAlibabaCredentialAcquisitionRequest(
  value: unknown
): ExtensionAlibabaCredentialAcquisitionRequest | null {
  if (
    !isRecord(value) ||
    value.kind !== 'alibaba-credential-acquisition-request' ||
    !isRequestId(value.requestId)
  ) {
    return null;
  }
  if (
    value.operation !== 'start' &&
    value.operation !== 'continue' &&
    value.operation !== 'status' &&
    value.operation !== 'cancel' &&
    value.operation !== 'save-to-vault' &&
    value.operation !== 'export-bundle' &&
    value.operation !== 'read-prerequisite' &&
    value.operation !== 'locate-prerequisite-field' &&
    value.operation !== 'focus-prerequisite-page'
  ) {
    return null;
  }
  return value as unknown as ExtensionAlibabaCredentialAcquisitionRequest;
}

function asProductMutationJobRequest(value: unknown): ExtensionProductMutationJobRequest | null {
  if (!isRecord(value) || value.kind !== 'product-mutation-job-request' || !isRequestId(value.requestId)) {
    return null;
  }
  if (
    value.operation !== 'list' &&
    value.operation !== 'get' &&
    value.operation !== 'refresh' &&
    value.operation !== 'recover'
  ) {
    return null;
  }
  return value as unknown as ExtensionProductMutationJobRequest;
}

function productMutationListInput(payload: Record<string, unknown>): ProductMutationJobListInput {
  const page = readNumber(payload, ['page']);
  const pageSize = readNumber(payload, ['pageSize']);
  const productId = readString(payload, ['productId']);
  const status = readString(payload, ['status']);
  if (
    status !== undefined &&
    status !== 'submitted' &&
    status !== 'auditing' &&
    status !== 'verifying' &&
    status !== 'verified' &&
    status !== 'recovery-required' &&
    status !== 'recovering' &&
    status !== 'recovered' &&
    status !== 'failed'
  ) {
    throw gatewayFailure('PRODUCT_MUTATION_STATUS_INVALID', 'The product mutation job status is invalid.');
  }
  return {
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(productId === undefined ? {} : { productId }),
    ...(status === undefined ? {} : { status })
  };
}

function requiredAcquisitionContinueCommand(
  value: unknown
): Parameters<ExtensionAlibabaCredentialAcquisitionController['continue']>[1] {
  const record = asRecord(value);
  if (record.type === 'select-application') {
    return { type: 'select-application', applicationId: requiredString(record, 'applicationId') };
  }
  if (record.type === 'confirm-callback-change' && typeof record.confirmed === 'boolean') {
    return { type: 'confirm-callback-change', confirmed: record.confirmed };
  }
  throw gatewayFailure(
    'ACQUISITION_COMMAND_INVALID',
    'The Alibaba credential acquisition command is invalid.'
  );
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw gatewayFailure('CALLBACK_INVALID', 'The Callback URL is invalid.');
  return value;
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
  throw gatewayFailure('ALIBABA_SIGN_METHOD_INVALID', 'The Alibaba signing method is invalid.');
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
  if (!value) throw gatewayFailure('INVALID_OPERATION_PAYLOAD', `Missing required field: ${key}.`);
  return value;
}

function requiredAlibabaLanguage(record: Record<string, unknown>, key: string): AlibabaLanguage {
  const value = requiredString(record, key);
  if (isAlibabaLanguage(value)) return value;
  throw gatewayFailure('INVALID_OPERATION_PAYLOAD', `${key} must be zh_CN or en_US.`);
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = readNumber(record, [key]);
  if (value === undefined)
    throw gatewayFailure('INVALID_OPERATION_PAYLOAD', `Missing required field: ${key}.`);
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw gatewayFailure('INVALID_OPERATION_PAYLOAD', `Missing or invalid required field: ${key}.`);
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
      message: 'Configure the App Key, App Secret, and Access Token in Settings first.',
      retryable: false
    });
  }
}

function assertCallable(capability: ApiCapability | undefined): asserts capability is ApiCapability {
  if (!capability) {
    throw gatewayFailure('CAPABILITY_NOT_AUDITED', 'The API is not in the audited callable catalog.');
  }
  if (capability.restricted) {
    throw gatewayFailure(
      'CAPABILITY_RESTRICTED',
      capability.restrictionReason ?? 'The API requires additional business permissions.'
    );
  }
  if (!capability.enabled) {
    throw gatewayFailure('CAPABILITY_NOT_INTEGRATED', 'The API contract, adapter, and tests are incomplete.');
  }
  if (!capability.realCallEnabled) {
    throw gatewayFailure('REAL_MUTATION_DISABLED', 'This real write operation is disabled.');
  }
}

function gatewayFailure(code: string, message: string): GatewayException {
  return new GatewayException({ code, message, retryable: false });
}
