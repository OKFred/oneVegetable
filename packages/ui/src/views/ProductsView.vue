<script setup lang="ts">
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { ChevronDown, Download, Ellipsis, Layers3, ListPlus, RefreshCw, Search, Upload } from '@lucide/vue';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui';
import { toast } from 'vue-sonner';

import {
  analyzeProductDescriptionQuality,
  collectProductSchemaAssetReferences,
  collectProductSchemaOfficialHints,
  createProductTransferArchiveDocument,
  createProductTransferDocument,
  createProductScoreOfficialHints,
  decodeBase64,
  encodeBase64,
  inspectProductSchemaPatchSerialization,
  inspectProductSchemaSerialization,
  MAX_PRODUCT_TRANSFER_ITEMS,
  parseProductSchemaXml,
  PRODUCT_EDITOR_STEP_IDS,
  productMutationJobHasResolvedProductId,
  productMutationJobIsBlocking,
  productSchemaXmlToJson,
  replaceProductSchemaAssetReferences,
  resolveProductSchemaXml,
  serializeProductSchemaXml,
  productTransferQueueItemId,
  serializeProductTransferDocument,
  validateProductDisplayInput,
  validateProductSchemaRenderInput,
  validateProductSchemaUpdateInput,
  validateSchemaPublishInput,
  type Product,
  type ProductCategory,
  type ProductGroup,
  type ProductDescriptionImageMetadata,
  type ProductEditorStepId,
  type ProductMutationJob,
  type OperationId,
  type ProductSchemaOfficialHint,
  type ProductSchemaModel,
  type ProductScore,
  type ProductTransferItemInput,
  type ProductTransferDocumentV1,
  type ProductTransferDocumentV2,
  type ProductTransferSchemaFormat
} from '@one-vegetable/core';

import ActionTooltip from '../components/ActionTooltip.vue';
import ConfirmActionDialog from '../components/ConfirmActionDialog.vue';
import DataTable from '../components/DataTable.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import GroupSidebar from '../components/GroupSidebar.vue';
import ImagePreview, { type ImagePreviewItem } from '../components/ImagePreview.vue';
import PageHeader from '../components/PageHeader.vue';
import ProductBatchPublisher from '../components/ProductBatchPublisher.vue';
import ProductCategoryPicker from '../components/ProductCategoryPicker.vue';
import ProductEditorLoading from '../components/ProductEditorLoading.vue';
import ProductGroupManagerDialog from '../components/ProductGroupManagerDialog.vue';
import ProductGroupNavigation from '../components/ProductGroupNavigation.vue';
import ProductTransferDialog from '../components/ProductTransferDialog.vue';
import QueryState from '../components/QueryState.vue';
import TriStateCheckbox from '../components/TriStateCheckbox.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { formatDateTime } from '../lib/date-time';
import {
  findProductEditorDraft,
  migrateLegacyProductEditorDraft,
  migrateProductEditorDraftsV2,
  productEditorDraftKey,
  removeProductEditorDraft,
  saveProductEditorDraft,
  shouldPersistProductEditorDraft,
  type ProductEditorDraftV3,
  type ProductEditorMode
} from '../lib/product-editor-drafts';
import {
  completeProductBatchPublishItem,
  importProductBatchPublishItems,
  inspectProductBatchPublishImport,
  loadProductBatchPublishItems,
  removeProductBatchPublishItem,
  runProductBatchPublish,
  upsertProductBatchPublishItem,
  type ProductBatchPublishItem,
  type ProductBatchPublishRunResult,
  type ProductBatchPublishTarget
} from '../lib/product-batch-publish';
import { useProductEditorSession } from '../composables/use-product-editor-session';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { appHash, parseAppHash } from '../lib/hash-router';
import {
  createProductTransferArchive,
  productTransferArchiveAssetPath,
  type ProductTransferArchiveAsset,
  type ProductTransferFileFormat,
  type ProductTransferImportSelection,
  type ProductTransferProgress
} from '../lib/product-transfer-archive';
import { productStatusLabel } from '../lib/product-status';
import { describeProductExportDisabled, retainCurrentPageSelection } from '../lib/product-selection';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { hasUiTranslation, useUiI18n } from '../i18n';
import type { DataColumn } from '../lib/table';

const ProductEditorWizard = defineAsyncComponent({
  loader: () => import('../components/ProductEditorWizard.vue'),
  loadingComponent: ProductEditorLoading,
  delay: 100,
  timeout: 30_000
});

type Workspace = 'list' | 'publisher' | 'batch-publisher';
type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ProductActionConfirmation =
  | { kind: 'product'; draft: boolean; changedNames: string[] }
  | { kind: 'batch-publish'; target: ProductBatchPublishTarget; itemIds: string[] }
  | { kind: 'batch-display'; display: 'online' | 'offline'; productIds: string[] }
  | { kind: 'recover-display'; job: ProductMutationJob };

const workspaceIds = new Set<Workspace>(['list', 'publisher', 'batch-publisher']);
const editorModes = new Set<ProductEditorMode>(['quick', 'guided', 'advanced']);
const editorStepIds = new Set<ProductEditorStepId>(PRODUCT_EDITOR_STEP_IDS);
const PRODUCT_SCORE_DISPLAY_MAX = 6;

const { gateway, mode, productMutationJobs } = useServices();
const { locale, t } = useUiI18n();
const { alibabaLanguage: preferredLanguage } = useAppPreferences();
const queryClient = useQueryClient();
const workspace = ref<Workspace>('list');
const subject = ref('');
const productPage = ref(1);
const productPageSize = ref(20);
const {
  model: schemaModel,
  categoryId,
  language,
  market,
  productId: editProductId,
  platformDraftId,
  mode: editorMode,
  step: editorStep,
  issues: schemaIssues,
  blockingIssues: blockingSchemaIssues,
  inspection: schemaInspection,
  preview: schemaPreview,
  descriptionType: productDescriptionType,
  descriptionHtml: productDescriptionHtml,
  updateRootField,
  reset: resetEditorSession
} = useProductEditorSession({
  language: preferredLanguage.value,
  onFieldChange: () => {
    reconcileDraftAfterFieldChange();
  }
});
const editScoreProductId = ref('');
const schemaError = ref('');
const feedback = ref('');
const draftCandidate = ref<ProductEditorDraftV3 | null>(null);
const migratedDraftKey = ref<string | null>(null);
const draftSaveStatus = ref<DraftSaveStatus>('idle');
const selectedProductIds = ref<string[]>([]);
const imageMetadata = ref<Record<string, ProductDescriptionImageMetadata>>({});
const categorySearch = ref('');
const categoryTree = ref<ProductCategory[]>([]);
const currentCategory = ref<ProductCategory | null>(null);
const categoryLoadingId = ref<number | null>(null);
let applyingProductRoute = false;
const categoryLoadError = ref('');
const productScores = ref<Record<string, ProductScore>>({});
const productScoreErrors = ref<Record<string, string>>({});
const queryingSelectedProductScores = ref(false);
let scoreRefreshTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let draftSaveTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
const sourceIsLocalDraft = ref(false);
const acknowledgedMutationJobId = ref('');
const batchItems = ref<ProductBatchPublishItem[]>([]);
const selectedBatchItemIds = ref<string[]>([]);
const batchTarget = ref<ProductBatchPublishTarget>('draft');
const batchResults = ref<Record<string, ProductBatchPublishRunResult>>({});
const activeBatchItemId = ref('');
const stopBatchRequested = ref(false);
const editingBatchItemId = ref('');
const productTransferBusy = ref(false);
const productTransferError = ref('');
const productTransferSchemaFormat = ref<ProductTransferSchemaFormat>('json');
const productTransferFileFormat = ref<ProductTransferFileFormat>('json');
const productTransferProgress = ref<ProductTransferProgress | null>(null);
const productTransferDialogOpen = ref(false);
const productTransferDialogMode = ref<'import' | 'export'>('import');
const productTransferExportProducts = ref<Product[]>([]);
const productPreviewOpen = ref(false);
const productPreviewImages = ref<ImagePreviewItem[]>([]);
const productGroupDialogOpen = ref(false);
const productGroupNavigationRevision = ref(0);
const productGroupSidebarCollapsed = ref(false);
const selectedProductGroupId = ref<number | null>(null);
const selectedProductGroupLevel = ref<1 | 2 | 3 | undefined>(undefined);
const actionConfirmation = ref<ProductActionConfirmation | null>(null);

const products = useQuery({
  queryKey: [
    'products',
    subject,
    language,
    productPage,
    productPageSize,
    selectedProductGroupId,
    selectedProductGroupLevel
  ],
  queryFn: () =>
    gateway.request('listProducts', {
      page: productPage.value,
      pageSize: productPageSize.value,
      subject: subject.value,
      language: language.value,
      ...(selectedProductGroupId.value !== null
        ? {
            groupId: selectedProductGroupId.value,
            groupLevel: selectedProductGroupLevel.value ?? 1
          }
        : {})
    })
});
const categories = useQuery({
  queryKey: ['product-categories', 'tree-v2'],
  queryFn: () => gateway.request('listProductCategories', {}),
  staleTime: 10 * 60 * 1000
});
const productOperations = useOperationAvailability([
  'saveProductDraft',
  'publishProduct',
  'updateProduct',
  'updateProductDisplay'
]);
const productTransferOperations = useOperationAvailability(['uploadPhoto', 'downloadProductAsset']);
const productMutationHistory = useQuery({
  queryKey: ['product-mutation-jobs', editProductId],
  queryFn: async () => {
    if (!productMutationJobs || !editProductId.value) {
      return { items: [], page: 1, pageSize: 20, total: 0 };
    }
    const page = await productMutationJobs.list({ productId: editProductId.value, pageSize: 20 });
    const pending = page.items.find(
      (job) => job.operation === 'updateProduct' && (job.status === 'submitted' || job.status === 'auditing')
    );
    if (!pending) return page;
    const refreshed = await productMutationJobs.refresh(pending.id, pending.revision);
    return {
      ...page,
      items: page.items.map((job) => (job.id === refreshed.id ? refreshed : job))
    };
  },
  enabled: computed(() => productMutationJobs !== undefined && editProductId.value !== ''),
  refetchInterval: (query) =>
    query.state.data?.items.some((job) => job.status === 'submitted' || job.status === 'auditing')
      ? 15_000
      : false,
  staleTime: 0
});
const displayMutationHistory = useQuery({
  queryKey: ['product-display-mutation-jobs'],
  queryFn: async () => {
    if (!productMutationJobs) return [];
    const page = await productMutationJobs.list({ pageSize: 100 });
    const displayJobs = page.items.filter((job) => job.operation === 'updateProductDisplay');
    const refreshed: ProductMutationJob[] = [];
    for (const job of displayJobs) {
      if (!productMutationJobIsBlocking(job.status)) {
        refreshed.push(job);
        continue;
      }
      try {
        refreshed.push(await productMutationJobs.refresh(job.id, job.revision));
      } catch {
        refreshed.push(job);
      }
    }
    return refreshed;
  },
  enabled: computed(() => productMutationJobs !== undefined),
  refetchInterval: (query) =>
    query.state.data?.some((job) => productMutationJobIsBlocking(job.status)) ? 15_000 : false,
  staleTime: 0
});
const creationMutationHistory = useQuery({
  queryKey: ['product-creation-mutation-jobs'],
  queryFn: async () => {
    if (!productMutationJobs) return [];
    const page = await productMutationJobs.list({ pageSize: 100 });
    const creationJobs = page.items.filter(
      (job) => job.operation === 'publishProduct' || job.operation === 'saveProductDraft'
    );
    const refreshed: ProductMutationJob[] = [];
    for (const job of creationJobs) {
      if (!productMutationJobIsBlocking(job.status)) {
        refreshed.push(job);
        continue;
      }
      try {
        refreshed.push(await productMutationJobs.refresh(job.id, job.revision));
      } catch {
        refreshed.push(job);
      }
    }
    return refreshed.toSorted(
      (left, right) => right.submittedTimeUtc - left.submittedTimeUtc || right.id.localeCompare(left.id)
    );
  },
  enabled: computed(() => productMutationJobs !== undefined),
  refetchInterval: (query) =>
    query.state.data?.some((job) => productMutationJobIsBlocking(job.status)) ? 15_000 : false,
  staleTime: 0
});

