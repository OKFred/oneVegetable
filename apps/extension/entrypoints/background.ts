import { browser } from 'wxt/browser';
import {
  parseAlibabaCredentialImport,
  parseAlibabaOpenApiCredentialBundle
} from '@one-vegetable/core/credential-bundle';
import {
  handleAuthorization,
  handlePublicAuthorization,
  configureAuthorizationProtection,
  rotateAuthorizationProtection,
  lockAllAlibabaAuthorizations,
  resetIopAuthorization
} from '../lib/iop-authorization-runtime';
import { defineBackground } from 'wxt/utils/define-background';
import { VideoAdapter, VIDEO_OPERATIONS, VIDEO_METHODS } from '@one-vegetable/core/video';
import { VideoAssociationAdapter } from '@one-vegetable/core/video-association';
import { IOP_BUSINESS_ENDPOINT } from '@one-vegetable/core/alibaba-iop';

import {
  requireProductOperationContext,
  assertProductOperationContext,
  createProductOperationContext,
  type ProductOperationOptions
} from '@one-vegetable/core/product-operation-context';
import {
  galleryGatewayId,
  opaqueGalleryId,
  requireGalleryContext,
  assertGalleryContextId
} from '@one-vegetable/core/gallery-transfer-context';
import type { GalleryTransferContext } from '@one-vegetable/core/gallery-transfer-task';
import {
  AlibabaClient,
  ALIBABA_GATEWAY,
  ALIBABA_SYNC_GATEWAY,
  createCredentialVault,
  credentialTestFailure,
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
  gatewayCredentialExpiryMetadata,
  alibabaAuthorizationMetadata,
  alibabaAccessTokenCapturedTime,
  PhotoAdapter,
  ProductAdapter,
  ProductShowcaseAdapter,
  RfqAdapter,
  TradeAdapter,
  validateProductDisplayInput,
  validateProductGroupCreateInput,
  validateProductSchemaUpdateInput,
  validateSchemaPublishInput,
  type AlibabaLanguage,
  type CredentialVaultRequest,
  type CredentialVaultResponse,
  type CredentialVaultStatus,
  type CredentialVaultSessionValue,
  type DiagnosticEntry,
  type DiagnosticsSnapshot,
  type ExtensionAlibabaCredentialAcquisitionRequest,
  type ExtensionAlibabaCredentialAcquisitionResponse,
  type ExtensionProductMutationJobRequest,
  type ExtensionProductMutationJobResponse,
  type ExtensionProductUpdateReadbackResult,
  type GatewaySettings,
  type GatewayCredentialTestResult,
  type OperationId,
  type ProductMutationJobListInput,
  type ProductMutationFingerprintSet,
  type RequestOf,
  type RuntimeRequest,
  type RuntimeResponse
} from '@one-vegetable/core';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core/capability-validation-worker';
import { ExtensionAlibabaCredentialAcquisitionController } from '../lib/alibaba-credential-acquisition';
import { ExtensionCredentialVaultSession } from '../lib/credential-vault-session';
import { AuthorizationProtection, DEVICE_PROTECTION_KEY } from '../lib/authorization-protection';
import { executeExtensionCapabilityCall } from '../lib/capability-call';
import { resolveExtensionOperationAvailability } from '../lib/operation-policy';
import { applyExtensionCapabilityProtocol, type AuthorizationStatus } from '../lib/operation-availability';
import {
  ExtensionProductDisplayMutationLifecycle,
  type ExtensionProductDisplayGateway,
  type ExtensionProductCreationGateway
} from '../lib/product-display-mutation-lifecycle';
import { isTrustedExtensionPageSender } from '../lib/trusted-runtime-sender';
import { ExtensionS3Service } from '../lib/s3-service';
import { s3LocalStore } from '../lib/s3-local-store';
import { ExtensionVideoUploadRepository } from '../lib/video-upload-repository';
import { handleVideoUpload } from '../lib/video-upload-service';
import {
  authorizationAvailability,
  authorizationProfiles,
  clearAuthorizationProfile,
  editableAuthorization,
  initializeAuthorizationIdentities,
  replaceAuthorization,
  resolveAuthorization,
  runtimeAuthorization,
  saveAuthorizationPatch,
  setDefaultAuthorization,
  summarizeAuthorizations
} from '../lib/alibaba-authorizations';
import {
  applyAuthorizationRefreshState,
  AUTHORIZATION_REFRESH_INTENTS_KEY,
  refreshAuthorizationProfile
} from '../lib/authorization-refresh';

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
  'getProductShowcase',
  'getProductInventory',
  'listVideos',
  'listVideoRelatedProducts',
  'resolveVideoRelatedProduct',
  'associateProductVideo',
  'verifyProductVideoAssociation',
  'addShowcaseProducts',
  'removeShowcaseProducts',
  'sortShowcaseProduct',
  'replaceShowcaseProduct',
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
    browser.runtime.onMessageExternal.addListener((value: unknown, sender, respond) => {
      void storageAccessReady
        .then(() => handlePublicAuthorization(value, sender))
        .then(respond, () => {
          respond({ ok: false });
        });
      return true;
    });
    const s3 = new ExtensionS3Service(
      s3LocalStore,
      (origins) => browser.permissions.contains({ origins }),
      undefined,
      () =>
        serializeVaultOperation(async () => {
          // Wait for in-flight create/unlock/rotation, then clear inside the same
          // boundary. A late passphrase derivation cannot restore deleted credentials.
          await vaultSession.lock('manual');
          await resetIopAuthorization();
          await new ExtensionVideoUploadRepository().clearAll();
          await browser.storage.local.clear();
          await browser.storage.session.clear();
        })
    );
    // WebExtension runtime listeners support returning a promise for the response.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    browser.runtime.onMessage.addListener((value: unknown, sender) => {
      if (
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'iop-authorization-request'
      ) {
        return storageAccessReady.then(() => handleAuthorization(value, sender));
      }
      const trustedOptionsPage = isTrustedOptionsPageSender(sender);
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'video-upload-request') {
        return storageAccessReady.then(() => handleVideoUpload(value, trustedOptionsPage, s3, loadSettings));
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        (value.kind === 'gallery-transfer-context' || value.kind === 'product-operation-context')
      ) {
        return (async () => {
          const requestId =
            'requestId' in value && isRequestId(value.requestId) ? value.requestId : crypto.randomUUID();
          try {
            if (!('requestId' in value) || !isRequestId(value.requestId))
              throw gatewayFailure('INVALID_REQUEST_ID', 'INVALID_REQUEST_ID');
            if (!trustedOptionsPage)
              throw gatewayFailure('GALLERY_CONTEXT_UNTRUSTED', 'GALLERY_CONTEXT_UNTRUSTED');
            await storageAccessReady;
            return {
              requestId,
              ok: true,
              data: {
                identity: await opaqueGalleryId('extension:local-admin'),
                gateway: await galleryGatewayId(
                  await resolveAuthorization(
                    await loadAuthorizationSettings(),
                    value.kind === 'gallery-transfer-context' ? 'uploadPhoto' : 'updateProduct'
                  )
                ),
                ...(value.kind === 'gallery-transfer-context' ? { storage: await s3.contextId() } : {})
              }
            };
          } catch (error) {
            return { requestId, ok: false, error: normalizeGatewayError(error) };
          }
        })();
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 's3-storage-request'
      ) {
        return storageAccessReady.then(async () => {
          try {
            if ('galleryContext' in value && value.galleryContext !== undefined) {
              if (!trustedOptionsPage)
                throw gatewayFailure('GALLERY_CONTEXT_UNTRUSTED', 'GALLERY_CONTEXT_UNTRUSTED');
              const expected = requireGalleryContext(value.galleryContext);
              assertGalleryContextId(expected.identity, await opaqueGalleryId('extension:local-admin'));
              assertGalleryContextId(
                expected.gateway,
                await galleryGatewayId(
                  await resolveAuthorization(
                    await loadAuthorizationSettings(),
                    undefined,
                    undefined,
                    expected.gateway,
                    'GALLERY_CONTEXT_CHANGED'
                  )
                )
              );
            }
            return await s3.handle(value, trustedOptionsPage);
          } catch (error) {
            return {
              requestId: 'requestId' in value ? value.requestId : '',
              ok: false,
              error: normalizeGatewayError(error)
            };
          }
        });
      }
      const acquisitionMessage = asAlibabaCredentialAcquisitionRequest(value);
      if (acquisitionMessage) {
        // A known guide can inspect/focus prerequisites or open the local IOP UI,
        // never acquire, import, change or export credentials.
        const trustedGuideRead =
          alibabaCredentialAcquisition.isGuideSender(sender) &&
          (acquisitionMessage.operation === 'read-prerequisite' ||
            acquisitionMessage.operation === 'locate-prerequisite-field' ||
            acquisitionMessage.operation === 'open-iop-tool');
        return handleAlibabaCredentialAcquisitionRequest(
          acquisitionMessage,
          storageAccessReady,
          trustedOptionsPage || trustedGuideRead
        );
      }
      if (isRecord(value) && value.kind === 'credential-vault-request')
        return handleCredentialVaultRequest(value, storageAccessReady, trustedOptionsPage);
      const productMutationMessage = asProductMutationJobRequest(value);
      if (productMutationMessage) {
        return handleProductMutationJobRequest(
          productMutationMessage,
          storageAccessReady,
          trustedOptionsPage
        );
      }
      const message = asRuntimeRequest(value);
      if (!message) return undefined;
      return handleRequestAfterStorageReady(message, storageAccessReady, trustedOptionsPage);
    });
  }
});

async function restrictStorageToTrustedContexts(): Promise<void> {
  await Promise.all([
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]);
}

const vaultSession = new ExtensionCredentialVaultSession(browser.storage.local, Date.now, {
  get: (key) => browser.storage.session.get(key),
  set: (items) => browser.storage.session.set(items),
  remove: (key) => browser.storage.session.remove(key)
});
const authorizationProtection = new AuthorizationProtection(browser.storage.local, vaultSession);
configureAuthorizationProtection({
  prepare: (passphrase) => serializeVaultOperation(() => authorizationProtection.prepare(passphrase)),
  adopt: (vault) => serializeVaultOperation(() => authorizationProtection.adopt(vault)),
  status: () => serializeVaultOperation(() => executeCredentialVaultOperation('status', undefined)),
  prepareStatus: (passphrase) =>
    serializeVaultOperation(() => executeCredentialVaultOperation('prepare-authorization', { passphrase }))
});
const alibabaCredentialAcquisition = new ExtensionAlibabaCredentialAcquisitionController();
const productMutations = new ExtensionProductDisplayMutationLifecycle({
  get: (key) => browser.storage.local.get(key),
  set: (items) => browser.storage.local.set(items)
});

async function handleProductMutationJobRequest(
  message: ExtensionProductMutationJobRequest,
  storageAccessReady: Promise<void>,
  trustedOptionsPage: boolean
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
      case 'refresh': {
        const job = await productMutations.get(requiredString(payload, 'id'));
        data = await productMutations.refresh(
          await loadProductAdapter(
            job.productContext ?? undefined,
            job.operation === 'updateProductDisplay' ? (job.protocol ?? 'top') : undefined
          ),
          requiredString(payload, 'id'),
          requiredNumber(payload, 'revision')
        );
        break;
      }
      case 'complete-update-readback':
        assertTrustedOptionsPage(trustedOptionsPage);
        {
          const job = await productMutations.get(requiredString(payload, 'id'));
          if (job.productContext)
            assertProductOperationContext(
              job.productContext,
              await createProductOperationContext(
                'extension:local-admin',
                await resolveAuthorization(
                  await loadAuthorizationSettings(),
                  undefined,
                  undefined,
                  job.productContext.gateway
                )
              )
            );
        }
        data = await productMutations.completeUpdateReadback(
          requiredString(payload, 'id'),
          requiredNumber(payload, 'revision'),
          requiredProductUpdateReadbackResult(payload.result)
        );
        break;
      case 'recover': {
        const job = await productMutations.get(requiredString(payload, 'id'));
        data = await productMutations.recover(
          await loadProductAdapter(job.productContext ?? undefined, job.protocol ?? 'top'),
          requiredString(payload, 'id'),
          requiredNumber(payload, 'revision')
        );
        break;
      }
    }
    await safelyRecordDiagnostic({
      requestId: message.requestId,
      operation: `product-mutation-job.${message.operation}`,
      method: productMutationDiagnosticMethod(message.operation, data),
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
  storageAccessReady: Promise<void>,
  trustedOptionsPage: boolean
): Promise<ExtensionAlibabaCredentialAcquisitionResponse> {
  try {
    assertTrustedOptionsPage(trustedOptionsPage);
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
        data = await serializeVaultOperation(() =>
          saveAcquiredCredentialsToVault(bundle, optionalVaultString(payload.passphrase))
        );
        break;
      }
      case 'import-bundle': {
        const input = requireOnlyKeys(message.payload, ['bundle']);
        const bundle = parseAlibabaOpenApiCredentialBundle(input.bundle);
        data = await serializeVaultOperation(() => saveAcquiredCredentialsToVault(bundle, undefined));
        break;
      }
      case 'import-bundles': {
        const input = requireOnlyKeys(message.payload, ['bundles']);
        const bundles = parseAlibabaCredentialImport(input.bundles);
        data = await serializeVaultOperation(() => saveAcquiredCredentialBundlesToVault(bundles, undefined));
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
      case 'open-iop-tool': {
        if (payload.protocol !== undefined && payload.protocol !== 'top' && payload.protocol !== 'iop')
          throw new Error('Invalid authorization protocol');
        const path =
          payload.protocol === 'top'
            ? '/authorization.html?protocol=top&discover=1'
            : '/authorization.html?discover=1';
        await browser.tabs.create({ url: browser.runtime.getURL(path) });
        data = null;
        break;
      }
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
  return saveAcquiredCredentialBundlesToVault([bundle], passphrase);
}

function acquiredCredentialSettings(
  bundle: Awaited<ReturnType<ExtensionAlibabaCredentialAcquisitionController['completedBundle']>>
): GatewaySettings {
  return initializeAuthorizationIdentities({
    protocol: bundle.protocol ?? 'top',
    appKey: bundle.application.appKey,
    ...alibabaAuthorizationMetadata(bundle),
    accessTokenCapturedTimeUtc: alibabaAccessTokenCapturedTime(bundle),
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    refreshToken: bundle.oauth.refreshToken,
    refreshTokenExpiresTimeUtc:
      bundle.oauth.refreshExpiresAtUtc === null ? null : Date.parse(bundle.oauth.refreshExpiresAtUtc),
    accessTokenExpiresTimeUtc:
      bundle.oauth.expiresAtUtc === null ? null : Date.parse(bundle.oauth.expiresAtUtc),
    endpoint: bundle.protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY,
    signMethod: bundle.protocol === 'iop' ? 'hmac-sha256' : 'hmac'
  });
}

async function saveAcquiredCredentialBundlesToVault(
  input: unknown,
  passphrase: string | undefined
): Promise<CredentialVaultStatus> {
  const patches = parseAlibabaCredentialImport(input).map(acquiredCredentialSettings);
  // Prefer TOP on a fresh dual import, regardless of array order. Preserve an existing preference.
  patches.sort((left, right) => Number(left.protocol === 'iop') - Number(right.protocol === 'iop'));
  const first = patches[0];
  if (!first) throw new Error('AUTH_IMPORT_INVALID_COUNT');
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const present = Object.prototype.hasOwnProperty.call(stored, SETTINGS_STORAGE_KEY);
  const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY], present);
  if (state.kind === 'empty') {
    const settings = patches.slice(1).reduce(saveAuthorizationPatch, first);
    const created = await authorizationProtection.create(settings, passphrase ?? '');
    return credentialVaultStatus(
      { kind: 'vault', record: created.record },
      patches.length === 1 ? first.protocol : settings.protocol
    );
  }
  const current = await getUnlockedVault(state);
  const settings = patches.reduce(saveAuthorizationPatch, current.settings);
  const record = await persistUnlockedSettings(current, settings);
  return credentialVaultStatus(
    { kind: 'vault', record },
    patches.length === 1 ? first.protocol : settings.protocol
  );
}