const categoryOptions = computed(() => flattenCategories(categoryTree.value));
const batchCategoryLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(categoryOptions.value.map((category) => [String(category.id), category.name]))
);
const selectedCategory = computed(
  () =>
    categoryOptions.value.find((category) => String(category.id) === categoryId.value) ??
    (currentCategory.value && String(currentCategory.value.id) === categoryId.value
      ? currentCategory.value
      : null)
);
const categorySelectionReady = computed(
  () => categoryId.value !== '' && (editProductId.value !== '' || selectedCategory.value?.leaf === true)
);
const categoryPickerError = computed(
  () => categoryLoadError.value || (categories.error.value ? errorMessage(categories.error.value) : '')
);
const currentProductMutationJob = computed<ProductMutationJob | null>(
  () => productMutationHistory.data.value?.items.find((job) => job.operation === 'updateProduct') ?? null
);
const currentCreationMutationJob = computed<ProductMutationJob | null>(
  () => creationMutationHistory.data.value?.[0] ?? null
);
const productMutationBlocksSubmit = computed(() => {
  const job = currentProductMutationJob.value;
  if (!job) return false;
  if (job.status === 'submitted' || job.status === 'auditing' || job.status === 'recovery-required') {
    return true;
  }
  return job.status === 'verified' && acknowledgedMutationJobId.value !== job.id;
});
function dedicatedMutationAllowed(operation: OperationId): boolean {
  return productOperations.isAllowed(operation);
}
const productDisplayMutationDisabled = computed(() => !dedicatedMutationAllowed('updateProductDisplay'));
const platformDraftDisabled = computed(() => {
  return !productOperations.isAllowed('saveProductDraft');
});
const productPublishDisabled = computed(() => {
  if (editProductId.value && productMutationBlocksSubmit.value) return true;
  const operation = editProductId.value ? 'updateProduct' : 'publishProduct';
  return !productOperations.isAllowed(operation);
});
const platformDraftDisabledReason = computed(() =>
  mutationDisabledReason('saveProductDraft', t('products.view.errors.draftWriteDisabled'))
);
const productPublishDisabledReason = computed(() =>
  productMutationBlocksSubmit.value
    ? productMutationDisabledReason(currentProductMutationJob.value)
    : mutationDisabledReason(
        editProductId.value ? 'updateProduct' : 'publishProduct',
        editProductId.value
          ? t('products.view.errors.updateDisabled')
          : t('products.view.errors.publishDisabled')
      )
);

const publish = useMutation({
  mutationFn: async (draft: boolean) => {
    if (!schemaModel.value) throw new Error(t('products.view.errors.schemaFirst'));
    if (editProductId.value) {
      const patch = inspectProductSchemaPatchSerialization(schemaModel.value, locale.value);
      if (!patch.safe) {
        throw new Error(
          t('products.view.errors.schemaInvalid', { details: patch.structuralDiffs.join('; ') })
        );
      }
      if (patch.noOp || patch.changedFieldKeys.length === 0) {
        throw new Error(t('products.view.errors.noChanges'));
      }
      const changedFieldKeys = new Set(patch.changedFieldKeys);
      const changedErrors = blockingSchemaIssues.value.filter((issue) =>
        [...changedFieldKeys].some(
          (fieldKey) => issue.fieldKey === fieldKey || issue.fieldKey.startsWith(`${fieldKey}:`)
        )
      );
      if (changedErrors.length > 0) throw new Error(t('products.view.errors.changedMinimum'));
      const request = {
        productId: editProductId.value,
        categoryId: Number(categoryId.value),
        language: language.value,
        schemaPatchXml: patch.xml
      };
      const validation = validateProductSchemaUpdateInput(request);
      if (!validation.valid || !validation.data) throw new Error(validation.errors.join('；'));
      return gateway.request('updateProduct', validation.data);
    }
    const inspection = inspectProductSchemaSerialization(schemaModel.value, locale.value);
    if (!inspection.safe) {
      throw new Error(
        t('products.view.errors.schemaInvalid', { details: inspection.structuralDiffs.join('; ') })
      );
    }
    const base = {
      categoryId: Number(categoryId.value),
      language: language.value,
      schemaXml: inspection.xml
    };
    const validation = validateSchemaPublishInput(base);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if (!draft && blockingSchemaIssues.value.length > 0)
      throw new Error(t('products.view.errors.publishingMinimum'));
    return draft ? gateway.request('saveProductDraft', base) : gateway.request('publishProduct', base);
  },
  onSuccess: async (result, draft) => {
    if (editProductId.value && result.job) {
      feedback.value = t('products.view.feedback.reviewSubmitted', { id: result.productId });
      saveCurrentLocalDraft();
      queryClient.setQueryData(['product-mutation-jobs', editProductId.value], {
        items: [result.job],
        page: 1,
        pageSize: 20,
        total: 1
      });
      await queryClient.invalidateQueries({
        queryKey: ['product-mutation-jobs', editProductId.value]
      });
      return;
    }
    const creationPending =
      !editProductId.value && result.job !== undefined && result.job.status !== 'verified';
    if (!editProductId.value && result.job) {
      queryClient.setQueryData(['product-creation-mutation-jobs'], [result.job]);
      await queryClient.invalidateQueries({ queryKey: ['product-creation-mutation-jobs'] });
    }
    feedback.value = editProductId.value
      ? t('products.view.feedback.updated', { id: result.productId })
      : creationPending
        ? t('products.view.feedback.creationAccepted', {
            action: t(draft ? 'products.view.feedback.draftCreation' : 'products.view.feedback.publishing'),
            id: result.productId
          })
        : t('products.view.feedback.creationConfirmed', {
            action: t(
              draft ? 'products.view.feedback.draftConfirmed' : 'products.view.feedback.publishConfirmed'
            ),
            id: result.productId
          });
    if (!editProductId.value && editingBatchItemId.value && 'localStorage' in globalThis) {
      completeProductBatchPublishItem(
        globalThis.localStorage,
        editingBatchItemId.value,
        draft ? 'draft' : 'publish',
        result.productId
      );
      editingBatchItemId.value = '';
      reloadBatchItems();
    }
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    if (draft && !editProductId.value) {
      platformDraftId.value = result.productId;
      saveCurrentLocalDraft();
    } else if (!creationPending) {
      clearCurrentLocalDraft();
    } else {
      saveCurrentLocalDraft();
    }
    if (editScoreProductId.value) scheduleScoreRefresh(editScoreProductId.value);
  }
});

const batchPublish = useMutation({
  mutationFn: async (input: { ids: string[]; target: ProductBatchPublishTarget }) => {
    const selected = batchItems.value.filter(
      (item) => input.ids.includes(item.id) && item.status === 'queued'
    );
    stopBatchRequested.value = false;
    activeBatchItemId.value = '';
    batchResults.value = Object.fromEntries(
      Object.entries(batchResults.value).filter(([itemId]) => !input.ids.includes(itemId))
    );
    return runProductBatchPublish({
      items: selected,
      target: input.target,
      locale: locale.value,
      shouldStop: () => stopBatchRequested.value,
      onStart: (item) => {
        activeBatchItemId.value = item.id;
      },
      onResult: (result) => {
        activeBatchItemId.value = '';
        batchResults.value = { ...batchResults.value, [result.itemId]: result };
        if (result.status !== 'succeeded' || !result.productId || !('localStorage' in globalThis)) return;
        try {
          completeProductBatchPublishItem(
            globalThis.localStorage,
            result.itemId,
            result.target,
            result.productId
          );
          reloadBatchItems();
          selectedBatchItemIds.value = selectedBatchItemIds.value.filter(
            (itemId) => itemId !== result.itemId
          );
        } catch (error: unknown) {
          feedback.value = t('products.view.feedback.acceptedQueueSaveFailed', {
            title: result.title,
            error: errorMessage(error)
          });
        }
      },
      submit: (request) =>
        input.target === 'draft'
          ? gateway.request('saveProductDraft', request)
          : gateway.request('publishProduct', request)
    });
  },
  onSuccess: async (results) => {
    const succeeded = results.filter((result) => result.status === 'succeeded').length;
    const failed = results.filter((result) => result.status === 'failed').length;
    const blocked = results.filter((result) => result.status === 'blocked').length;
    const cancelled = results.filter((result) => result.status === 'cancelled').length;
    feedback.value = t('products.view.feedback.batchFinished', {
      succeeded,
      failed,
      blocked,
      cancelled
    });
    if (succeeded > 0) await queryClient.invalidateQueries({ queryKey: ['products'] });
  },
  onSettled: () => {
    activeBatchItemId.value = '';
    stopBatchRequested.value = false;
  }
});

const productScore = useMutation({
  mutationFn: (productId: string) => gateway.request('getProductScore', { productId }),
  onMutate: (productId) => {
    productScoreErrors.value = Object.fromEntries(
      Object.entries(productScoreErrors.value).filter(([key]) => key !== productId)
    );
  },
  onSuccess: (result, productId) => {
    productScores.value = { ...productScores.value, [productId]: result };
  },
  onError: (error, productId) => {
    productScoreErrors.value = { ...productScoreErrors.value, [productId]: errorMessage(error) };
  }
});