async function handleCredentialVaultRequest(
  value: Record<string, unknown>,
  storageAccessReady: Promise<void>,
  trustedOptionsPage: boolean
): Promise<CredentialVaultResponse> {
  const requestId = isRequestId(value.requestId) ? value.requestId : '';
  try {
    assertTrustedOptionsPage(trustedOptionsPage);
    const message = asCredentialVaultRequest(value);
    if (!message)
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
    validateCredentialVaultPayload(message.operation, message.payload);
    await storageAccessReady;
    const data = await serializeVaultOperation(() =>
      executeCredentialVaultOperation(message.operation, message.payload, message.requestId)
    );
    return { requestId: message.requestId, ok: true, data };
  } catch (error: unknown) {
    return { requestId, ok: false, error: normalizeVaultError(error) };
  }
}

let vaultOperationQueue: Promise<unknown> = Promise.resolve();
function serializeVaultOperation<T>(action: () => Promise<T>): Promise<T> {
  const pending = vaultOperationQueue.then(action);
  vaultOperationQueue = pending.catch(() => undefined);
  return pending;
}

async function executeCredentialVaultOperation(
  operation: string,
  payload: unknown,
  requestId: string = crypto.randomUUID()
): Promise<unknown> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const present = Object.prototype.hasOwnProperty.call(stored, SETTINGS_STORAGE_KEY);
  const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY], present);

  switch (operation) {
    case 'prepare-authorization': {
      await authorizationProtection.prepare(optionalVaultString(asRecord(payload).passphrase) ?? '');
      const current = inspectCredentialStorage(
        (await browser.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY]
      );
      return credentialVaultStatus(current);
    }
    case 'status':
      return credentialVaultStatus(state);
    case 'get-settings':
      return editableSettings(state);
    case 'authorizations': {
      if (state.kind === 'empty') return summarizeAuthorizations();
      if (state.kind === 'legacy') return readAuthorizationsSummary(state.settings);
      return readAuthorizationsSummary((await getUnlockedVault(state)).settings);
    }
    case 'get-authorization': {
      const protocol = requiredAuthorizationProtocol(asRecord(payload).protocol);
      const profile =
        state.kind === 'empty'
          ? undefined
          : authorizationProfiles(
              state.kind === 'legacy' ? state.settings : (await getUnlockedVault(state)).settings
            )[protocol];
      return editableAuthorization(
        profile ?? {
          protocol,
          appKey: '',
          appSecret: '',
          accessToken: '',
          endpoint: protocol === 'iop' ? IOP_BUSINESS_ENDPOINT : ALIBABA_GATEWAY,
          signMethod: protocol === 'iop' ? 'hmac-sha256' : 'hmac'
        }
      );
    }
    case 'confirm-authorizations': {
      const current = await getUnlockedVault(state);
      const request = asRecord(payload);
      const summary = summarizeAuthorizations(current.settings);
      if (
        !summary.top ||
        !summary.iop ||
        request.topConfigurationId !== summary.top.configurationId ||
        request.iopConfigurationId !== summary.iop.configurationId
      )
        throw gatewayFailure('ALIBABA_AUTHORIZATION_BINDING_STALE', 'ALIBABA_AUTHORIZATION_BINDING_STALE');
      const settings: GatewaySettings = {
        ...current.settings,
        authorizationBinding: {
          topConfigurationId: requiredString(request, 'topConfigurationId'),
          iopConfigurationId: requiredString(request, 'iopConfigurationId'),
          confirmedAtUtc: Date.now()
        }
      };
      await persistUnlockedSettings(current, settings);
      return readAuthorizationsSummary(settings);
    }
    case 'set-default-authorization': {
      const current = await getUnlockedVault(state);
      const input = asRecord(payload);
      const settings = setDefaultAuthorization(
        current.settings,
        requiredAuthorizationProtocol(input.protocol),
        requiredString(input, 'configurationId')
      );
      await persistUnlockedSettings(current, settings);
      return readAuthorizationsSummary(settings);
    }
    case 'clear-authorization': {
      const current = await getUnlockedVault(state);
      await persistUnlockedSettings(
        current,
        clearAuthorizationProfile(current.settings, requiredAuthorizationProtocol(asRecord(payload).protocol))
      );
      return null;
    }
    case 'test-authorization': {
      const started = Date.now();
      let configurationId: string | null = null;
      try {
        const current = await getUnlockedVault(state);
        const protocol = requiredAuthorizationProtocol(asRecord(payload).protocol);
        const profile = authorizationProfiles(current.settings)[protocol];
        if (!profile) throw gatewayFailure('CREDENTIAL_VAULT_EMPTY', 'CREDENTIAL_VAULT_EMPTY');
        configurationId = profile.configurationId ?? null;
        assertCredentials(profile);
        if (!(await browser.permissions.contains({ origins: [new URL(profile.endpoint).origin + '/*'] })))
          throw gatewayFailure('HOST_PERMISSION_REQUIRED', 'HOST_PERMISSION_REQUIRED');
        const client = AlibabaClient.create(profile, { maxAttempts: 1, requestId });
        const page = await new ProductAdapter({
          async call(method, parameters) {
            const result = await client.call(method, parameters);
            const raw = asRecord(result.data);
            const root = asRecord(raw[method.replaceAll('.', '_') + '_response'] ?? result.data);
            const products = Array.isArray(root.products) ? root.products : asRecord(root.products).product;
            const checked = { ...root, ...(Array.isArray(products) ? { products } : {}) };
            const issues = await validateCapabilityResponse(method, checked);
            if (
              (!Array.isArray(products) && root.total_item !== 0) ||
              // The connectivity probe accepts additive provider metadata.
              // Known field types and structure still have to match; this does
              // not relax the capability debugger's response contract.
              issues.some((issue) => issue.keyword !== 'additionalProperties')
            )
              throw gatewayFailure('RESPONSE_CONTRACT_INVALID', 'RESPONSE_CONTRACT_INVALID');
            return { ...result, data: { [method.replaceAll('.', '_') + '_response']: checked } };
          }
        }).list({ page: 1, pageSize: 1 });
        return {
          status: page.items.length ? 'passed' : 'no-data',
          requestId,
          checkedAtUtc: Date.now(),
          durationMilliseconds: Math.max(0, Date.now() - started),
          configurationId,
          errorCode: null
        } satisfies GatewayCredentialTestResult;
      } catch (error: unknown) {
        const normalized = normalizeGatewayError(error);
        return {
          ...credentialTestFailure(normalized.subCode ?? normalized.code),
          requestId,
          checkedAtUtc: Date.now(),
          durationMilliseconds: Math.max(0, Date.now() - started),
          configurationId
        } satisfies GatewayCredentialTestResult;
      }
    }
    case 'refresh-authorization': {
      const current = await getUnlockedVault(state);
      const protocol = requiredAuthorizationProtocol(asRecord(payload).protocol);
      const profile = authorizationProfiles(current.settings)[protocol];
      if (!profile) throw gatewayFailure('CREDENTIAL_VAULT_EMPTY', 'CREDENTIAL_VAULT_EMPTY');
      let settings = current.settings;
      await refreshAuthorizationProfile(
        profile,
        browser.storage.local,
        (origins) => browser.permissions.contains({ origins }),
        async (next) => {
          settings = {
            ...replaceAuthorization(current.settings, protocol, next),
            ...(current.settings.authorizationBinding
              ? { authorizationBinding: current.settings.authorizationBinding }
              : {})
          };
          await persistUnlockedSettings(current, settings);
        }
      );
      return readAuthorizationsSummary(settings);
    }
    case 'unlock': {
      if (state.kind !== 'vault') throw vaultStateError(state.kind);
      await authorizationProtection.prepare(optionalVaultString(asRecord(payload).passphrase) ?? '');
      return credentialVaultStatus(state);
    }
    case 'lock':
      await vaultSession.lock('manual');
      await lockAllAlibabaAuthorizations();
      return credentialVaultStatus(state);
    case 'create': {
      if (state.kind !== 'empty') {
        throw gatewayFailure('CREDENTIAL_VAULT_ALREADY_CONFIGURED', 'Credentials already exist.');
      }
      const request = asRecord(payload);
      const settings = initializeAuthorizationIdentities(requiredGatewaySettings(request.settings, true));
      const created = await authorizationProtection.create(
        settings,
        optionalVaultString(request.passphrase) ?? ''
      );
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'migrate': {
      if (state.kind !== 'legacy') {
        throw gatewayFailure(
          'CREDENTIAL_VAULT_MIGRATION_NOT_AVAILABLE',
          'No plaintext credentials to migrate.'
        );
      }
      const settings = initializeAuthorizationIdentities(state.settings);
      const created = await createCredentialVault(settings, requiredVaultString(payload, 'passphrase'));
      await vaultSession.activate({ ...created, settings }, created.sessionKeyMaterial, undefined, {
        [SETTINGS_STORAGE_KEY]: created.record,
        [DEVICE_PROTECTION_KEY]: null
      });
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'save': {
      const current = await getUnlockedVault(state);
      const patch = asRecord(payload);
      const input: GatewaySettings = {
        ...gatewayProtocolMetadata(patch, current.settings.protocol),
        appKey: optionalVaultString(patch.appKey) ?? '',
        appSecret: optionalVaultString(patch.appSecret) ?? '',
        accessToken: optionalVaultString(patch.accessToken) ?? '',
        ...gatewayCredentialExpiryMetadata(patch),
        ...privateRefreshMetadata(patch),
        endpoint: requiredString(patch, 'endpoint'),
        signMethod: requiredSignMethod(patch.signMethod)
      };
      const settings = saveAuthorizationPatch(current.settings, input);
      const record = await persistUnlockedSettings(current, settings);
      return credentialVaultStatus({ kind: 'vault', record });
    }
    case 'rotate': {
      const current = await getUnlockedVault(state);
      const previous = await vaultSession.protection(current.record);
      const created = await createCredentialVault(
        current.settings,
        requiredVaultString(payload, 'newPassphrase'),
        current.policy
      );
      await rotateAuthorizationProtection(
        previous.sessionKeyMaterial,
        {
          key: created.key,
          sessionKeyMaterial: created.sessionKeyMaterial,
          salt: created.record.kdf.salt
        },
        async (toolUpdates) => {
          await vaultSession.activate(
            { ...created, settings: current.settings },
            created.sessionKeyMaterial,
            undefined,
            {
              ...toolUpdates,
              [SETTINGS_STORAGE_KEY]: created.record,
              [DEVICE_PROTECTION_KEY]: null
            }
          );
        }
      );
      return credentialVaultStatus({ kind: 'vault', record: created.record });
    }
    case 'update-policy': {
      const current = await getUnlockedVault(state);
      // Kept for older clients; automatic idle locking is no longer supported.
      const policy = { idleTimeoutMinutes: 0 };
      const record = await resealCredentialVault(current.record, current.settings, current.key, policy);
      await vaultSession.update({ ...current, record, policy }, undefined, {
        [SETTINGS_STORAGE_KEY]: record
      });
      return credentialVaultStatus({ kind: 'vault', record });
    }
    default:
      throw gatewayFailure(
        'INVALID_CREDENTIAL_VAULT_OPERATION',
        'The credential protection operation is not supported.'
      );
  }
}

async function readAuthorizationsSummary(settings: GatewaySettings) {
  const stored = await browser.storage.local.get(AUTHORIZATION_REFRESH_INTENTS_KEY);
  return applyAuthorizationRefreshState(
    summarizeAuthorizations(settings),
    stored[AUTHORIZATION_REFRESH_INTENTS_KEY]
  );
}

async function credentialVaultStatus(
  state: ReturnType<typeof inspectCredentialStorage>,
  selectedProtocol?: 'top' | 'iop'
): Promise<CredentialVaultStatus & AuthorizationStatus> {
  const activeSession = state.kind === 'vault' ? await vaultSession.read(state.record) : undefined;
  const activeVault = activeSession?.value;
  const allSettings = state.kind === 'legacy' ? state.settings : activeVault?.settings;
  const settings =
    allSettings && selectedProtocol ? authorizationProfiles(allSettings)[selectedProtocol] : allSettings;
  const effectiveState = state.kind === 'vault' ? (activeSession ? 'unlocked' : 'locked') : state.kind;
  return {
    state: effectiveState,
    deviceProtected: state.kind === 'vault' && Boolean(await authorizationProtection.deviceKey(state.record)),
    ...(settings?.protocol === undefined ? {} : { protocol: settings.protocol }),
    ...(allSettings ? { pool: authorizationAvailability(allSettings) } : {}),
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
  return editableAuthorization(
    settings ?? {
      appKey: '',
      appSecret: '',
      accessToken: '',
      endpoint: ALIBABA_GATEWAY,
      signMethod: 'hmac'
    }
  );
}

let identityInitialization: { ciphertext: string; pending: Promise<CredentialVaultSessionValue> } | undefined;
async function getUnlockedVault(
  state: ReturnType<typeof inspectCredentialStorage>
): Promise<CredentialVaultSessionValue> {
  if (state.kind !== 'vault') throw vaultStateError(state.kind);
  const activeSession = await vaultSession.read(state.record, true);
  if (!activeSession) throw vaultStateError(state.kind);
  const current = activeSession.value;
  const settings = initializeAuthorizationIdentities(current.settings);
  if (settings !== current.settings) {
    if (identityInitialization?.ciphertext === current.record.cipher.ciphertext)
      return identityInitialization.pending;
    const pending = persistUnlockedSettings(current, settings).then((record) => ({
      ...current,
      record,
      settings
    }));
    const initialization = { ciphertext: current.record.cipher.ciphertext, pending };
    identityInitialization = initialization;
    try {
      return await pending;
    } finally {
      if (identityInitialization === initialization) identityInitialization = undefined;
    }
  }
  return current;
}

async function persistUnlockedSettings(current: CredentialVaultSessionValue, settings: GatewaySettings) {
  const record = await resealCredentialVault(current.record, settings, current.key, current.policy);
  await vaultSession.update({ ...current, record, settings }, undefined, { [SETTINGS_STORAGE_KEY]: record });
  return record;
}

function vaultStateError(kind: ReturnType<typeof inspectCredentialStorage>['kind']): GatewayException {
  const details =
    kind === 'legacy'
      ? ['CREDENTIAL_VAULT_MIGRATION_REQUIRED', 'Encrypt credentials in Settings.']
      : kind === 'invalid'
        ? ['CREDENTIAL_VAULT_INVALID', 'Invalid credentials. Reconfigure in Settings.']
        : kind === 'empty'
          ? ['CREDENTIAL_VAULT_EMPTY', 'Configure credentials in Settings.']
          : vaultSession.lockReason === 'idle'
            ? ['CREDENTIAL_VAULT_IDLE_TIMEOUT', 'Idle lock. Unlock in Settings.']
            : vaultSession.lockReason === 'manual'
              ? ['CREDENTIAL_VAULT_LOCKED', 'Locked. Unlock in Settings.']
              : ['CREDENTIAL_VAULT_SESSION_ENDED', 'Session ended. Unlock in Settings.'];
  const [code, message] = details as [string, string];
  return new GatewayException({ code, message, retryable: false });
}

function normalizeVaultError(error: unknown): ReturnType<typeof normalizeGatewayError> {
  if (error instanceof CredentialVaultError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  return normalizeGatewayError(error);
}

async function handleRequest(message: RuntimeRequest, trustedOptionsPage: boolean): Promise<RuntimeResponse> {
  if (message.operation === 'getDiagnostics' || message.operation === 'clearDiagnostics') {
    try {
      const data = await executeOperation(
        message.operation,
        message.payload,
        message.requestId,
        message.productMutationFingerprint,
        trustedOptionsPage
      );
      return { requestId: message.requestId, ok: true, data } as RuntimeResponse;
    } catch (error: unknown) {
      return { requestId: message.requestId, ok: false, error: normalizeGatewayError(error) };
    }
  }
  const startedAt = performance.now();
  try {
    const data = await executeOperation(
      message.operation,
      message.payload,
      message.requestId,
      message.productMutationFingerprint,
      trustedOptionsPage,
      message.galleryContext,
      message
    );
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
  storageAccessReady: Promise<void>,
  trustedOptionsPage: boolean
): Promise<RuntimeResponse> {
  try {
    await storageAccessReady;
  } catch (error: unknown) {
    return { requestId: message.requestId, ok: false, error: normalizeGatewayError(error) };
  }
  return handleRequest(message, trustedOptionsPage);
}

async function executeOperation(
  operation: OperationId,
  payload: unknown,
  requestId: string,
  productMutationFingerprint: ProductMutationFingerprintSet | undefined,
  trustedOptionsPage: boolean,
  galleryContext?: GalleryTransferContext,
  productOptions?: ProductOperationOptions
): Promise<unknown> {
  if (operation === 'getDiagnostics') return getDiagnostics();
  if (
    [
      'addShowcaseProducts',
      'removeShowcaseProducts',
      'sortShowcaseProduct',
      'replaceShowcaseProduct'
    ].includes(operation) &&
    !trustedOptionsPage
  )
    throw gatewayFailure('SHOWCASE_UNTRUSTED', 'Showcase writes require the trusted workbench.');
  if (operation === 'clearDiagnostics') {
    await clearDiagnostics();
    return undefined;
  }
  if (operation === 'listCapabilities') {
    const status = (await executeCredentialVaultOperation('status', undefined)) as AuthorizationStatus;
    return listCapabilities().map((capability) => applyExtensionCapabilityProtocol(capability, status));
  }
  if (operation === 'getCapabilityDefinition') {
    const definition = getCapabilityDefinition(requiredString(asRecord(payload), 'method'));
    if (!definition) {
      throw gatewayFailure('CAPABILITY_DEFINITION_MISSING', 'This capability has no typed definition.');
    }
    const status = (await executeCredentialVaultOperation('status', undefined)) as AuthorizationStatus;
    return applyExtensionCapabilityProtocol(definition, status);
  }

  if (productOptions?.productContext) {
    assertTrustedOptionsPage(trustedOptionsPage);
    requireProductOperationContext(productOptions.productContext);
  }
  if (galleryContext) {
    if (!trustedOptionsPage) throw gatewayFailure('GALLERY_CONTEXT_UNTRUSTED', 'GALLERY_CONTEXT_UNTRUSTED');
    requireGalleryContext(galleryContext);
  }
  const settings = await resolveAuthorization(
    await loadAuthorizationSettings(),
    operation,
    payload,
    productOptions?.productContext?.gateway ?? galleryContext?.gateway ?? undefined,
    productOptions?.productContext ? 'PRODUCT_CONTEXT_CHANGED' : 'GALLERY_CONTEXT_CHANGED'
  );
  const availability = resolveExtensionOperationAvailability(operation, asRecord(payload), settings.protocol);
  if (!availability.allowed) {
    throw new GatewayException({
      code: availability.reasonCode,
      message: availability.message,
      retryable: false
    });
  }
  if (
    productOptions?.productBatchId &&
    (!isRequestId(productOptions.productBatchId) ||
      !productOptions.productContext ||
      operation !== 'updateProduct')
  )
    throw gatewayFailure('PRODUCT_CONTEXT_INVALID', 'PRODUCT_CONTEXT_INVALID');
  if (productOptions?.productContext) {
    assertTrustedOptionsPage(trustedOptionsPage);
    assertProductOperationContext(
      requireProductOperationContext(productOptions.productContext),
      await createProductOperationContext('extension:local-admin', settings)
    );
  }
  if (galleryContext) {
    if (!trustedOptionsPage) throw gatewayFailure('GALLERY_CONTEXT_UNTRUSTED', 'GALLERY_CONTEXT_UNTRUSTED');
    requireGalleryContext(galleryContext);
    assertGalleryContextId(galleryContext.identity, await opaqueGalleryId('extension:local-admin'));
    assertGalleryContextId(galleryContext.gateway, await galleryGatewayId(settings));
    const currentS3 = new ExtensionS3Service(s3LocalStore, (origins) =>
      browser.permissions.contains({ origins })
    );
    assertGalleryContextId(galleryContext.storage, await currentS3.contextId());
  }
  assertCredentials(settings);
  const client = AlibabaClient.create(settings, {
    requestId,
    maxAttempts:
      operation === 'updateProductDisplay' ||
      productOptions?.productContext !== undefined ||
      operation === 'getProductInventory' ||
      operation === 'associateProductVideo' ||
      operation === 'verifyProductVideoAssociation' ||
      VIDEO_OPERATIONS.some((value) => value === operation)
        ? 1
        : 3,
    shouldRetry: (method, error) =>
      error.retryable &&
      !VIDEO_METHODS.some((value) => value === method) &&
      findCapability(method)?.risk === 'read'
  });
  const mutationClient =
    settings.protocol === 'iop'
      ? client
      : AlibabaClient.create(
          { ...settings, endpoint: ALIBABA_SYNC_GATEWAY, signMethod: 'hmac-sha256' },
          {
            requestId,
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
    case 'associateProductVideo':
      throw gatewayFailure('REAL_MUTATION_DISABLED', 'REAL_MUTATION_DISABLED');
    case 'verifyProductVideoAssociation':
      return new VideoAssociationAdapter(
        client,
        validateCapabilityRequest,
        validateCapabilityResponse
      ).verify(payload as RequestOf<'verifyProductVideoAssociation'>);
    case 'listVideos':
      return new VideoAdapter(client, validateCapabilityRequest, validateCapabilityResponse).list(
        payload as RequestOf<'listVideos'>
      );
    case 'listVideoRelatedProducts':
      return new VideoAdapter(client, validateCapabilityRequest, validateCapabilityResponse).related(
        payload as RequestOf<'listVideoRelatedProducts'>
      );
    case 'resolveVideoRelatedProduct':
      return new VideoAdapter(client, validateCapabilityRequest, validateCapabilityResponse).resolve(
        payload as RequestOf<'resolveVideoRelatedProduct'>
      );
    case 'getProductInventory':
      return new ProductInventoryAdapter(client, validateCapabilityRequest, validateCapabilityResponse).get(
        payload as RequestOf<'getProductInventory'>
      );
    case 'getProductShowcase':
      return new ProductShowcaseAdapter(client).get();
    case 'sortShowcaseProduct':
      return new ProductShowcaseAdapter(client).sort(payload as RequestOf<'sortShowcaseProduct'>);
    case 'replaceShowcaseProduct':
      return new ProductShowcaseAdapter(client).replace(payload as RequestOf<'replaceShowcaseProduct'>);
    case 'addShowcaseProducts':
      return new ProductShowcaseAdapter(client).mutate('add', payload as RequestOf<'addShowcaseProducts'>);
    case 'removeShowcaseProducts':
      return new ProductShowcaseAdapter(client).mutate(
        'remove',
        payload as RequestOf<'removeShowcaseProducts'>
      );
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
      return productMutations.submitCreation(
        products,
        requestId,
        operation,
        validation.data,
        settings.protocol === 'iop'
          ? { productContext: await createProductOperationContext('extension:local-admin', settings) }
          : productOptions
      );
    }
    case 'updateProduct': {
      assertTrustedOptionsPage(trustedOptionsPage);
      const validation = validateProductSchemaUpdateInput(payload);
      if (!validation.valid || !validation.data) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: validation.errors.join('; ') || 'The product update request is invalid.',
          retryable: false
        });
      }
      return productMutations.submitUpdate(
        products,
        requestId,
        validation.data,
        requiredProductMutationFingerprint(productMutationFingerprint),
        productOptions
      );
    }
    case 'updateProductDisplay': {
      if (request.protocol !== undefined && request.protocol !== (settings.protocol ?? 'top')) {
        throw gatewayFailure('PRODUCT_CONTEXT_CHANGED', 'PRODUCT_CONTEXT_CHANGED');
      }
      const validation = validateProductDisplayInput({ ...request, protocol: settings.protocol ?? 'top' });
      if (!validation.valid || !validation.data) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: validation.errors.join('; ') || 'The product display request is invalid.',
          retryable: false
        });
      }
      const productContext = await createProductOperationContext('extension:local-admin', settings);
      return productMutations.submit(
        boundProductDisplayGateway(products, productContext, settings.protocol ?? 'top'),
        requestId,
        validation.data,
        { ...productOptions, productContext }
      );
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
        requiredAlibabaLanguage(request, 'language'),
        readNumber(request, ['categoryId']) ?? undefined
      );
    case 'listProductGroups':
      return products.listGroups(readNumber(request, ['parentId']));
    case 'createProductGroup': {
      const validation = validateProductGroupCreateInput(payload);
      if (!validation.valid || !validation.data) {
        throw new GatewayException({
          code: 'REQUEST_CONTRACT_INVALID',
          message: validation.errors.join('; ') || 'The product group request is invalid.',
          retryable: false
        });
      }
      return products.createGroup(validation.data);
    }
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
      return trades.getAggregate(
        (payload as RequestOf<'getTradeOrderAggregate'>).order,
        (payload as RequestOf<'getTradeOrderAggregate'>).language
      );
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
      return executeExtensionCapabilityCall(client, request, requestId);
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
    listVideos: 'alibaba.icbu.video.query',
    listVideoRelatedProducts: 'alibaba.icbu.video.relation.product.list',
    resolveVideoRelatedProduct: 'alibaba.icbu.product.id.decrypt',
    listTradeOrders: 'alibaba.seller.order.list',
    listRfqs: 'alibaba.icbu.rfq.search'
  };
  return methods[operation] ?? null;
}