const officialHints = computed<ProductSchemaOfficialHint[]>(() => [
  ...(schemaModel.value ? collectProductSchemaOfficialHints(schemaModel.value.fields) : []),
  ...createProductScoreOfficialHints(productScore.data.value?.issues ?? [])
]);
const qualityIssues = computed(() =>
  analyzeProductDescriptionQuality({
    html: productDescriptionHtml.value,
    schemaIssues: schemaIssues.value,
    officialHints: officialHints.value,
    imageMetadata: imageMetadata.value,
    locale: locale.value
  })
);
const currentPageProducts = computed(() => products.data.value?.items ?? []);
const currentPageProductIds = computed(() => currentPageProducts.value.map((product) => product.id));
const selectedProducts = computed(() =>
  currentPageProducts.value.filter((product) => selectedProductIds.value.includes(product.id))
);
const allCurrentPageProductsSelected = computed(
  () =>
    currentPageProducts.value.length > 0 && selectedProducts.value.length === currentPageProducts.value.length
);
const someCurrentPageProductsSelected = computed(
  () => selectedProducts.value.length > 0 && !allCurrentPageProductsSelected.value
);
const productExportDisabledReason = computed(() =>
  describeProductExportDisabled(selectedProducts.value.length, productTransferBusy.value)
);
const productTransferAssetUploadAllowed = computed(() => productTransferOperations.isAllowed('uploadPhoto'));
const productTransferAssetDownloadAllowed = computed(() =>
  productTransferOperations.isAllowed('downloadProductAsset')
);
const productTransferAssetUploadDisabledReason = computed(() =>
  operationAvailabilityMessage(
    productTransferOperations.reasonCode('uploadPhoto'),
    t('products.view.errors.uploadDisabled')
  )
);
const productTransferAssetDownloadDisabledReason = computed(() =>
  operationAvailabilityMessage(
    productTransferOperations.reasonCode('downloadProductAsset'),
    t('products.view.errors.downloadDisabled')
  )
);
const moreActionsDisabledReason = computed(() =>
  selectedProducts.value.length === 0 ? t('products.view.errors.selectProduct') : ''
);
const actionConfirmationTitle = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return t('products.view.confirmation.genericTitle');
  if (action.kind === 'product') {
    if (editProductId.value) return t('products.view.confirmation.updateTitle');
    return t(
      action.draft ? 'products.view.confirmation.draftTitle' : 'products.view.confirmation.publishTitle'
    );
  }
  if (action.kind === 'batch-publish') {
    return t(
      action.target === 'draft'
        ? 'products.view.confirmation.batchDraftTitle'
        : 'products.view.confirmation.batchPublishTitle'
    );
  }
  if (action.kind === 'batch-display') {
    return t(
      action.display === 'online'
        ? 'products.view.confirmation.batchOnlineTitle'
        : 'products.view.confirmation.batchOfflineTitle'
    );
  }
  return t('products.view.confirmation.recoverTitle');
});
const actionConfirmationDescription = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return '';
  if (action.kind === 'product') {
    return editProductId.value
      ? t('products.view.confirmation.updateDescription', { id: editProductId.value })
      : action.draft
        ? t('products.view.confirmation.draftDescription')
        : t('products.view.confirmation.publishDescription');
  }
  if (action.kind === 'batch-publish') {
    return action.target === 'draft'
      ? t('products.view.confirmation.batchDraftDescription', { count: action.itemIds.length })
      : t('products.view.confirmation.batchPublishDescription', { count: action.itemIds.length });
  }
  if (action.kind === 'batch-display') {
    return t('products.view.confirmation.batchDisplayDescription', {
      count: action.productIds.length,
      action: t(
        action.display === 'online' ? 'products.view.feedback.online' : 'products.view.feedback.offline'
      )
    });
  }
  return t('products.view.confirmation.recoverDescription', {
    id: action.job.productId,
    action: t(
      action.job.originalDisplay === 'online'
        ? 'products.view.feedback.online'
        : 'products.view.feedback.offline'
    )
  });
});
const actionConfirmationDestructive = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return false;
  if (action.kind === 'product') return !action.draft;
  if (action.kind === 'batch-publish') return action.target === 'publish';
  return true;
});
const selectedEncryptedProductIds = computed(() =>
  selectedProducts.value.flatMap((product) => (product.encryptedId ? [product.encryptedId] : []))
);
const selectedProductMissingEncryptedId = computed(
  () => selectedProducts.value.length !== selectedEncryptedProductIds.value.length
);
const selectedDisplayMutationBlocked = computed(() =>
  (displayMutationHistory.data.value ?? []).some(
    (job) => selectedProductIds.value.includes(job.productId) && productMutationJobIsBlocking(job.status)
  )
);
const latestDisplayMutationJobs = computed(() => (displayMutationHistory.data.value ?? []).slice(0, 5));
const refreshDisplayMutation = useMutation({
  mutationFn: (job: ProductMutationJob) => {
    if (!productMutationJobs) throw new Error(t('products.view.errors.jobUnsupported'));
    return productMutationJobs.refresh(job.id, job.revision);
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-display-mutation-jobs'] })
});
const recoverDisplayMutation = useMutation({
  mutationFn: (job: ProductMutationJob) => {
    if (!productMutationJobs) throw new Error(t('products.view.errors.jobUnsupported'));
    return productMutationJobs.recover(job.id, job.revision);
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-display-mutation-jobs'] })
});
const batchDisplay = useMutation({
  mutationFn: (display: 'online' | 'offline') => {
    const validation = validateProductDisplayInput({
      productIds: selectedProducts.value.map((product) => product.id),
      encryptedProductIds: selectedEncryptedProductIds.value,
      display
    });
    if (!validation.valid || !validation.data) throw new Error(validation.errors.join('；'));
    return gateway.request('updateProductDisplay', validation.data);
  },
  onSuccess: async (result, display) => {
    feedback.value = result.jobs?.length
      ? t('products.view.feedback.displaySubmitted', {
          count: result.jobs.length,
          action: t(display === 'online' ? 'products.view.feedback.online' : 'products.view.feedback.offline')
        })
      : t('products.view.feedback.displayDone', {
          count: result.encryptedProductIds.length,
          action: t(display === 'online' ? 'products.view.feedback.online' : 'products.view.feedback.offline')
        });
    selectedProductIds.value = [];
    await queryClient.invalidateQueries({ queryKey: ['product-display-mutation-jobs'] });
    await queryClient.invalidateQueries({ queryKey: ['products'] });
  }
});

function submitProduct(draft: boolean): void {
  const changedNames = editProductId.value
    ? (schemaModel.value?.fields ?? [])
        .filter((field) => schemaInspection.value.changedFieldKeys.includes(field.key))
        .map((field) => field.name || field.id)
    : [];
  if (editProductId.value) {
    if (changedNames.length === 0) {
      feedback.value = t('products.view.errors.noChanges');
      return;
    }
  }
  if (mode !== 'mock') {
    actionConfirmation.value = { kind: 'product', draft, changedNames };
    return;
  }
  publish.mutate(draft);
}

function queueCurrentProduct(): void {
  if (editProductId.value) {
    feedback.value = t('products.view.errors.existingBatch');
    return;
  }
  if (!schemaModel.value || !categoryId.value || !schemaInspection.value.safe) {
    feedback.value = t('products.view.errors.loadForm');
    return;
  }
  if (!('localStorage' in globalThis)) {
    feedback.value = t('products.view.errors.localQueueUnsupported');
    return;
  }
  try {
    const queued = upsertProductBatchPublishItem(
      globalThis.localStorage,
      {
        categoryId: categoryId.value,
        language: language.value,
        market: market.value,
        xml: schemaInspection.value.xml
      },
      editingBatchItemId.value ? { id: editingBatchItemId.value } : undefined
    );
    editingBatchItemId.value = '';
    reloadBatchItems();
    selectedBatchItemIds.value = [...new Set([...selectedBatchItemIds.value, queued.id])];
    feedback.value = '';
    toast.success(t('products.view.feedback.addedToBatch', { title: queued.title }));
    workspace.value = 'batch-publisher';
    updateProductHash('push');
  } catch (error: unknown) {
    feedback.value = errorMessage(error);
  }
}

function submitBatchPublish(): void {
  const selected = batchItems.value.filter(
    (item) => selectedBatchItemIds.value.includes(item.id) && item.status === 'queued'
  );
  if (selected.length === 0) {
    feedback.value = t('products.view.errors.selectQueued');
    return;
  }
  const operation = batchTarget.value === 'draft' ? 'saveProductDraft' : 'publishProduct';
  if (!productOperations.isAllowed(operation)) {
    feedback.value = mutationDisabledReason(
      operation,
      batchTarget.value === 'draft'
        ? t('products.view.errors.draftWriteDisabled')
        : t('products.view.errors.publishDisabled')
    );
    return;
  }
  if (mode !== 'mock') {
    actionConfirmation.value = {
      kind: 'batch-publish',
      target: batchTarget.value,
      itemIds: selected.map((item) => item.id)
    };
    return;
  }
  batchPublish.mutate({ ids: selected.map((item) => item.id), target: batchTarget.value });
}

function stopBatchPublish(): void {
  stopBatchRequested.value = true;
  feedback.value = t('products.view.feedback.stopping');
}

function editBatchItem(item: ProductBatchPublishItem): void {
  cancelDraftSave();
  draftCandidate.value = null;
  resetEditorSession({ categoryId: item.categoryId, mode: 'quick' });
  schemaModel.value = parseProductSchemaXml(item.xml, undefined, locale.value);
  language.value = item.language;
  market.value = item.market;
  editingBatchItemId.value = item.id;
  currentCategory.value =
    categoryOptions.value.find((category) => String(category.id) === item.categoryId) ?? null;
  workspace.value = 'publisher';
  feedback.value = t('products.view.feedback.editingBatch', { title: item.title });
  updateProductHash('push');
}

function removeBatchItem(item: ProductBatchPublishItem): void {
  if (!('localStorage' in globalThis)) return;
  removeProductBatchPublishItem(globalThis.localStorage, item.id);
  reloadBatchItems();
  selectedBatchItemIds.value = selectedBatchItemIds.value.filter((itemId) => itemId !== item.id);
  batchResults.value = Object.fromEntries(
    Object.entries(batchResults.value).filter(([itemId]) => itemId !== item.id)
  );
  feedback.value = '';
  toast.success(t('products.view.feedback.removedBatch', { title: item.title }));
}

function reloadBatchItems(): void {
  if (!('localStorage' in globalThis)) return;
  batchItems.value = loadProductBatchPublishItems(globalThis.localStorage);
}

async function exportSelectedProducts(): Promise<void> {
  if (productTransferExportProducts.value.length === 0) {
    productTransferError.value = t('products.view.errors.exportSelect');
    return;
  }

  productTransferBusy.value = true;
  productTransferError.value = '';
  productTransferProgress.value = null;
  try {
    const transferItems = await loadProductTransferItems(productTransferExportProducts.value);
    if (productTransferFileFormat.value === 'zip') {
      await exportProductZip(transferItems);
    } else {
      const document = createProductTransferDocument(transferItems);
      downloadTextFile(
        `one-vegetable-products-${fileTimestamp(new Date())}.json`,
        serializeProductTransferDocument(document, { schemaFormat: productTransferSchemaFormat.value })
      );
    }
    feedback.value = '';
    toast.success(
      t('products.view.feedback.exported', {
        count: transferItems.length,
        fileFormat: productTransferFileFormat.value.toLocaleUpperCase(),
        schemaFormat: productTransferSchemaFormatLabel(productTransferSchemaFormat.value)
      })
    );
    productTransferDialogOpen.value = false;
  } catch (error: unknown) {
    productTransferError.value = errorMessage(error);
  } finally {
    productTransferBusy.value = false;
    productTransferProgress.value = null;
  }
}

async function loadProductTransferItems(
  productsToExport: readonly Product[]
): Promise<ProductTransferItemInput[]> {
  const transferItems: ProductTransferItemInput[] = [];
  for (const [index, product] of productsToExport.entries()) {
    productTransferProgress.value = {
      phase: 'reading',
      message: t('products.view.progress.readingSchema', {
        current: index + 1,
        total: productsToExport.length
      }),
      current: index,
      total: productsToExport.length
    };
    const schema =
      product.status === 'draft'
        ? await gateway.request('getProductDraft', {
            productId: product.id,
            language: language.value
          })
        : product.categoryId === null
          ? null
          : await gateway.request('renderProductSchema', {
              categoryId: product.categoryId,
              language: language.value,
              productId: product.id
            });
    if (!schema) throw new Error(t('products.view.errors.missingCategory', { id: product.id }));
    const schemaXml = resolveProductSchemaXml(schema);
    if (!schemaXml) throw new Error(t('products.view.errors.missingSchema', { id: product.id }));
    const exportedCategoryId =
      product.status === 'draft' && schema.categoryId > 0 ? schema.categoryId : product.categoryId;
    if (exportedCategoryId === null) {
      throw new Error(t('products.view.errors.missingCategory', { id: product.id }));
    }
    transferItems.push({
      source: {
        productId: product.id,
        subject: product.subject,
        groupName: product.groupName,
        status: product.status,
        updatedAt: product.updatedAt
      },
      categoryId: exportedCategoryId,
      language: language.value,
      market: 'market' in schema && schema.market === 'sourcing' ? 'sourcing' : market.value,
      schemaXml
    });
  }
  return transferItems;
}

async function exportProductZip(transferItems: readonly ProductTransferItemInput[]): Promise<void> {
  const models = transferItems.map((item) =>
    parseProductSchemaXml(item.schemaXml ?? '', undefined, locale.value)
  );
  const assetUrls = [
    ...new Set(
      models.flatMap((model) =>
        collectProductSchemaAssetReferences(model).map((reference) => reference.source)
      )
    )
  ];
  const replacements = new Map<string, { url: string; fileId: null }>();
  const assetsBySha = new Map<string, ProductTransferArchiveAsset>();
  for (const [index, url] of assetUrls.entries()) {
    productTransferProgress.value = {
      phase: 'downloading',
      message: t('products.view.progress.downloadingImages', {
        current: index + 1,
        total: assetUrls.length
      }),
      current: index,
      total: assetUrls.length
    };
    const result = await gateway.request('downloadProductAsset', { url });
    let asset = assetsBySha.get(result.sha256);
    if (!asset) {
      const path = productTransferArchiveAssetPath(result.fileName, result.contentType, result.sha256);
      asset = {
        path,
        fileName: path.slice(path.lastIndexOf('/') + 1),
        contentType: result.contentType,
        bytes: decodeBase64(result.contentBase64)
      };
      assetsBySha.set(result.sha256, asset);
    }
    replacements.set(url, { url: asset.path, fileId: null });
  }

  const archiveItems = models.map((model, index) => {
    const item = transferItems[index];
    if (!item) throw new Error(t('products.view.errors.exportChanged'));
    return {
      ...item,
      schemaXml: serializeProductSchemaXml(
        replaceProductSchemaAssetReferences(model, replacements),
        locale.value
      )
    };
  });
  const document = createProductTransferArchiveDocument(archiveItems, productTransferSchemaFormat.value);
  productTransferProgress.value = {
    phase: 'packing',
    message: t('products.view.progress.packing'),
    current: 0,
    total: 1
  };
  const archive = await createProductTransferArchive({ document, assets: [...assetsBySha.values()] });
  downloadBinaryFile(`one-vegetable-products-${fileTimestamp(new Date())}.zip`, archive, 'application/zip');
}

async function importProducts(selection: ProductTransferImportSelection): Promise<void> {
  if (!('localStorage' in globalThis)) {
    productTransferError.value = t('products.view.errors.localImportUnsupported');
    return;
  }

  productTransferBusy.value = true;
  productTransferError.value = '';
  productTransferProgress.value = null;
  try {
    const document =
      selection.kind === 'json' ? selection.document : await uploadProductTransferAssets(selection);
    productTransferProgress.value = {
      phase: 'queuing',
      message: t('products.view.progress.queuing'),
      current: 0,
      total: 1
    };
    const result = importProductBatchPublishItems(
      globalThis.localStorage,
      productTransferQueueInputs(document)
    );
    reloadBatchItems();
    selectedBatchItemIds.value = result.items.map((item) => item.id);
    feedback.value = '';
    toast.success(
      t('products.view.feedback.imported', {
        format: selection.kind.toLocaleUpperCase(),
        added: result.added,
        updated: result.updated,
        skipped: result.skipped
      })
    );
    productTransferDialogOpen.value = false;
    workspace.value = 'batch-publisher';
    updateProductHash('push');
  } catch (error: unknown) {
    productTransferError.value = errorMessage(error);
  } finally {
    productTransferBusy.value = false;
    productTransferProgress.value = null;
  }
}

async function uploadProductTransferAssets(
  selection: Extract<ProductTransferImportSelection, { kind: 'zip' }>
): Promise<ProductTransferDocumentV2> {
  const originalInputs = productTransferQueueInputs(selection.archive.document);
  inspectProductBatchPublishImport(globalThis.localStorage, originalInputs);

  const assetsByPath = new Map(selection.archive.assets.map((asset) => [asset.path, asset]));
  const replacements = new Map<
    string,
    {
      url: string;
      fileId: string;
      fileName: string;
      groupId: string;
      width: number | null;
      height: number | null;
      fileSize: number;
    }
  >();
  for (const [index, path] of selection.archive.referencedAssetPaths.entries()) {
    const asset = assetsByPath.get(path);
    if (!asset) throw new Error(t('products.view.errors.zipMissingImage', { path }));
    productTransferProgress.value = {
      phase: 'uploading',
      message: t('products.view.progress.uploading', {
        group: selection.targetGroupName,
        current: index + 1,
        total: selection.archive.referencedAssetPaths.length
      }),
      current: index,
      total: selection.archive.referencedAssetPaths.length
    };
    const photo = await gateway.request('uploadPhoto', {
      fileName: asset.fileName,
      contentBase64: encodeBase64(asset.bytes),
      contentType: asset.contentType,
      byteLength: asset.bytes.byteLength,
      groupId: selection.targetGroupId
    });
    replacements.set(path, {
      url: photo.url,
      fileId: photo.id,
      fileName: photo.name,
      groupId: photo.groupId,
      width: photo.width,
      height: photo.height,
      fileSize: photo.fileSize
    });
  }
  if (replacements.size > 0) await queryClient.invalidateQueries({ queryKey: ['photos'] });
  return {
    ...selection.archive.document,
    products: selection.archive.document.products.map((product) => {
      const schemaXml = serializeProductSchemaXml(
        replaceProductSchemaAssetReferences(
          parseProductSchemaXml(product.schemaXml, undefined, locale.value),
          replacements
        ),
        locale.value
      );
      return { ...product, schemaXml, schemaJson: productSchemaXmlToJson(schemaXml) };
    })
  };
}

function productTransferQueueInputs(document: ProductTransferDocumentV1 | ProductTransferDocumentV2) {
  return document.products.map((product) => ({
    id: productTransferQueueItemId(product),
    title: product.source.subject,
    categoryId: String(product.categoryId),
    language: product.language,
    market: product.market,
    xml: product.schemaXml
  }));
}

function openProductImportDialog(): void {
  productTransferError.value = '';
  productTransferProgress.value = null;
  productTransferDialogMode.value = 'import';
  productTransferExportProducts.value = [];
  productTransferDialogOpen.value = true;
}

function openProductExportDialog(): void {
  if (selectedProducts.value.length === 0) return;
  productTransferError.value = '';
  productTransferProgress.value = null;
  productTransferDialogMode.value = 'export';
  productTransferExportProducts.value = selectedProducts.value.map((product) => ({ ...product }));
  productTransferDialogOpen.value = true;
}

function downloadTextFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBinaryFile(fileName: string, content: Uint8Array, contentType: string): void {
  const bytes = content.slice().buffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replaceAll(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z')
    .replace('T', '-');
}

function productTransferSchemaFormatLabel(format: ProductTransferSchemaFormat): string {
  if (format === 'json') return 'Schema JSON';
  return 'Schema XML';
}

function submitBatchDisplay(display: 'online' | 'offline'): void {
  if (mode !== 'mock') {
    actionConfirmation.value = {
      kind: 'batch-display',
      display,
      productIds: [...selectedProductIds.value]
    };
    return;
  }
  batchDisplay.mutate(display);
}

function recoverDisplayJob(job: ProductMutationJob): void {
  if (mode !== 'mock') {
    actionConfirmation.value = { kind: 'recover-display', job };
    return;
  }
  recoverDisplayMutation.mutate(job);
}

function confirmProductAction(): void {
  const action = actionConfirmation.value;
  actionConfirmation.value = null;
  if (!action) return;
  if (action.kind === 'product') {
    publish.mutate(action.draft);
    return;
  }
  if (action.kind === 'batch-publish') {
    batchPublish.mutate({ ids: action.itemIds, target: action.target });
    return;
  }
  if (action.kind === 'batch-display') {
    batchDisplay.mutate(action.display);
    return;
  }
  recoverDisplayMutation.mutate(action.job);
}

function statusVariant(status: Product['status']): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'online') return 'success';
  if (status === 'auditing') return 'warning';
  if (status === 'rejected') return 'destructive';
  return 'secondary';
}

function toggleProduct(productId: string, checked: boolean): void {
  selectedProductIds.value = checked
    ? [...new Set([...selectedProductIds.value, productId])]
    : selectedProductIds.value.filter((id) => id !== productId);
}

function toggleCurrentPageProducts(checked: boolean): void {
  selectedProductIds.value = checked ? currentPageProductIds.value : [];
}

function clearProductSelection(): void {
  selectedProductIds.value = [];
}

function selectProductGroup(group: ProductGroup | null, depth: 0 | 1 | 2 | 3): void {
  selectedProductGroupId.value = group?.id ?? null;
  selectedProductGroupLevel.value = depth === 0 ? undefined : depth;
  productPage.value = 1;
  clearProductSelection();
}

function handleProductGroupChanged(): void {
  productGroupNavigationRevision.value += 1;
}

function setProductPage(page: number): void {
  if (page === productPage.value) return;
  productPage.value = page;
  clearProductSelection();
}

function setProductPageSize(pageSize: number): void {
  if (pageSize === productPageSize.value) return;
  productPageSize.value = pageSize;
  clearProductSelection();
}

function productSelectionHeader() {
  const count = currentPageProducts.value.length;
  return h(TriStateCheckbox, {
    checked: allCurrentPageProductsSelected.value,
    indeterminate: someCurrentPageProductsSelected.value,
    disabled: count === 0,
    label: allCurrentPageProductsSelected.value
      ? t('products.view.selection.deselectPage', { count })
      : t('products.view.selection.selectPage', { count }),
    title: t(
      allCurrentPageProductsSelected.value
        ? 'products.view.selection.deselectPageTitle'
        : 'products.view.selection.selectPageTitle'
    ),
    'onUpdate:checked': toggleCurrentPageProducts
  });
}

function productSelectionCell(product: Product) {
  return h(TriStateCheckbox, {
    checked: selectedProductIds.value.includes(product.id),
    label: t('products.view.selection.selectProduct', { title: product.subject }),
    'onUpdate:checked': (checked: boolean) => {
      toggleProduct(product.id, checked);
    }
  });
}

const columns = computed<DataColumn<Product>[]>(() => [
  {
    id: 'select',
    header: productSelectionHeader,
    cell: ({ row }) => productSelectionCell(row.original),
    meta: { sticky: 'left', stickyOffset: '0px', width: '56px' }
  },
  {
    id: 'image',
    header: t('products.view.columns.image'),
    cell: ({ row }) =>
      row.original.imageUrl
        ? h(
            'button',
            {
              type: 'button',
              class:
                'group relative block size-14 cursor-zoom-in overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'aria-label': t('products.view.previewMain', { title: row.original.subject }),
              onClick: () => {
                openProductImagePreview(row.original);
              }
            },
            h('img', {
              src: row.original.imageUrl,
              alt: t('products.view.mainImage', { title: row.original.subject }),
              class: 'size-full object-cover transition-transform duration-200 group-hover:scale-105',
              loading: 'lazy',
              referrerpolicy: 'no-referrer'
            })
          )
        : h(
            'span',
            {
              class:
                'flex size-14 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground'
            },
            t('products.view.none')
          ),
    meta: { sticky: 'left', stickyOffset: '56px', stickyBoundary: true, width: '96px' }
  },
  {
    accessorKey: 'subject',
    header: t('products.view.columns.product'),
    cell: ({ row }) =>
      h('div', { class: 'min-w-56 space-y-1' }, [
        h('p', { class: 'font-medium' }, row.original.subject),
        h('p', { class: 'font-mono text-xs text-muted-foreground' }, row.original.id)
      ])
  },
  {
    accessorKey: 'groupName',
    header: t('products.view.columns.group'),
    cell: (context) => h('span', { class: 'block min-w-20' }, context.getValue<string>() || '—')
  },
  {
    accessorKey: 'status',
    header: t('products.view.columns.status'),
    cell: (context) =>
      h(
        Badge,
        {
          variant: statusVariant(context.getValue<Product['status']>()),
          class: 'whitespace-nowrap'
        },
        () => productStatusLabel(context.getValue<Product['status']>())
      )
  },
  {
    id: 'productScore',
    header: t('products.view.columns.productScore'),
    cell: ({ row }) => {
      const score = scoreForProduct(row.original);
      const error = scoreErrorForProduct(row.original);
      return h('div', { class: 'min-w-24 space-y-0.5' }, [
        h(
          'span',
          { class: 'font-medium tabular-nums' },
          score
            ? `${formatProductScore(score.score)}/${PRODUCT_SCORE_DISPLAY_MAX}`
            : t('products.view.scoreNotQueried')
        ),
        score?.issues.length
          ? h(
              'p',
              { class: 'text-xs text-amber-700 dark:text-amber-400' },
              t('products.view.scoreSuggestions', { count: score.issues.length })
            )
          : null,
        error
          ? h('p', { class: 'text-xs text-destructive', title: error }, t('products.view.scoreFailed'))
          : null
      ]);
    }
  },
  {
    accessorKey: 'score',
    header: t('products.view.columns.qualityScore'),
    cell: (context) => {
      const score = context.getValue<number>();
      return score > 0 ? `${score}/100` : '—';
    }
  },
  {
    accessorKey: 'updatedAt',
    header: t('products.view.columns.updatedAt'),
    cell: (context) =>
      h('span', { class: 'whitespace-nowrap tabular-nums' }, formatDateTime(context.getValue<string>()))
  },
  {
    id: 'actions',
    header: t('products.view.columns.actions'),
    cell: ({ row }) =>
      h('div', { class: 'flex items-center' }, [
        h(
          Button,
          {
            size: 'sm',
            variant: 'outline',
            onClick: () => {
              void selectProductForSchema(row.original);
            }
          },
          () => t('products.view.edit')
        )
      ]),
    meta: { sticky: 'right', stickyOffset: '0px', stickyBoundary: true, width: '120px' }
  }
]);

function scoreForProduct(product: Product): ProductScore | undefined {
  return product.encryptedId ? productScores.value[product.encryptedId] : undefined;
}

function scoreErrorForProduct(product: Product): string | undefined {
  return product.encryptedId ? productScoreErrors.value[product.encryptedId] : undefined;
}

async function querySelectedProductScores(): Promise<void> {
  const targets = selectedProducts.value.filter((product): product is Product & { encryptedId: string } =>
    Boolean(product.encryptedId)
  );
  if (targets.length === 0) {
    feedback.value = t('products.view.errors.scoreMissingId');
    return;
  }
  queryingSelectedProductScores.value = true;
  let succeeded = 0;
  let failed = 0;
  try {
    for (const product of targets) {
      try {
        await productScore.mutateAsync(product.encryptedId);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
  } finally {
    queryingSelectedProductScores.value = false;
  }
  const skipped = selectedProducts.value.length - targets.length;
  const message = t('products.view.feedback.scoreDone', {
    succeeded,
    failed,
    skipped: skipped > 0 ? t('products.view.feedback.scoreSkipped', { count: skipped }) : ''
  });
  if (failed > 0 || skipped > 0) toast.warning(message);
  else toast.success(message);
}

function formatProductScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function openProductImagePreview(product: Product): void {
  if (!product.imageUrl) return;
  productPreviewImages.value = [
    {
      id: product.id,
      src: product.imageUrl,
      alt: t('products.view.mainImage', { title: product.subject }),
      description: t('products.view.previewDescription', { id: product.id })
    }
  ];
  productPreviewOpen.value = true;
}

function flattenCategories(items: ProductCategory[], depth = 0): (ProductCategory & { depth: number })[] {
  return items.flatMap((item) => [{ ...item, depth }, ...flattenCategories(item.children, depth + 1)]);
}

function findCategory(items: ProductCategory[], categoryIdToFind: number): ProductCategory | null {
  for (const item of items) {
    if (item.id === categoryIdToFind) return item;
    const child = findCategory(item.children, categoryIdToFind);
    if (child) return child;
  }
  return null;
}

function mergeCategoryRoots(current: ProductCategory[], incoming: ProductCategory[]): ProductCategory[] {
  return incoming.map((category) => {
    const existing = findCategory(current, category.id);
    return existing && existing.children.length > 0 ? { ...category, children: existing.children } : category;
  });
}

function replaceCategoryNode(items: ProductCategory[], replacement: ProductCategory): ProductCategory[] {
  return items.map((item) => {
    if (item.id === replacement.id) return replacement;
    return { ...item, children: replaceCategoryNode(item.children, replacement) };
  });
}

async function loadCategoryBranch(categoryIdToLoad: number): Promise<ProductCategory | null> {
  categoryLoadingId.value = categoryIdToLoad;
  categoryLoadError.value = '';
  try {
    const result = await gateway.request('listProductCategories', {
      parentId: categoryIdToLoad
    });
    const parent = result.find((category) => category.id === categoryIdToLoad) ?? null;
    if (!parent) throw new Error(t('products.view.errors.categoryMissing', { id: categoryIdToLoad }));
    categoryTree.value = replaceCategoryNode(categoryTree.value, parent);
    if (categoryId.value === String(parent.id)) currentCategory.value = parent;
    return parent;
  } catch (error: unknown) {
    categoryLoadError.value = errorMessage(error);
    return null;
  } finally {
    categoryLoadingId.value = null;
  }
}

async function selectCategory(categoryIdToSelect: number): Promise<void> {
  const category = findCategory(categoryTree.value, categoryIdToSelect);
  currentCategory.value = category;
  schemaModel.value = null;
  schemaError.value = '';
  if (category?.leaf) {
    feedback.value = t('products.view.feedback.leafSelected', { name: category.name });
    return;
  }
  if (category && category.children.length > 0) {
    feedback.value = t('products.view.feedback.chooseUnder', { name: category.name });
    return;
  }
  const loaded = await loadCategoryBranch(categoryIdToSelect);
  if (!loaded) return;
  feedback.value = loaded.leaf
    ? t('products.view.feedback.leafSelected', { name: loaded.name })
    : t('products.view.feedback.childrenLoaded', {
        name: loaded.name,
        count: loaded.children.length
      });
}

async function ensureCurrentCategory(categoryIdToLoad: number): Promise<void> {
  let existing = findCategory(categoryTree.value, categoryIdToLoad);
  if (existing) {
    currentCategory.value = existing;
    return;
  }
  const roots = await categories.refetch();
  if (roots.data) {
    categoryTree.value = mergeCategoryRoots(categoryTree.value, roots.data);
    existing = findCategory(categoryTree.value, categoryIdToLoad);
    if (existing) {
      currentCategory.value = existing;
      categoryLoadError.value = '';
      return;
    }
  }
  const loaded = await loadCategoryBranch(categoryIdToLoad);
  if (loaded) currentCategory.value = loaded;
}

async function retryCategories(): Promise<void> {
  const parsed = Number(categoryId.value);
  if (Number.isSafeInteger(parsed) && parsed > 0 && selectedCategory.value?.leaf === false) {
    await selectCategory(parsed);
    return;
  }
  categoryLoadError.value = '';
  await categories.refetch();
}

async function selectProductForSchema(product: Product): Promise<void> {
  cancelDraftSave();
  draftCandidate.value = null;
  acknowledgedMutationJobId.value = '';
  resetEditorSession({
    productId: product.id,
    ...(product.categoryId !== null ? { categoryId: String(product.categoryId) } : {}),
    mode: 'guided'
  });
  editScoreProductId.value = product.encryptedId ?? '';
  schemaError.value = '';
  feedback.value =
    product.categoryId === null
      ? t('products.view.feedback.productWithoutCategory')
      : t('products.view.feedback.productSelected');
  workspace.value = 'publisher';
  updateProductHash('push');
  if (product.categoryId !== null) {
    await Promise.all([ensureCurrentCategory(product.categoryId), loadSchema()]);
  }
}

function startNewProduct(): void {
  const migratedDraft = migratedDraftKey.value ? draftCandidate.value : null;
  cancelDraftSave();
  draftCandidate.value = migratedDraft;
  acknowledgedMutationJobId.value = '';
  editingBatchItemId.value = '';
  resetEditorSession({ categoryId: migratedDraft?.categoryId ?? '', mode: 'quick' });
  editScoreProductId.value = '';
  currentCategory.value = null;
  categorySearch.value = '';
  categoryLoadError.value = '';
  schemaError.value = '';
  feedback.value = t('products.view.feedback.chooseCategory');
  workspace.value = 'publisher';
  updateProductHash('push');
  if (!migratedDraft) offerCurrentDraft();
}

function setWorkspace(nextWorkspace: Workspace): void {
  if (nextWorkspace === 'batch-publisher') reloadBatchItems();
  workspace.value = nextWorkspace;
  updateProductHash('push');
}

function setEditorMode(nextMode: ProductEditorMode): void {
  editorMode.value = nextMode;
  updateProductHash('push');
}

function setEditorStep(nextStep: ProductEditorStepId): void {
  editorStep.value = nextStep;
  updateProductHash('push');
}

function updateProductHash(historyMode: 'push' | 'replace'): void {
  if (applyingProductRoute) return;
  const segments: string[] = [workspace.value];
  if (workspace.value === 'publisher') {
    segments.push(editorMode.value, editorStep.value, editProductId.value || 'new');
    if (categoryId.value) segments.push(categoryId.value);
  }
  const nextHash = appHash('products', ...segments);
  if (globalThis.location.hash === nextHash) return;
  globalThis.history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', nextHash);
}

async function syncProductsFromHash(): Promise<boolean> {
  const route = parseAppHash(globalThis.location.hash);
  if (route?.page !== 'products' || route.segments.length === 0) return false;
  const requestedWorkspace = route.segments[0];
  const nextWorkspace =
    requestedWorkspace && workspaceIds.has(requestedWorkspace as Workspace)
      ? (requestedWorkspace as Workspace)
      : 'list';
  const shouldCanonicalizeWorkspace = requestedWorkspace !== nextWorkspace;
  applyingProductRoute = true;
  try {
    workspace.value = nextWorkspace;
    if (nextWorkspace !== 'publisher') return true;

    const requestedMode = route.segments[1];
    const nextMode =
      requestedMode && editorModes.has(requestedMode as ProductEditorMode)
        ? (requestedMode as ProductEditorMode)
        : 'quick';
    const requestedStep = route.segments[2];
    const nextStep =
      requestedStep && editorStepIds.has(requestedStep as ProductEditorStepId)
        ? (requestedStep as ProductEditorStepId)
        : 'basics';
    const nextProductId = route.segments[3] === 'new' ? '' : (route.segments[3] ?? '');
    const nextCategoryId = route.segments[4] ?? '';
    const needsSchemaReload =
      nextCategoryId !== '' &&
      (editProductId.value !== nextProductId ||
        categoryId.value !== nextCategoryId ||
        schemaModel.value === null);

    if (needsSchemaReload) {
      cancelDraftSave();
      draftCandidate.value = null;
      acknowledgedMutationJobId.value = '';
      resetEditorSession({ productId: nextProductId, categoryId: nextCategoryId, mode: nextMode });
      editScoreProductId.value = '';
      currentCategory.value = null;
      const numericCategoryId = Number(nextCategoryId);
      if (Number.isSafeInteger(numericCategoryId) && numericCategoryId > 0) {
        await ensureCurrentCategory(numericCategoryId);
        await loadSchema();
      }
    }
    editorMode.value = nextMode;
    editorStep.value = nextStep;
    return true;
  } finally {
    applyingProductRoute = false;
    if (shouldCanonicalizeWorkspace) updateProductHash('replace');
  }
}

function handleProductRouteChange(): void {
  void syncProductsFromHash();
}

function applySchema(xml: string, message: string, offerLocalDraft = true): void {
  try {
    schemaModel.value = parseProductSchemaXml(xml, undefined, locale.value);
    sourceIsLocalDraft.value = false;
    schemaError.value = '';
    feedback.value = message;
    editorStep.value = 'basics';
    updateProductHash('replace');
    if (offerLocalDraft) offerCurrentDraft();
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : t('products.view.errors.schemaParse');
  }
}

async function loadSchema(): Promise<void> {
  schemaError.value = '';
  const parsedCategoryId = resolveCategoryId();
  if (parsedCategoryId === null) {
    if (!schemaError.value) schemaError.value = t('products.view.errors.categoryInvalid');
    return;
  }
  try {
    const result = editProductId.value
      ? await renderExistingProductSchema(parsedCategoryId)
      : await gateway.request('getProductSchema', {
          categoryId: parsedCategoryId,
          language: language.value,
          market: market.value
        });
    applySchema(
      result.xml,
      t(
        editProductId.value
          ? 'products.view.feedback.existingSchema'
          : 'products.view.feedback.categorySchema'
      )
    );
    if (editScoreProductId.value) productScore.mutate(editScoreProductId.value);
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : t('products.view.errors.schemaFetch');
  }
}

function resolveCategoryId(): number | null {
  const parsed = Number(categoryId.value);
  if (!categoryId.value || !Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (!editProductId.value && selectedCategory.value?.leaf !== true) {
    schemaError.value = t('products.view.errors.chooseLeaf');
    return null;
  }
  return parsed;
}

async function renderExistingProductSchema(parsedCategoryId: number) {
  const request = {
    categoryId: parsedCategoryId,
    language: language.value,
    productId: editProductId.value
  };
  const validation = validateProductSchemaRenderInput(request);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  const result = await gateway.request('renderProductSchema', request);
  if (productMutationJobs) {
    const history = await productMutationJobs.list({ productId: editProductId.value, pageSize: 20 });
    acknowledgedMutationJobId.value =
      history.items.find((job) => job.operation === 'updateProduct')?.id ?? '';
    queryClient.setQueryData(['product-mutation-jobs', editProductId.value], history);
  }
  return result;
}

async function loadDraft(): Promise<void> {
  if (!editProductId.value) {
    schemaError.value = t('products.view.errors.draftId');
    return;
  }
  try {
    const result = await gateway.request('getProductDraft', {
      productId: editProductId.value,
      language: language.value
    });
    categoryId.value = String(result.categoryId);
    applySchema(result.schemaXml, t('products.view.feedback.draftSchema', { id: result.id }));
    editScoreProductId.value = result.encryptedId ?? '';
    if (editScoreProductId.value) productScore.mutate(editScoreProductId.value);
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : t('products.view.errors.draftRender');
  }
}

async function refreshLevelSchema(): Promise<void> {
  if (!schemaModel.value) return;
  try {
    const result = await gateway.request('getProductLevelSchema', {
      categoryId: Number(categoryId.value),
      language: language.value,
      xml: guardedSchemaXml(schemaModel.value)
    });
    applySchema(result.xml, t('products.view.feedback.levelRefreshed'), false);
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : t('products.view.errors.levelRefresh');
  }
}

function updateImageStatus(status: ProductDescriptionImageMetadata & { url: string }): void {
  imageMetadata.value = {
    ...imageMetadata.value,
    [status.url]: { loaded: status.loaded, width: status.width, height: status.height }
  };
}

function offerCurrentDraft(): void {
  if (!('localStorage' in globalThis) || !categoryId.value) return;
  draftCandidate.value = findProductEditorDraft(
    globalThis.localStorage,
    editProductId.value,
    categoryId.value
  );
}

function resumeLocalDraft(): void {
  const draft = draftCandidate.value;
  if (!draft) return;
  try {
    schemaModel.value = parseProductSchemaXml(draft.xml, undefined, locale.value);
    sourceIsLocalDraft.value = true;
    categoryId.value = draft.categoryId;
    language.value = draft.language;
    market.value = draft.market;
    editorMode.value = draft.mode;
    editorStep.value = draft.step;
    platformDraftId.value = draft.platformDraftId;
    draftCandidate.value = null;
    migratedDraftKey.value = null;
    draftSaveStatus.value = 'saved';
    feedback.value = t('products.view.feedback.localDraftResumed');
    updateProductHash('replace');
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : t('products.view.errors.localDraftParse');
  }
}

async function reloadPlatformData(): Promise<void> {
  const draft = draftCandidate.value;
  if (!draft || !('localStorage' in globalThis)) return;
  removeProductEditorDraft(globalThis.localStorage, draft.draftKey);
  draftCandidate.value = null;
  migratedDraftKey.value = null;
  draftSaveStatus.value = 'idle';
  if (draft.platformDraftId) {
    editProductId.value = draft.platformDraftId;
    await loadDraft();
    editProductId.value = '';
    platformDraftId.value = draft.platformDraftId;
    return;
  }
  await loadSchema();
}

function scheduleDraftSave(): void {
  cancelDraftSave();
  if (!schemaModel.value || !categoryId.value || draftCandidate.value) return;
  draftSaveStatus.value = 'saving';
  draftSaveTimer = globalThis.setTimeout(() => {
    draftSaveTimer = undefined;
    saveCurrentLocalDraft();
  }, 750);
}

function reconcileDraftAfterFieldChange(): void {
  const inspection = schemaInspection.value;
  cancelDraftSave();
  if (!inspection.safe) {
    draftSaveStatus.value = 'idle';
    return;
  }
  if (!shouldPersistProductEditorDraft(inspection)) {
    if (sourceIsLocalDraft.value) {
      draftSaveStatus.value = 'saved';
      return;
    }
    removeCurrentLocalDraft();
    draftSaveStatus.value = 'idle';
    return;
  }
  scheduleDraftSave();
}

function saveCurrentLocalDraft(): void {
  if (!schemaModel.value || !schemaPreview.value || !categoryId.value || !('localStorage' in globalThis))
    return;
  try {
    saveProductEditorDraft(globalThis.localStorage, {
      productId: editProductId.value || null,
      categoryId: categoryId.value,
      language: language.value,
      market: market.value,
      xml: schemaPreview.value,
      mode: editorMode.value,
      step: editorStep.value,
      platformDraftId: platformDraftId.value
    });
    draftSaveStatus.value = 'saved';
  } catch {
    draftSaveStatus.value = 'error';
  }
}

function clearCurrentLocalDraft(): void {
  cancelDraftSave();
  if (!('localStorage' in globalThis) || !categoryId.value) return;
  removeProductEditorDraft(
    globalThis.localStorage,
    productEditorDraftKey(editProductId.value, categoryId.value)
  );
  draftCandidate.value = null;
  draftSaveStatus.value = 'idle';
}

function removeCurrentLocalDraft(): void {
  if (!('localStorage' in globalThis) || !categoryId.value) return;
  removeProductEditorDraft(
    globalThis.localStorage,
    productEditorDraftKey(editProductId.value, categoryId.value)
  );
}

function cancelDraftSave(): void {
  if (draftSaveTimer === undefined) return;
  globalThis.clearTimeout(draftSaveTimer);
  draftSaveTimer = undefined;
}

function draftSaveLabel(status: DraftSaveStatus): string {
  if (status === 'saving') return t('products.view.draftSave.saving');
  if (status === 'saved') return t('products.view.draftSave.saved');
  if (status === 'error') return t('products.view.draftSave.error');
  return '';
}

function scheduleScoreRefresh(productId: string): void {
  if (scoreRefreshTimer !== undefined) globalThis.clearTimeout(scoreRefreshTimer);
  scoreRefreshTimer = globalThis.setTimeout(() => {
    productScore.mutate(productId);
    scoreRefreshTimer = undefined;
  }, 5000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t('products.view.errors.generic');
}

function mutationDisabledReason(operation: OperationId, fallback: string): string {
  return operationAvailabilityMessage(productOperations.reasonCode(operation), fallback);
}

function productMutationDisabledReason(job: ProductMutationJob | null): string {
  if (!job) return t('products.view.mutationBlocked.loading');
  if (job.status === 'submitted' || job.status === 'auditing') {
    return t('products.view.mutationBlocked.auditing');
  }
  if (job.status === 'verifying') return t('products.view.mutationBlocked.verifying');
  if (job.status === 'recovering') return t('products.view.mutationBlocked.recovering');
  if (job.status === 'recovery-required') {
    return t('products.view.mutationBlocked.recoveryRequired');
  }
  return t('products.view.mutationBlocked.verified');
}

function productMutationStatusLabel(status: ProductMutationJob['status']): string {
  if (status === 'submitted') return t('products.view.mutationStatus.submitted');
  if (status === 'auditing') return t('products.view.mutationStatus.auditing');
  if (status === 'verifying') return t('products.view.mutationStatus.verifying');
  if (status === 'verified') return t('products.view.mutationStatus.verified');
  if (status === 'recovery-required') return t('products.view.mutationStatus.recoveryRequired');
  if (status === 'recovering') return t('products.view.mutationStatus.recovering');
  if (status === 'recovered') return t('products.view.mutationStatus.recovered');
  return t('products.view.mutationStatus.failed');
}

function productMutationMessage(job: ProductMutationJob): string {
  if (job.reasonCode) {
    const reasonKey = `products.view.mutationReason.${job.reasonCode}`;
    if (hasUiTranslation(reasonKey)) {
      const display = job.targetDisplay ?? job.originalDisplay;
      return t(reasonKey, {
        productId: job.productId,
        display: display
          ? t(display === 'online' ? 'products.view.feedback.online' : 'products.view.feedback.offline')
          : ''
      });
    }
    const errorKey = `errors.codes.${job.reasonCode}`;
    if (hasUiTranslation(errorKey)) return t(errorKey);
  }
  return job.message ?? t('products.view.page.awaitingCheck');
}

function productMutationStatusVariant(
  status: ProductMutationJob['status']
): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'verified' || status === 'recovered') return 'success';
  if (status === 'submitted' || status === 'auditing' || status === 'verifying' || status === 'recovering') {
    return 'warning';
  }
  return 'destructive';
}

function formatMutationTime(value: number | null): string {
  return formatDateTime(value, t('products.view.neverChecked'));
}

function guardedSchemaXml(model: ProductSchemaModel): string {
  const inspection = inspectProductSchemaSerialization(model, locale.value);
  if (!inspection.safe) {
    throw new Error(
      t('products.view.errors.schemaInvalid', { details: inspection.structuralDiffs.join('; ') })
    );
  }
  return inspection.xml;
}

watch([categoryId, editProductId], () => {
  if (!schemaModel.value) offerCurrentDraft();
  if (workspace.value === 'publisher') updateProductHash('replace');
});

watch([subject, language], () => {
  productPage.value = 1;
  clearProductSelection();
});

watch(currentPageProductIds, (productIds) => {
  selectedProductIds.value = retainCurrentPageSelection(selectedProductIds.value, productIds);
});

watch(
  () => categories.data.value,
  (items) => {
    if (items) categoryTree.value = mergeCategoryRoots(categoryTree.value, items);
  },
  { immediate: true }
);

onMounted(async () => {
  globalThis.addEventListener('hashchange', handleProductRouteChange);
  globalThis.addEventListener('popstate', handleProductRouteChange);
  reloadBatchItems();
  if (await syncProductsFromHash()) return;
  if (!('localStorage' in globalThis)) return;
  const migratedV2 = migrateProductEditorDraftsV2(globalThis.localStorage);
  if (migratedV2[0]) {
    migratedDraftKey.value = migratedV2[0].draftKey;
    categoryId.value = migratedV2[0].categoryId;
    draftCandidate.value = migratedV2[0];
    return;
  }
  const migrated = migrateLegacyProductEditorDraft(globalThis.localStorage);
  if (migrated) {
    migratedDraftKey.value = migrated.draftKey;
    categoryId.value = migrated.categoryId;
    draftCandidate.value = migrated;
  } else {
    offerCurrentDraft();
  }
});

onBeforeUnmount(() => {
  globalThis.removeEventListener('hashchange', handleProductRouteChange);
  globalThis.removeEventListener('popstate', handleProductRouteChange);
  cancelDraftSave();
  if (scoreRefreshTimer !== undefined) globalThis.clearTimeout(scoreRefreshTimer);
});
</script>

<template>
  <PageHeader :title="t('products.view.page.title')" :description="t('products.view.page.description')" />

  <div class="mb-5 flex flex-wrap gap-2" role="tablist" :aria-label="t('products.view.page.workspace')">
    <Button
      v-for="item in [
        ['list', t('products.view.page.list')],
        ['batch-publisher', t('products.view.page.batch')]
      ] as const"
      :key="item[0]"
      :variant="workspace === item[0] ? 'default' : 'outline'"
      role="tab"
      :aria-selected="workspace === item[0]"
      @click="setWorkspace(item[0])"
      >{{ item[1] }}</Button
    >
  </div>

  <p v-if="feedback" class="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
    {{ feedback }}
  </p>
  <template v-if="workspace === 'list'">
    <div
      class="grid gap-5 transition-[grid-template-columns] duration-200"
      :class="
        productGroupSidebarCollapsed
          ? 'lg:grid-cols-[3.25rem_minmax(0,1fr)]'
          : 'lg:grid-cols-[270px_minmax(0,1fr)]'
      "
    >
      <GroupSidebar v-model:collapsed="productGroupSidebarCollapsed" :title="t('products.view.page.groups')">
        <ProductGroupNavigation
          :key="productGroupNavigationRevision"
          v-model="selectedProductGroupId"
          @select="selectProductGroup"
        />
      </GroupSidebar>

      <section class="min-w-0">
        <div
          class="mb-4 flex flex-wrap items-center justify-between gap-3"
          role="toolbar"
          :aria-label="t('products.view.page.toolbar')"
        >
          <div class="relative min-w-64 max-w-md flex-1">
            <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input v-model="subject" class="pl-9" :placeholder="t('products.view.page.search')" />
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <span
              v-if="selectedProducts.length > MAX_PRODUCT_TRANSFER_ITEMS"
              class="text-xs text-amber-700 dark:text-amber-400"
              role="status"
            >
              {{ t('products.view.page.exportLimit', { maximum: MAX_PRODUCT_TRANSFER_ITEMS }) }}
            </span>
            <Button
              variant="outline"
              :disabled="products.isFetching.value"
              :aria-label="t('products.view.page.refreshLabel')"
              @click="products.refetch()"
            >
              <RefreshCw class="size-4" :class="{ 'animate-spin': products.isFetching.value }" />
              {{
                products.isFetching.value ? t('products.view.page.refreshing') : t('common.actions.refresh')
              }}
            </Button>
            <Button variant="outline" :disabled="productTransferBusy" @click="openProductImportDialog">
              <Upload class="size-4" />{{ t('products.view.page.import') }}
            </Button>
            <ActionTooltip
              :disabled="Boolean(productExportDisabledReason)"
              :reason="productExportDisabledReason"
            >
              <Button
                variant="outline"
                :disabled="Boolean(productExportDisabledReason)"
                @click="openProductExportDialog"
              >
                <Download class="size-4" />{{ t('products.view.page.export') }}
              </Button>
            </ActionTooltip>
            <Button variant="outline" @click="productGroupDialogOpen = true">
              <Layers3 class="size-4" aria-hidden="true" />{{ t('products.view.page.group') }}
            </Button>
            <ActionTooltip :disabled="Boolean(moreActionsDisabledReason)" :reason="moreActionsDisabledReason">
              <span class="inline-flex">
                <DropdownMenuRoot :modal="false">
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" :disabled="selectedProducts.length === 0">
                      <Ellipsis class="size-4" />{{ t('products.view.page.more')
                      }}<ChevronDown class="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent
                      class="ov-dropdown-content z-[65] min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
                      :side-offset="6"
                      align="end"
                    >
                      <DropdownMenuItem
                        class="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                        :disabled="queryingSelectedProductScores"
                        @select="querySelectedProductScores"
                      >
                        {{
                          queryingSelectedProductScores
                            ? t('products.view.page.batchScorePending')
                            : t('products.view.page.batchScore')
                        }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator class="my-1 h-px bg-border" />
                      <DropdownMenuItem
                        class="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                        :disabled="
                          productDisplayMutationDisabled ||
                          selectedProductMissingEncryptedId ||
                          selectedDisplayMutationBlocked ||
                          batchDisplay.isPending.value
                        "
                        @select="submitBatchDisplay('online')"
                      >
                        {{ t('products.view.page.batchOnline') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                        :disabled="
                          productDisplayMutationDisabled ||
                          selectedProductMissingEncryptedId ||
                          selectedDisplayMutationBlocked ||
                          batchDisplay.isPending.value
                        "
                        @select="submitBatchDisplay('offline')"
                      >
                        {{ t('products.view.page.batchOffline') }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
              </span>
            </ActionTooltip>
            <Button @click="startNewProduct"
              ><ListPlus class="size-4" aria-hidden="true" />{{ t('products.view.page.add') }}</Button
            >
          </div>
        </div>
        <p
          v-if="selectedProductIds.length && productDisplayMutationDisabled"
          class="mb-3 text-xs text-amber-700 dark:text-amber-400"
        >
          {{ t('products.view.page.displayDisabled') }}
        </p>
        <p v-else-if="selectedProductMissingEncryptedId" class="mb-3 text-xs text-destructive">
          {{ t('products.view.page.missingEncryptedId') }}
        </p>
        <p v-else-if="selectedDisplayMutationBlocked" class="mb-3 text-xs text-amber-700 dark:text-amber-400">
          {{ t('products.view.page.displayBlocked') }}
        </p>
        <ErrorNotice v-if="batchDisplay.error.value" class="mb-3" :error="batchDisplay.error.value" compact />
        <QueryState
          :loading="products.isPending.value"
          :error="products.error.value"
          retryable
          @retry="products.refetch()"
        >
          <DataTable
            :columns="columns"
            :data="products.data.value?.items ?? []"
            :page="productPage"
            :page-size="productPageSize"
            :total-rows="products.data.value?.total ?? 0"
            :pagination-disabled="products.isFetching.value"
            :empty-text="t('products.view.page.noMatch')"
            min-width="1320px"
            @update:page="setProductPage"
            @update:page-size="setProductPageSize"
          >
            <template #empty>
              <div class="space-y-3 py-4">
                <p>{{ t('products.view.page.noMatch') }}</p>
                <Button v-if="subject" variant="outline" size="sm" @click="subject = ''">
                  {{ t('products.view.page.clearSearch') }}
                </Button>
                <Button v-else size="sm" @click="startNewProduct">{{
                  t('products.view.page.addProduct')
                }}</Button>
              </div>
            </template>
            <template #pagination-summary>
              <span
                class="border-l border-border pl-2 text-xs font-medium text-foreground"
                data-testid="product-selection-count"
                aria-live="polite"
              >
                {{ t('products.view.selection.selectedCount', { count: selectedProducts.length }) }}
              </span>
            </template>
          </DataTable>
        </QueryState>
        <Card v-if="latestDisplayMutationJobs.length" class="mt-5 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold">{{ t('products.view.page.recentDisplayJobs') }}</h2>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ t('products.view.page.recentDisplayDescription') }}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              :disabled="displayMutationHistory.isFetching.value"
              @click="displayMutationHistory.refetch()"
            >
              <RefreshCw class="size-4" />
              {{
                displayMutationHistory.isFetching.value
                  ? t('products.view.page.checking')
                  : t('products.view.page.refreshAll')
              }}
            </Button>
          </div>
          <div class="mt-4 space-y-3">
            <div
              v-for="job in latestDisplayMutationJobs"
              :key="job.id"
              class="rounded-lg border border-border p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-sm">{{ job.productId }}</span>
                    <Badge :variant="productMutationStatusVariant(job.status)">
                      {{ productMutationStatusLabel(job.status) }}
                    </Badge>
                  </div>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {{
                      t('products.view.page.statusTransition', {
                        from: t(
                          job.originalDisplay === 'online'
                            ? 'products.view.feedback.online'
                            : 'products.view.feedback.offline'
                        ),
                        to: t(
                          job.targetDisplay === 'online'
                            ? 'products.view.feedback.online'
                            : 'products.view.feedback.offline'
                        )
                      })
                    }}
                    <span class="font-mono">{{ job.requestId }}</span>
                  </p>
                  <p class="mt-2 text-sm text-muted-foreground">{{ productMutationMessage(job) }}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="refreshDisplayMutation.isPending.value"
                    @click="refreshDisplayMutation.mutate(job)"
                    >{{ t('products.view.page.queryStatus') }}</Button
                  >
                  <Button
                    v-if="job.status === 'recovery-required'"
                    size="sm"
                    variant="destructive"
                    :disabled="recoverDisplayMutation.isPending.value"
                    @click="recoverDisplayJob(job)"
                    >{{ t('products.view.page.recover') }}</Button
                  >
                </div>
              </div>
            </div>
          </div>
          <ErrorNotice
            v-if="refreshDisplayMutation.error.value"
            class="mt-3"
            :error="refreshDisplayMutation.error.value"
            compact
          />
          <ErrorNotice
            v-if="recoverDisplayMutation.error.value"
            class="mt-3"
            :error="recoverDisplayMutation.error.value"
            compact
          />
        </Card>
      </section>
    </div>
  </template>

  <template v-else-if="workspace === 'publisher'">
    <Card class="mb-5 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ editProductId ? t('products.view.page.editExisting') : t('products.view.page.addTitle') }}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{
              editProductId
                ? t('products.view.page.productId', { id: editProductId })
                : t('products.view.page.chooseLeaf')
            }}
          </p>
        </div>
        <Button variant="outline" size="sm" @click="startNewProduct">{{
          t('products.view.page.restart')
        }}</Button>
      </div>
      <ProductCategoryPicker
        v-model="categoryId"
        v-model:search="categorySearch"
        class="mt-5"
        :categories="categoryTree"
        :current-category="currentCategory"
        :loading="categories.isPending.value"
        :loading-category-id="categoryLoadingId"
        :error="categoryPickerError"
        :disabled="Boolean(editProductId)"
        @select="selectCategory"
        @retry="retryCategories"
      />
      <div class="mt-4 flex flex-wrap gap-2">
        <Button :disabled="!categorySelectionReady || categoryLoadingId !== null" @click="loadSchema">
          <Layers3 class="size-4" />{{
            editProductId ? t('products.view.page.reloadForm') : t('products.view.page.start')
          }}
        </Button>
        <Button variant="outline" @click="loadDraft"
          ><RefreshCw class="size-4" />{{ t('products.view.page.loadDraft') }}</Button
        >
        <Button variant="outline" :disabled="!schemaModel" @click="refreshLevelSchema">
          <RefreshCw class="size-4" />{{ t('products.view.page.refreshAttributes') }}
        </Button>
      </div>
      <details class="mt-4 rounded-lg border p-3">
        <summary class="cursor-pointer text-sm font-medium">{{ t('products.view.page.advanced') }}</summary>
        <div class="mt-3 grid gap-3 md:grid-cols-3">
          <label class="text-sm font-medium">
            {{ t('products.view.page.market') }}
            <select v-model="market" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option value="wholesale">wholesale</option>
              <option value="sourcing">sourcing</option>
            </select>
          </label>
          <label class="text-sm font-medium">
            {{ t('products.view.page.language') }}
            <select
              v-model="language"
              class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
              :aria-label="t('products.view.page.formLanguage')"
            >
              <option value="zh_CN">{{ t('products.view.page.simplifiedChinese') }}</option>
              <option value="en_US">{{ t('products.view.page.english') }}</option>
            </select>
          </label>
          <label class="text-sm font-medium">
            {{ t('products.view.page.clearProductId') }}
            <Input
              v-model="editProductId"
              class="mt-2"
              :placeholder="t('products.view.page.newProductIdPlaceholder')"
            />
          </label>
        </div>
      </details>
      <div v-if="draftCandidate" class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
        <p class="font-medium text-amber-950">
          {{
            t(
              migratedDraftKey === draftCandidate.draftKey
                ? 'products.view.page.migratedDraft'
                : 'products.view.page.localDraft'
            )
          }}
        </p>
        <p class="mt-1 text-xs text-amber-800">
          {{
            t('products.view.page.draftSavedAt', {
              time: formatDateTime(draftCandidate.updatedAtUtc)
            })
          }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button size="sm" @click="resumeLocalDraft">{{ t('products.view.page.resumeDraft') }}</Button>
          <Button size="sm" variant="outline" @click="reloadPlatformData">
            {{ t('products.view.page.reloadPlatform') }}
          </Button>
        </div>
      </div>
      <p
        v-if="draftSaveStatus !== 'idle' && !draftCandidate"
        class="mt-3 text-xs"
        :class="draftSaveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ t('products.view.page.draftStatus', { status: draftSaveLabel(draftSaveStatus) }) }}
      </p>
      <p v-if="schemaError" class="mt-3 text-sm text-destructive">{{ schemaError }}</p>
    </Card>

    <Card v-if="currentProductMutationJob" class="mb-5 border-amber-300 p-5 dark:border-amber-800">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold">{{ t('products.view.page.updateStatus') }}</h2>
            <Badge :variant="productMutationStatusVariant(currentProductMutationJob.status)">
              {{ productMutationStatusLabel(currentProductMutationJob.status) }}
            </Badge>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ productMutationMessage(currentProductMutationJob) }}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          :disabled="productMutationHistory.isFetching.value"
          @click="productMutationHistory.refetch()"
        >
          <RefreshCw class="size-4" />
          {{
            productMutationHistory.isFetching.value
              ? t('products.view.page.checking')
              : t('products.view.page.queryPlatform')
          }}
        </Button>
      </div>
      <dl class="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt>{{ t('products.view.columns.product') }} ID</dt>
          <dd class="mt-1 font-mono text-foreground">{{ currentProductMutationJob.productId }}</dd>
        </div>
        <div>
          <dt>requestId</dt>
          <dd class="mt-1 break-all font-mono text-foreground">{{ currentProductMutationJob.requestId }}</dd>
        </div>
        <div>
          <dt>{{ t('products.view.page.submittedAt') }}</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentProductMutationJob.submittedTimeUtc) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('products.view.page.lastCheck') }}</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentProductMutationJob.lastCheckedTimeUtc) }}
          </dd>
        </div>
      </dl>
      <p
        v-if="currentProductMutationJob.status === 'recovery-required'"
        class="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ t('products.view.page.recoveryWarning') }}
      </p>
      <p
        v-else-if="currentProductMutationJob.status === 'verified'"
        class="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        {{ t('products.view.page.verifiedNotice') }}
      </p>
    </Card>
    <ErrorNotice
      v-if="productMutationHistory.error.value"
      class="mb-4"
      :error="productMutationHistory.error.value"
      compact
    />

    <Card
      v-if="currentCreationMutationJob && !editProductId"
      class="mb-5 border-amber-300 p-5 dark:border-amber-800"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-medium">
              {{
                currentCreationMutationJob.operation === 'saveProductDraft'
                  ? t('products.view.page.recentDraftJob')
                  : t('products.view.page.recentPublishJob')
              }}
            </p>
            <Badge :variant="productMutationStatusVariant(currentCreationMutationJob.status)">
              {{ productMutationStatusLabel(currentCreationMutationJob.status) }}
            </Badge>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ productMutationMessage(currentCreationMutationJob) }}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          :disabled="creationMutationHistory.isFetching.value"
          @click="creationMutationHistory.refetch()"
        >
          <RefreshCw class="size-4" />
          {{
            creationMutationHistory.isFetching.value
              ? t('products.view.page.checking')
              : t('products.view.page.queryPlatform')
          }}
        </Button>
      </div>
      <dl class="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt>{{ t('products.view.columns.product') }} ID</dt>
          <dd class="mt-1 font-mono text-foreground">
            {{
              productMutationJobHasResolvedProductId(currentCreationMutationJob)
                ? currentCreationMutationJob.productId
                : t('products.view.page.waitingProductId')
            }}
          </dd>
        </div>
        <div>
          <dt>requestId</dt>
          <dd class="mt-1 break-all font-mono text-foreground">
            {{ currentCreationMutationJob.requestId }}
          </dd>
        </div>
        <div>
          <dt>{{ t('products.view.page.submittedAt') }}</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentCreationMutationJob.submittedTimeUtc) }}
          </dd>
        </div>
        <div>
          <dt>{{ t('products.view.page.lastCheck') }}</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentCreationMutationJob.lastCheckedTimeUtc) }}
          </dd>
        </div>
      </dl>
      <p
        v-if="currentCreationMutationJob.status === 'recovery-required'"
        class="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ t('products.view.page.uncertainCreation') }}
      </p>
    </Card>
    <ErrorNotice
      v-if="creationMutationHistory.error.value"
      class="mb-4"
      :error="creationMutationHistory.error.value"
      compact
    />

    <Card
      v-if="schemaModel && !editProductId"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 border-dashed p-4"
    >
      <div>
        <p class="font-medium">
          {{ editingBatchItemId ? t('products.view.page.updateBatch') : t('products.view.page.addBatch') }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('products.view.page.batchDescription') }}
        </p>
      </div>
      <Button variant="outline" :disabled="!schemaInspection.safe" @click="queueCurrentProduct">
        <ListPlus class="size-4" />
        {{ editingBatchItemId ? t('products.view.page.updateQueue') : t('products.view.page.addQueue') }}
      </Button>
    </Card>

    <ProductEditorWizard
      v-if="schemaModel"
      :mode="editorMode"
      :step="editorStep"
      :model="schemaModel"
      :issues="schemaIssues"
      :quality-issues="qualityIssues"
      :official-hints="officialHints"
      :product-description-type="productDescriptionType"
      :language="language"
      :publish-disabled="productPublishDisabled"
      :draft-disabled="platformDraftDisabled"
      :publish-disabled-reason="productPublishDisabledReason"
      :draft-disabled-reason="platformDraftDisabledReason"
      :platform-draft-id="platformDraftId"
      :submit-pending="publish.isPending.value"
      :editing="Boolean(editProductId)"
      :score-available="Boolean(editScoreProductId)"
      :score-pending="productScore.isPending.value"
      :score-error="productScore.error.value ? errorMessage(productScore.error.value) : undefined"
      :schema-preview="schemaPreview"
      :schema-inspection="schemaInspection"
      @update:mode="setEditorMode"
      @update:step="setEditorStep"
      @update-field="updateRootField"
      @image-status="updateImageStatus"
      @refresh-score="productScore.mutate(editScoreProductId)"
      @submit="submitProduct"
    />
    <ErrorNotice v-if="publish.error.value" class="mt-3" :error="publish.error.value" compact />
  </template>

  <template v-else-if="workspace === 'batch-publisher'">
    <ProductBatchPublisher
      :items="batchItems"
      :selected-ids="selectedBatchItemIds"
      :target="batchTarget"
      :results="batchResults"
      :active-item-id="activeBatchItemId"
      :running="batchPublish.isPending.value"
      :draft-allowed="productOperations.isAllowed('saveProductDraft')"
      :publish-allowed="productOperations.isAllowed('publishProduct')"
      :draft-disabled-reason="platformDraftDisabledReason"
      :publish-disabled-reason="
        mutationDisabledReason('publishProduct', t('products.view.errors.publishDisabled'))
      "
      :category-labels="batchCategoryLabels"
      @update:selected-ids="selectedBatchItemIds = $event"
      @update:target="batchTarget = $event"
      @run="submitBatchPublish"
      @stop="stopBatchPublish"
      @edit="editBatchItem"
      @remove="removeBatchItem"
    />
    <ErrorNotice v-if="batchPublish.error.value" class="mt-3" :error="batchPublish.error.value" compact />
  </template>

  <ProductTransferDialog
    v-model:open="productTransferDialogOpen"
    v-model:schema-format="productTransferSchemaFormat"
    v-model:file-format="productTransferFileFormat"
    :mode="productTransferDialogMode"
    :busy="productTransferBusy"
    :error="productTransferError"
    :export-products="productTransferExportProducts"
    :asset-upload-allowed="productTransferAssetUploadAllowed"
    :asset-upload-disabled-reason="productTransferAssetUploadDisabledReason"
    :asset-download-allowed="productTransferAssetDownloadAllowed"
    :asset-download-disabled-reason="productTransferAssetDownloadDisabledReason"
    :progress="productTransferProgress"
    @confirm-import="importProducts"
    @confirm-export="exportSelectedProducts"
  />
  <ProductGroupManagerDialog v-model:open="productGroupDialogOpen" @changed="handleProductGroupChanged" />

  <ConfirmActionDialog
    :open="actionConfirmation !== null"
    :title="actionConfirmationTitle"
    :description="actionConfirmationDescription"
    :destructive="actionConfirmationDestructive"
    :confirm-label="t('products.view.confirmation.continue')"
    @update:open="actionConfirmation = $event ? actionConfirmation : null"
    @confirm="confirmProductAction"
  >
    <template v-if="actionConfirmation?.kind === 'product' && actionConfirmation.changedNames.length">
      <p>
        {{
          t('products.view.confirmation.changedFields', {
            count: actionConfirmation.changedNames.length
          })
        }}
      </p>
      <p class="max-h-28 overflow-auto rounded-md bg-muted p-3 text-foreground">
        {{ actionConfirmation.changedNames.join('、') }}
      </p>
    </template>
    <p v-else>{{ t('products.view.confirmation.genericBody') }}</p>
  </ConfirmActionDialog>
  <ImagePreview v-model:open="productPreviewOpen" :images="productPreviewImages" />
</template>