function productMutationDiagnosticMethod(
  operation: ExtensionProductMutationJobRequest['operation'],
  result: unknown
): string | null {
  if (operation === 'recover') return 'alibaba.icbu.product.batch.update.display';
  if (operation !== 'refresh') return null;
  const jobOperation = readString(asRecord(result), ['operation']);
  if (jobOperation === 'updateProduct') return 'alibaba.icbu.product.schema.render';
  if (jobOperation === 'saveProductDraft') return 'alibaba.icbu.product.schema.render.draft';
  if (jobOperation === 'publishProduct' || jobOperation === 'updateProductDisplay') {
    return 'alibaba.icbu.product.list';
  }
  return null;
}

function readResultTraceId(value: unknown): string | null {
  return readString(asRecord(value), ['traceId', 'trace_id', 'request_id']) ?? null;
}

async function loadSettings(): Promise<GatewaySettings> {
  return resolveAuthorization(await loadAuthorizationSettings());
}

async function loadAuthorizationSettings(): Promise<GatewaySettings> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  const present = Object.prototype.hasOwnProperty.call(stored, SETTINGS_STORAGE_KEY);
  const state = inspectCredentialStorage(stored[SETTINGS_STORAGE_KEY], present);
  return (await getUnlockedVault(state)).settings;
}

async function loadProductAdapter(
  expectedContext?: ProductOperationOptions['productContext'],
  expectedProtocol?: 'top' | 'iop'
): Promise<ExtensionProductDisplayGateway & ExtensionProductCreationGateway> {
  if (expectedProtocol === 'iop') requireProductOperationContext(expectedContext);
  const savedSettings = await loadAuthorizationSettings();
  let pinnedGateway = expectedContext?.gateway;
  if (pinnedGateway === undefined && expectedProtocol !== undefined) {
    const profile = authorizationProfiles(savedSettings)[expectedProtocol];
    if (!profile) throw gatewayFailure('PRODUCT_CONTEXT_CHANGED', 'PRODUCT_CONTEXT_CHANGED');
    pinnedGateway = await galleryGatewayId(runtimeAuthorization(profile));
  }
  const settings = await resolveAuthorization(savedSettings, undefined, undefined, pinnedGateway);
  if (expectedProtocol !== undefined && (settings.protocol ?? 'top') !== expectedProtocol) {
    throw gatewayFailure('PRODUCT_CONTEXT_CHANGED', 'PRODUCT_CONTEXT_CHANGED');
  }
  if (expectedContext)
    assertProductOperationContext(
      expectedContext,
      await createProductOperationContext('extension:local-admin', settings)
    );
  assertCredentials(settings);
  const client = AlibabaClient.create(settings, {
    maxAttempts: 1,
    shouldRetry: () => false
  });
  const mutationClient =
    settings.protocol === 'iop'
      ? client
      : AlibabaClient.create(
          { ...settings, endpoint: ALIBABA_SYNC_GATEWAY, signMethod: 'hmac-sha256' },
          { maxAttempts: 1, protocol: 'sync', shouldRetry: () => false }
        );
  const products = new ProductAdapter(client, mutationClient);
  const context = expectedContext ?? (await createProductOperationContext('extension:local-admin', settings));
  return {
    ...boundProductDisplayGateway(products, context, settings.protocol ?? 'top'),
    get: (...args) => products.get(...args),
    mutate: (...args) => products.mutate(...args),
    saveDraft: (request) => products.saveDraft(request)
  };
}

function boundProductDisplayGateway(
  products: ProductAdapter,
  productContext: NonNullable<ProductOperationOptions['productContext']>,
  protocol: 'top' | 'iop'
): ExtensionProductDisplayGateway {
  // Re-resolve immediately before every outbound read/write, including after job storage awaits.
  const assertBinding = async (): Promise<void> => {
    const settings = await resolveAuthorization(
      await loadAuthorizationSettings(),
      undefined,
      undefined,
      productContext.gateway
    );
    if ((settings.protocol ?? 'top') !== protocol) {
      throw gatewayFailure('PRODUCT_CONTEXT_CHANGED', 'PRODUCT_CONTEXT_CHANGED');
    }
    assertProductOperationContext(
      productContext,
      await createProductOperationContext('extension:local-admin', settings)
    );
  };
  return {
    protocol,
    list: async (request) => {
      await assertBinding();
      return products.list(request);
    },
    updateDisplay: async (request) => {
      await assertBinding();
      return products.updateDisplay(request);
    }
  };
}

function asCredentialVaultRequest(value: unknown): CredentialVaultRequest | null {
  if (!isRecord(value) || value.kind !== 'credential-vault-request' || !isRequestId(value.requestId)) {
    return null;
  }
  if (Object.keys(value).some((key) => !['requestId', 'kind', 'operation', 'payload'].includes(key)))
    return null;
  if (
    value.operation !== 'status' &&
    value.operation !== 'get-settings' &&
    value.operation !== 'create' &&
    value.operation !== 'prepare-authorization' &&
    value.operation !== 'migrate' &&
    value.operation !== 'unlock' &&
    value.operation !== 'lock' &&
    value.operation !== 'save' &&
    value.operation !== 'rotate' &&
    value.operation !== 'update-policy' &&
    value.operation !== 'authorizations' &&
    value.operation !== 'get-authorization' &&
    value.operation !== 'confirm-authorizations' &&
    value.operation !== 'set-default-authorization' &&
    value.operation !== 'clear-authorization' &&
    value.operation !== 'refresh-authorization' &&
    value.operation !== 'test-authorization'
  ) {
    return null;
  }
  return value as unknown as CredentialVaultRequest;
}

function requiredAuthorizationProtocol(value: unknown): 'top' | 'iop' {
  if (value !== 'top' && value !== 'iop')
    throw gatewayFailure('ALIBABA_PROTOCOL_INVALID', 'ALIBABA_PROTOCOL_INVALID');
  return value;
}

const PROFILE_INPUT_KEYS = [
  'protocol',
  'configurationId',
  'appKey',
  'appSecret',
  'accessToken',
  'endpoint',
  'signMethod',
  'accessTokenExpiresTimeUtc',
  'accessTokenCapturedTimeUtc',
  'systemApiPermission',
  'permissionCapturedTimeUtc',
  'refreshToken',
  'refreshTokenExpiresTimeUtc'
];
function requireOnlyKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
  return value;
}
function validateProfileInput(value: unknown): void {
  const profile = requireOnlyKeys(value, PROFILE_INPUT_KEYS);
  gatewayProtocolMetadata(profile);
  for (const key of ['appKey', 'appSecret', 'accessToken', 'endpoint', 'configurationId']) {
    if (profile[key] !== undefined && (typeof profile[key] !== 'string' || profile[key].length > 4096))
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
  }
  requiredSignMethod(profile.signMethod);
  requiredString(profile, 'endpoint');
  for (const key of [
    'accessTokenExpiresTimeUtc',
    'accessTokenCapturedTimeUtc',
    'permissionCapturedTimeUtc',
    'refreshTokenExpiresTimeUtc'
  ]) {
    const time = profile[key];
    if (
      time !== undefined &&
      time !== null &&
      (typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0 || time > 8_640_000_000_000_000)
    )
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
  }
  if (
    profile.systemApiPermission !== undefined &&
    !['active', 'inactive', 'not-recorded', 'unknown'].includes(profile.systemApiPermission as string)
  )
    throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
  privateRefreshMetadata(profile);
}
function privateRefreshMetadata(
  value: Record<string, unknown>
): Pick<GatewaySettings, 'refreshToken' | 'refreshTokenExpiresTimeUtc'> {
  if (
    value.refreshToken !== undefined &&
    value.refreshToken !== null &&
    (typeof value.refreshToken !== 'string' || value.refreshToken.length > 4096)
  )
    throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
  return {
    ...(value.refreshToken === undefined ? {} : { refreshToken: value.refreshToken }),
    ...(value.refreshTokenExpiresTimeUtc === undefined
      ? {}
      : { refreshTokenExpiresTimeUtc: value.refreshTokenExpiresTimeUtc as number | null })
  };
}
function validateCredentialVaultPayload(
  operation: CredentialVaultRequest['operation'],
  payload: unknown
): void {
  if (['status', 'get-settings', 'authorizations', 'lock'].includes(operation)) {
    // Historical runtime callers sent an empty object for no-argument operations.
    // Retain that wire shape, without accepting any extra fields.
    if (payload !== undefined && (!isRecord(payload) || Object.keys(payload).length !== 0))
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
    return;
  }
  if (operation === 'save') {
    validateProfileInput(payload);
    return;
  }
  if (operation === 'prepare-authorization' || operation === 'unlock') {
    const input = requireOnlyKeys(payload, ['passphrase']);
    if (typeof input.passphrase !== 'string' || input.passphrase.length > 256)
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
    return;
  }
  if (operation === 'create') {
    const input = requireOnlyKeys(payload, ['passphrase', 'settings']);
    if (typeof input.passphrase !== 'string' || input.passphrase.length > 256)
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
    validateProfileInput(input.settings);
    return;
  }
  if (
    ['get-authorization', 'clear-authorization', 'refresh-authorization', 'test-authorization'].includes(
      operation
    )
  ) {
    requiredAuthorizationProtocol(requireOnlyKeys(payload, ['protocol']).protocol);
    return;
  }
  if (operation === 'set-default-authorization') {
    const input = requireOnlyKeys(payload, ['protocol', 'configurationId']);
    requiredAuthorizationProtocol(input.protocol);
    if (!/^[\w.-]{1,128}$/u.test(requiredString(input, 'configurationId')))
      throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
    return;
  }
  if (operation === 'confirm-authorizations') {
    const input = requireOnlyKeys(payload, ['topConfigurationId', 'iopConfigurationId']);
    for (const key of ['topConfigurationId', 'iopConfigurationId'])
      if (!/^[\w.-]{1,128}$/u.test(requiredString(input, key)))
        throw gatewayFailure('INVALID_CREDENTIAL_VAULT_REQUEST', 'INVALID_CREDENTIAL_VAULT_REQUEST');
    return;
  }
  const key =
    operation === 'rotate'
      ? 'newPassphrase'
      : operation === 'update-policy'
        ? 'idleTimeoutMinutes'
        : 'passphrase';
  const input = requireOnlyKeys(payload, [key]);
  if (key === 'idleTimeoutMinutes') requiredNumber(input, key);
  else requiredString(input, key);
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
    value.operation !== 'import-bundle' &&
    value.operation !== 'import-bundles' &&
    value.operation !== 'export-bundle' &&
    value.operation !== 'read-prerequisite' &&
    value.operation !== 'locate-prerequisite-field' &&
    value.operation !== 'focus-prerequisite-page' &&
    value.operation !== 'open-iop-tool'
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
    value.operation !== 'complete-update-readback' &&
    value.operation !== 'recover'
  ) {
    return null;
  }
  return value as unknown as ExtensionProductMutationJobRequest;
}

function requiredProductMutationFingerprint(value: unknown): ProductMutationFingerprintSet {
  const record = asRecord(value);
  const fieldExpectations = record.fieldExpectations;
  if (
    typeof record.payloadFingerprint !== 'string' ||
    !Array.isArray(fieldExpectations) ||
    fieldExpectations.length === 0 ||
    fieldExpectations.length > 1_000
  ) {
    throw gatewayFailure('PRODUCT_MUTATION_FINGERPRINT_REQUIRED', '商品更新缺少受信扩展页面生成的字段指纹');
  }
  return {
    payloadFingerprint: record.payloadFingerprint,
    fieldExpectations: fieldExpectations.map((item) => {
      const expectation = asRecord(item);
      return {
        fieldId: requiredString(expectation, 'fieldId'),
        fingerprint: requiredString(expectation, 'fingerprint')
      };
    })
  };
}

function requiredProductUpdateReadbackResult(value: unknown): ExtensionProductUpdateReadbackResult {
  const record = asRecord(value);
  if (record.kind === 'comparison') {
    const comparison = asRecord(record.comparison);
    if (typeof comparison.matched !== 'boolean') {
      throw gatewayFailure('PRODUCT_MUTATION_READBACK_INVALID', '商品更新回读匹配状态无效');
    }
    return {
      kind: 'comparison',
      comparison: {
        matched: comparison.matched,
        missingFieldIds: requiredReadbackStringArray(comparison.missingFieldIds),
        mismatchedFieldIds: requiredReadbackStringArray(comparison.mismatchedFieldIds)
      }
    };
  }
  if (record.kind === 'error') {
    const error = asRecord(record.error);
    if (typeof error.retryable !== 'boolean') {
      throw gatewayFailure('PRODUCT_MUTATION_READBACK_INVALID', '商品更新回读错误状态无效');
    }
    const code = requiredString(error, 'code');
    const message = requiredString(error, 'message');
    const subCode = readString(error, ['subCode']);
    const traceId = readString(error, ['traceId']);
    if (
      code.length > 128 ||
      message.length > 4_096 ||
      (subCode?.length ?? 0) > 256 ||
      (traceId?.length ?? 0) > 512
    ) {
      throw gatewayFailure('PRODUCT_MUTATION_READBACK_INVALID', '商品更新回读错误内容过长');
    }
    return {
      kind: 'error',
      error: {
        code,
        message,
        retryable: error.retryable,
        ...(subCode === undefined ? {} : { subCode }),
        ...(traceId === undefined ? {} : { traceId })
      }
    };
  }
  throw gatewayFailure('PRODUCT_MUTATION_READBACK_INVALID', '商品更新回读结果无效');
}

function requiredReadbackStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1_000 || !value.every((item) => typeof item === 'string')) {
    throw gatewayFailure('PRODUCT_MUTATION_READBACK_INVALID', '商品更新回读字段列表无效');
  }
  return [...value];
}

function assertTrustedOptionsPage(trusted: boolean): void {
  if (trusted) return;
  throw gatewayFailure('EXTENSION_TRUSTED_PAGE_REQUIRED', '商品更新及其回读只能由插件设置工作台发起');
}

function isTrustedOptionsPageSender(sender: { id?: string; url?: string }): boolean {
  return isTrustedExtensionPageSender(sender, browser.runtime.id, browser.runtime.getURL('/options.html'));
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

function requiredGatewaySettings(value: unknown, allowEmptyCredentials = false): GatewaySettings {
  const record = asRecord(value);
  const credential = (key: string): string => {
    // Initial protection setup may precede import. This does not create a configured
    // authorization: summaries and gateway routing still require all three values.
    if (allowEmptyCredentials && typeof record[key] === 'string') return record[key];
    return requiredString(record, key);
  };
  return {
    ...gatewayProtocolMetadata(record),
    appKey: credential('appKey'),
    appSecret: credential('appSecret'),
    accessToken: credential('accessToken'),
    ...gatewayCredentialExpiryMetadata(record),
    ...privateRefreshMetadata(record),
    endpoint: requiredString(record, 'endpoint'),
    signMethod: requiredSignMethod(record.signMethod)
  };
}

function gatewayProtocolMetadata(
  value: Record<string, unknown>,
  existing?: GatewaySettings['protocol']
): Pick<GatewaySettings, 'protocol'> {
  const protocol = value.protocol === undefined ? existing : value.protocol;
  if (protocol === undefined) return {};
  if (protocol !== 'top' && protocol !== 'iop')
    throw gatewayFailure('ALIBABA_PROTOCOL_INVALID', 'ALIBABA_PROTOCOL_INVALID');
  return { protocol };
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrap(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  // TOP simplify=true may omit the method envelope. Match the Node adapter;
  // preserve the payload for the method-specific response validator.
  const key = `${method.replaceAll('.', '_')}_response`;
  return Object.hasOwn(record, key) ? asRecord(record[key]) : record;
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

function assertCredentials(settings: GatewaySettings): void {
  if (!settings.appKey || !settings.appSecret || !settings.accessToken) {
    throw new GatewayException({
      code: 'MISSING_CREDENTIALS',
      message: 'Configure the App Key, App Secret, and Access Token in Settings first.',
      retryable: false
    });
  }
}

function gatewayFailure(code: string, message: string): GatewayException {
  return new GatewayException({ code, message, retryable: false });
}
import { ProductInventoryAdapter } from '@one-vegetable/core/inventory';
