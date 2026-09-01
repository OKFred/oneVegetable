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
const { language: preferredLanguage } = useAppPreferences();
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
  mutationDisabledReason('saveProductDraft', '当前环境未开放平台草稿写入')
);
const productPublishDisabledReason = computed(() =>
  productMutationBlocksSubmit.value
    ? productMutationDisabledReason(currentProductMutationJob.value)
    : mutationDisabledReason(
        editProductId.value ? 'updateProduct' : 'publishProduct',
        editProductId.value ? '当前环境未开放商品更新' : '当前环境未开放正式发布'
      )
);

const publish = useMutation({
  mutationFn: async (draft: boolean) => {
    if (!schemaModel.value) throw new Error('请先获取商品 Schema');
    if (editProductId.value) {
      const patch = inspectProductSchemaPatchSerialization(schemaModel.value);
      if (!patch.safe) throw new Error(`Schema XML 结构异常：${patch.structuralDiffs.join('；')}`);
      if (patch.noOp || patch.changedFieldKeys.length === 0) throw new Error('没有需要提交的商品字段变更');
      const changedFieldKeys = new Set(patch.changedFieldKeys);
      const changedErrors = blockingSchemaIssues.value.filter((issue) =>
        [...changedFieldKeys].some(
          (fieldKey) => issue.fieldKey === fieldKey || issue.fieldKey.startsWith(`${fieldKey}:`)
        )
      );
      if (changedErrors.length > 0) throw new Error('请先补齐本次修改涉及的最低发布条件');
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
    const inspection = inspectProductSchemaSerialization(schemaModel.value);
    if (!inspection.safe) throw new Error(`Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
    const base = {
      categoryId: Number(categoryId.value),
      language: language.value,
      schemaXml: inspection.xml
    };
    const validation = validateSchemaPublishInput(base);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if (!draft && blockingSchemaIssues.value.length > 0)
      throw new Error('请先补齐商品名称、主图等最低发布条件');
    return draft ? gateway.request('saveProductDraft', base) : gateway.request('publishProduct', base);
  },
  onSuccess: async (result, draft) => {
    if (editProductId.value && result.job) {
      feedback.value = `商品 ${result.productId} 已提交平台审核；审核完成并回读一致后才算更新成功。`;
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
      ? `商品 ${result.productId} 已更新`
      : creationPending
        ? `平台已接受${draft ? '草稿创建' : '正式发布'}：${result.productId}，正在回读确认`
        : `${draft ? '草稿已保存并回读确认' : '商品已发布并回读确认'}：${result.productId}`;
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
          feedback.value = `平台已接受“${result.title}”，但本地队列状态保存失败：${errorMessage(error)}`;
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
    feedback.value = `批量任务完成：成功 ${succeeded}，失败 ${failed}，阻断 ${blocked}，停止 ${cancelled}`;
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
    imageMetadata: imageMetadata.value
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
    '当前环境未开放真实图库上传'
  )
);
const productTransferAssetDownloadDisabledReason = computed(() =>
  operationAvailabilityMessage(
    productTransferOperations.reasonCode('downloadProductAsset'),
    '当前环境未开放商品图片下载'
  )
);
const moreActionsDisabledReason = computed(() =>
  selectedProducts.value.length === 0 ? '请先勾选至少一个商品' : ''
);
const actionConfirmationTitle = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return '确认商品操作';
  if (action.kind === 'product') {
    if (editProductId.value) return '确认更新商品';
    return action.draft ? '确认创建平台草稿' : '确认正式发布商品';
  }
  if (action.kind === 'batch-publish') {
    return action.target === 'draft' ? '确认批量创建平台草稿' : '确认批量正式发布';
  }
  if (action.kind === 'batch-display') return action.display === 'online' ? '确认批量上架' : '确认批量下架';
  return '确认恢复商品状态';
});
const actionConfirmationDescription = computed(() => {
  const action = actionConfirmation.value;
  if (!action) return '';
  if (action.kind === 'product') {
    return editProductId.value
      ? `该操作会增量修改国际站商品 ${editProductId.value}。`
      : action.draft
        ? '该操作会在当前国际站账号中创建一条平台草稿。'
        : '该操作会创建真实线上商品并进入平台审核。';
  }
  if (action.kind === 'batch-publish') {
    return action.target === 'draft'
      ? `将严格串行创建 ${action.itemIds.length} 条平台草稿，单条失败后继续。`
      : `将严格串行发布 ${action.itemIds.length} 个真实线上商品，单条失败后继续。`;
  }
  if (action.kind === 'batch-display') {
    return `将修改 ${action.productIds.length} 个真实商品的${action.display === 'online' ? '上架' : '下架'}状态。`;
  }
  return `将把商品 ${action.job.productId} 恢复为操作前的${action.job.originalDisplay === 'online' ? '上架' : '下架'}状态。`;
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
    if (!productMutationJobs) throw new Error('当前模式不支持持久商品写入任务');
    return productMutationJobs.refresh(job.id, job.revision);
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-display-mutation-jobs'] })
});
const recoverDisplayMutation = useMutation({
  mutationFn: (job: ProductMutationJob) => {
    if (!productMutationJobs) throw new Error('当前模式不支持持久商品写入任务');
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
      ? `${result.jobs.length} 个商品已提交${display === 'online' ? '上架' : '下架'}，正在回读确认`
      : `${result.encryptedProductIds.length} 个商品已${display === 'online' ? '上架' : '下架'}`;
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
      feedback.value = '没有需要提交的商品字段变更';
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
    feedback.value = '批量发品仅接受新增商品；已有商品请使用单品增量更新。';
    return;
  }
  if (!schemaModel.value || !categoryId.value || !schemaInspection.value.safe) {
    feedback.value = '请先加载商品表单，并修复 Schema XML 结构问题。';
    return;
  }
  if (!('localStorage' in globalThis)) {
    feedback.value = '当前环境不支持本地批量队列。';
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
    toast.success(`“${queued.title}”已加入批量发品队列。`);
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
    feedback.value = '请至少选择一个待提交商品。';
    return;
  }
  const operation = batchTarget.value === 'draft' ? 'saveProductDraft' : 'publishProduct';
  if (!productOperations.isAllowed(operation)) {
    feedback.value = mutationDisabledReason(
      operation,
      batchTarget.value === 'draft' ? '当前环境未开放平台草稿写入' : '当前环境未开放正式发布'
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
  feedback.value = '当前正在提交的商品不会中断；完成后将停止剩余任务。';
}

function editBatchItem(item: ProductBatchPublishItem): void {
  cancelDraftSave();
  draftCandidate.value = null;
  resetEditorSession({ categoryId: item.categoryId, mode: 'quick' });
  schemaModel.value = parseProductSchemaXml(item.xml);
  language.value = item.language;
  market.value = item.market;
  editingBatchItemId.value = item.id;
  currentCategory.value =
    categoryOptions.value.find((category) => String(category.id) === item.categoryId) ?? null;
  workspace.value = 'publisher';
  feedback.value = `正在编辑批量队列中的“${item.title}”；修改后请重新加入队列。`;
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
  toast.success(`“${item.title}”已从批量队列移除。`);
}

function reloadBatchItems(): void {
  if (!('localStorage' in globalThis)) return;
  batchItems.value = loadProductBatchPublishItems(globalThis.localStorage);
}

async function exportSelectedProducts(): Promise<void> {
  if (productTransferExportProducts.value.length === 0) {
    productTransferError.value = '请先选择要导出的商品。';
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
      `已导出 ${transferItems.length} 个商品（${productTransferFileFormat.value.toLocaleUpperCase()}，${productTransferSchemaFormatLabel(productTransferSchemaFormat.value)}）。`
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
      message: `正在读取商品 Schema（${index + 1}/${productsToExport.length}）…`,
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
    if (!schema) throw new Error(`商品 ${product.id} 缺少类目，无法导出完整 Schema`);
    const schemaXml = resolveProductSchemaXml(schema);
    if (!schemaXml) throw new Error(`商品 ${product.id} 未返回 Schema XML 或 Schema JSON`);
    const exportedCategoryId =
      product.status === 'draft' && schema.categoryId > 0 ? schema.categoryId : product.categoryId;
    if (exportedCategoryId === null) throw new Error(`商品 ${product.id} 缺少类目，无法导出完整 Schema`);
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
  const models = transferItems.map((item) => parseProductSchemaXml(item.schemaXml ?? ''));
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
      message: `正在下载图库图片（${index + 1}/${assetUrls.length}）…`,
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
    if (!item) throw new Error('商品 ZIP 导出范围发生变化');
    return {
      ...item,
      schemaXml: serializeProductSchemaXml(replaceProductSchemaAssetReferences(model, replacements))
    };
  });
  const document = createProductTransferArchiveDocument(archiveItems, productTransferSchemaFormat.value);
  productTransferProgress.value = {
    phase: 'packing',
    message: '正在生成 ZIP 资源包…',
    current: 0,
    total: 1
  };
  const archive = await createProductTransferArchive({ document, assets: [...assetsBySha.values()] });
  downloadBinaryFile(`one-vegetable-products-${fileTimestamp(new Date())}.zip`, archive, 'application/zip');
}

async function importProducts(selection: ProductTransferImportSelection): Promise<void> {
  if (!('localStorage' in globalThis)) {
    productTransferError.value = '当前环境不支持本地商品导入。';
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
      message: '正在写入本机批量发品队列…',
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
      `商品 ${selection.kind === 'zip' ? 'ZIP' : 'JSON'} 已导入本机队列：新增 ${result.added}，更新 ${result.updated}，已提交跳过 ${result.skipped}。导入不会自动发布商品。`
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
    if (!asset) throw new Error(`ZIP 缺少图片：${path}`);
    productTransferProgress.value = {
      phase: 'uploading',
      message: `正在上传到“${selection.targetGroupName}”（${index + 1}/${selection.archive.referencedAssetPaths.length}）…`,
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
        replaceProductSchemaAssetReferences(parseProductSchemaXml(product.schemaXml), replacements)
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
      ? `取消选择本页全部 ${count} 个商品`
      : `选择本页全部 ${count} 个商品`,
    title: allCurrentPageProductsSelected.value ? '取消选择本页全部商品' : '选择本页全部商品',
    'onUpdate:checked': toggleCurrentPageProducts
  });
}

function productSelectionCell(product: Product) {
  return h(TriStateCheckbox, {
    checked: selectedProductIds.value.includes(product.id),
    label: `选择 ${product.subject}`,
    'onUpdate:checked': (checked: boolean) => {
      toggleProduct(product.id, checked);
    }
  });
}

const columns: DataColumn<Product>[] = [
  {
    id: 'select',
    header: productSelectionHeader,
    cell: ({ row }) => productSelectionCell(row.original),
    meta: { sticky: 'left', stickyOffset: '0px', width: '56px' }
  },
  {
    id: 'image',
    header: '图片',
    cell: ({ row }) =>
      row.original.imageUrl
        ? h(
            'button',
            {
              type: 'button',
              class:
                'group relative block size-14 cursor-zoom-in overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'aria-label': `预览 ${row.original.subject} 主图`,
              onClick: () => {
                openProductImagePreview(row.original);
              }
            },
            h('img', {
              src: row.original.imageUrl,
              alt: `${row.original.subject} 主图`,
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
            '暂无'
          ),
    meta: { sticky: 'left', stickyOffset: '56px', stickyBoundary: true, width: '96px' }
  },
  {
    accessorKey: 'subject',
    header: '商品',
    cell: ({ row }) =>
      h('div', { class: 'min-w-56 space-y-1' }, [
        h('p', { class: 'font-medium' }, row.original.subject),
        h('p', { class: 'font-mono text-xs text-muted-foreground' }, row.original.id)
      ])
  },
  {
    accessorKey: 'groupName',
    header: '分组',
    cell: (context) => h('span', { class: 'block min-w-20' }, context.getValue<string>() || '—')
  },
  {
    accessorKey: 'status',
    header: '状态',
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
    header: '产品分',
    cell: ({ row }) => {
      const score = scoreForProduct(row.original);
      const error = scoreErrorForProduct(row.original);
      return h('div', { class: 'min-w-24 space-y-0.5' }, [
        h(
          'span',
          { class: 'font-medium tabular-nums' },
          score ? `${formatProductScore(score.score)}/${PRODUCT_SCORE_DISPLAY_MAX}` : '未查询'
        ),
        score?.issues.length
          ? h('p', { class: 'text-xs text-amber-700 dark:text-amber-400' }, `${score.issues.length} 项建议`)
          : null,
        error ? h('p', { class: 'text-xs text-destructive', title: error }, '查询失败') : null
      ]);
    }
  },
  {
    accessorKey: 'score',
    header: '质量分',
    cell: (context) => {
      const score = context.getValue<number>();
      return score > 0 ? `${score}/100` : '—';
    }
  },
  {
    accessorKey: 'updatedAt',
    header: '更新时间',
    cell: (context) =>
      h('span', { class: 'whitespace-nowrap tabular-nums' }, formatDateTime(context.getValue<string>()))
  },
  {
    id: 'actions',
    header: '操作',
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
          () => '编辑'
        )
      ]),
    meta: { sticky: 'right', stickyOffset: '0px', stickyBoundary: true, width: '120px' }
  }
];

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
    feedback.value = '选中的商品没有可用于查询产品分的平台混淆 ID。';
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
  const message = `产品分查询完成：成功 ${succeeded} 个，失败 ${failed} 个${skipped > 0 ? `，跳过 ${skipped} 个` : ''}。`;
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
      alt: `${product.subject} 主图`,
      description: `商品 ${product.id}`
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
    if (!parent) throw new Error(`平台未返回类目 ${categoryIdToLoad}`);
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
    feedback.value = `已选择叶子类目：${category.name}`;
    return;
  }
  if (category && category.children.length > 0) {
    feedback.value = `请选择“${category.name}”下的可发布类目。`;
    return;
  }
  const loaded = await loadCategoryBranch(categoryIdToSelect);
  if (!loaded) return;
  feedback.value = loaded.leaf
    ? `已选择叶子类目：${loaded.name}`
    : `已加载“${loaded.name}”的 ${loaded.children.length} 个下级类目，请继续选择。`;
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
      ? '已选择商品；列表未返回类目，请选择实际类目后获取编辑 Schema。'
      : '已选择商品及其真实类目，正在渲染现有商品 Schema。';
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
  feedback.value = '请选择叶子类目并开始填写商品信息。';
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
    schemaModel.value = parseProductSchemaXml(xml);
    sourceIsLocalDraft.value = false;
    schemaError.value = '';
    feedback.value = message;
    editorStep.value = 'basics';
    updateProductHash('replace');
    if (offerLocalDraft) offerCurrentDraft();
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : 'Schema XML 无法解析';
  }
}

async function loadSchema(): Promise<void> {
  schemaError.value = '';
  const parsedCategoryId = resolveCategoryId();
  if (parsedCategoryId === null) {
    if (!schemaError.value) schemaError.value = '请先选择有效类目';
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
    applySchema(result.xml, editProductId.value ? '已渲染现有商品 Schema' : '已按当前类目加载官方 Schema');
    if (editScoreProductId.value) productScore.mutate(editScoreProductId.value);
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : '获取 Schema 失败';
  }
}

function resolveCategoryId(): number | null {
  const parsed = Number(categoryId.value);
  if (!categoryId.value || !Number.isSafeInteger(parsed) || parsed <= 0) return null;
  if (!editProductId.value && selectedCategory.value?.leaf !== true) {
    schemaError.value = '请选择可发布的叶子类目；选择上级类目后会自动加载下一级';
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
    schemaError.value = '请先输入草稿商品 ID';
    return;
  }
  try {
    const result = await gateway.request('getProductDraft', {
      productId: editProductId.value,
      language: language.value
    });
    categoryId.value = String(result.categoryId);
    applySchema(result.schemaXml, `已渲染草稿 ${result.id}`);
    editScoreProductId.value = result.encryptedId ?? '';
    if (editScoreProductId.value) productScore.mutate(editScoreProductId.value);
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : '草稿渲染失败';
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
    applySchema(result.xml, '层级属性已根据当前选择刷新', false);
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : '层级属性刷新失败';
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
    schemaModel.value = parseProductSchemaXml(draft.xml);
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
    feedback.value = '已继续本地草稿，平台数据尚未被修改。';
    updateProductHash('replace');
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : '本地草稿无法解析';
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
  if (status === 'saving') return '保存中…';
  if (status === 'saved') return '已保存到本机';
  if (status === 'error') return '本地草稿保存失败';
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
  return error instanceof Error ? error.message : '操作失败';
}

function mutationDisabledReason(operation: OperationId, fallback: string): string {
  return operationAvailabilityMessage(productOperations.reasonCode(operation), fallback);
}

function productMutationDisabledReason(job: ProductMutationJob | null): string {
  if (!job) return '商品写入状态尚未就绪';
  if (job.status === 'submitted' || job.status === 'auditing') {
    return '商品正在平台审核中，请勿重复提交；本地草稿会继续保留';
  }
  if (job.status === 'verifying') return '上下架请求已接受，正在等待商品列表回读';
  if (job.status === 'recovering') return '原状态恢复请求已接受，正在等待商品列表回读';
  if (job.status === 'recovery-required') {
    return '平台回读与提交内容不一致，请先人工确认并恢复商品';
  }
  return '更新已验证，请重新加载商品表单后再继续增量编辑';
}

function productMutationStatusLabel(status: ProductMutationJob['status']): string {
  if (status === 'submitted') return '已提交';
  if (status === 'auditing') return '平台审核中';
  if (status === 'verifying') return '回读确认中';
  if (status === 'verified') return '回读已验证';
  if (status === 'recovery-required') return '需要人工恢复';
  if (status === 'recovering') return '正在恢复原状态';
  if (status === 'recovered') return '原状态已恢复';
  return '提交失败';
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
  return formatDateTime(value, '尚未检查');
}

function guardedSchemaXml(model: ProductSchemaModel): string {
  const inspection = inspectProductSchemaSerialization(model);
  if (!inspection.safe) throw new Error(`Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
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
  <PageHeader
    title="商品管理"
    description="专用页面只使用官方推荐的 Schema 链路；旧类目和旧发品接口保留在通用调试器。"
  />

  <div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="商品工作区">
    <Button
      v-for="item in [
        ['list', '商品列表'],
        ['batch-publisher', '批量发品']
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
      <GroupSidebar v-model:collapsed="productGroupSidebarCollapsed" title="商品分组">
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
          aria-label="商品列表操作"
        >
          <div class="relative min-w-64 max-w-md flex-1">
            <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input v-model="subject" class="pl-9" placeholder="按标题搜索" />
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <span
              v-if="selectedProducts.length > MAX_PRODUCT_TRANSFER_ITEMS"
              class="text-xs text-amber-700 dark:text-amber-400"
              role="status"
            >
              单次最多导出 {{ MAX_PRODUCT_TRANSFER_ITEMS }} 个商品
            </span>
            <Button
              variant="outline"
              :disabled="products.isFetching.value"
              aria-label="刷新商品列表"
              @click="products.refetch()"
            >
              <RefreshCw class="size-4" :class="{ 'animate-spin': products.isFetching.value }" />
              {{ products.isFetching.value ? '刷新中…' : '刷新' }}
            </Button>
            <Button variant="outline" :disabled="productTransferBusy" @click="openProductImportDialog">
              <Upload class="size-4" />导入
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
                <Download class="size-4" />导出
              </Button>
            </ActionTooltip>
            <Button variant="outline" @click="productGroupDialogOpen = true">
              <Layers3 class="size-4" aria-hidden="true" />分组
            </Button>
            <ActionTooltip :disabled="Boolean(moreActionsDisabledReason)" :reason="moreActionsDisabledReason">
              <span class="inline-flex">
                <DropdownMenuRoot :modal="false">
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" :disabled="selectedProducts.length === 0">
                      <Ellipsis class="size-4" />更多<ChevronDown class="size-3.5" />
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
                        {{ queryingSelectedProductScores ? '批量查询中…' : '批量查询产品分' }}
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
                        批量上架
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
                        批量下架
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
              </span>
            </ActionTooltip>
            <Button @click="startNewProduct"><ListPlus class="size-4" aria-hidden="true" />新增</Button>
          </div>
        </div>
        <p
          v-if="selectedProductIds.length && productDisplayMutationDisabled"
          class="mb-3 text-xs text-amber-700 dark:text-amber-400"
        >
          当前环境尚未开放真实商品上下架。
        </p>
        <p v-else-if="selectedProductMissingEncryptedId" class="mb-3 text-xs text-destructive">
          选中的商品缺少平台混淆 ID，不能执行上下架。
        </p>
        <p v-else-if="selectedDisplayMutationBlocked" class="mb-3 text-xs text-amber-700 dark:text-amber-400">
          选中的商品仍有未完成或待恢复的上下架任务，请先确认任务状态。
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
            empty-text="没有匹配商品"
            min-width="1320px"
            @update:page="setProductPage"
            @update:page-size="setProductPageSize"
          >
            <template #empty>
              <div class="space-y-3 py-4">
                <p>没有匹配商品</p>
                <Button v-if="subject" variant="outline" size="sm" @click="subject = ''">清除搜索条件</Button>
                <Button v-else size="sm" @click="startNewProduct">新增商品</Button>
              </div>
            </template>
            <template #pagination-summary>
              <span
                class="border-l border-border pl-2 text-xs font-medium text-foreground"
                data-testid="product-selection-count"
                aria-live="polite"
              >
                已选 {{ selectedProducts.length }} 个
              </span>
            </template>
          </DataTable>
        </QueryState>
        <Card v-if="latestDisplayMutationJobs.length" class="mt-5 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold">最近上下架任务</h2>
              <p class="mt-1 text-sm text-muted-foreground">
                Alibaba 明确接受后仍需通过商品列表回读，才会标记为完成。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              :disabled="displayMutationHistory.isFetching.value"
              @click="displayMutationHistory.refetch()"
            >
              <RefreshCw class="size-4" />
              {{ displayMutationHistory.isFetching.value ? '检查中…' : '刷新全部' }}
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
                    {{ job.originalDisplay === 'online' ? '上架' : '下架' }} →
                    {{ job.targetDisplay === 'online' ? '上架' : '下架' }} · requestId
                    <span class="font-mono">{{ job.requestId }}</span>
                  </p>
                  <p v-if="job.message" class="mt-2 text-sm text-muted-foreground">{{ job.message }}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="refreshDisplayMutation.isPending.value"
                    @click="refreshDisplayMutation.mutate(job)"
                    >查询状态</Button
                  >
                  <Button
                    v-if="job.status === 'recovery-required'"
                    size="sm"
                    variant="destructive"
                    :disabled="recoverDisplayMutation.isPending.value"
                    @click="recoverDisplayJob(job)"
                    >恢复原状态</Button
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
          <h2 class="font-semibold">{{ editProductId ? '编辑已有商品' : '新增商品' }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ editProductId ? `商品 ${editProductId}` : '先选择叶子类目，再加载平台表单。' }}
          </p>
        </div>
        <Button variant="outline" size="sm" @click="startNewProduct">重新新建</Button>
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
          <Layers3 class="size-4" />{{ editProductId ? '重新加载商品表单' : '开始填写' }}
        </Button>
        <Button variant="outline" @click="loadDraft"><RefreshCw class="size-4" />加载平台草稿</Button>
        <Button variant="outline" :disabled="!schemaModel" @click="refreshLevelSchema">
          <RefreshCw class="size-4" />刷新层级属性
        </Button>
      </div>
      <details class="mt-4 rounded-lg border p-3">
        <summary class="cursor-pointer text-sm font-medium">高级设置</summary>
        <div class="mt-3 grid gap-3 md:grid-cols-3">
          <label class="text-sm font-medium">
            市场
            <select v-model="market" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option value="wholesale">wholesale</option>
              <option value="sourcing">sourcing</option>
            </select>
          </label>
          <label class="text-sm font-medium">
            语言
            <select
              v-model="language"
              class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
              aria-label="商品表单语言"
            >
              <option value="zh_CN">简体中文（zh_CN）</option>
              <option value="en_US">English（en_US）</option>
            </select>
          </label>
          <label class="text-sm font-medium">
            商品明文 ID
            <Input v-model="editProductId" class="mt-2" placeholder="新建商品时留空" />
          </label>
        </div>
      </details>
      <div v-if="draftCandidate" class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
        <p class="font-medium text-amber-950">
          {{ migratedDraftKey === draftCandidate.draftKey ? '发现从旧版本迁移的本地草稿' : '发现本地草稿' }}
        </p>
        <p class="mt-1 text-xs text-amber-800">
          保存于
          {{ formatDateTime(draftCandidate.updatedAtUtc) }}。请选择后再继续，不会静默覆盖平台表单。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button size="sm" @click="resumeLocalDraft">继续本地草稿</Button>
          <Button size="sm" variant="outline" @click="reloadPlatformData">重新加载平台数据</Button>
        </div>
      </div>
      <p
        v-if="draftSaveStatus !== 'idle' && !draftCandidate"
        class="mt-3 text-xs"
        :class="draftSaveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'"
      >
        本地草稿：{{ draftSaveLabel(draftSaveStatus) }}
      </p>
      <p v-if="schemaError" class="mt-3 text-sm text-destructive">{{ schemaError }}</p>
    </Card>

    <Card v-if="currentProductMutationJob" class="mb-5 border-amber-300 p-5 dark:border-amber-800">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold">商品更新状态</h2>
            <Badge :variant="productMutationStatusVariant(currentProductMutationJob.status)">
              {{ productMutationStatusLabel(currentProductMutationJob.status) }}
            </Badge>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ currentProductMutationJob.message || '等待下一次平台状态检查。' }}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          :disabled="productMutationHistory.isFetching.value"
          @click="productMutationHistory.refetch()"
        >
          <RefreshCw class="size-4" />
          {{ productMutationHistory.isFetching.value ? '检查中…' : '查询平台状态' }}
        </Button>
      </div>
      <dl class="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt>商品 ID</dt>
          <dd class="mt-1 font-mono text-foreground">{{ currentProductMutationJob.productId }}</dd>
        </div>
        <div>
          <dt>requestId</dt>
          <dd class="mt-1 break-all font-mono text-foreground">{{ currentProductMutationJob.requestId }}</dd>
        </div>
        <div>
          <dt>提交时间</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentProductMutationJob.submittedTimeUtc) }}
          </dd>
        </div>
        <div>
          <dt>最近检查</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentProductMutationJob.lastCheckedTimeUtc) }}
          </dd>
        </div>
      </dl>
      <p
        v-if="currentProductMutationJob.status === 'recovery-required'"
        class="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        请先在国际站后台核对商品内容。本地草稿不会自动删除，也不会自动重复提交或覆盖平台商品。
      </p>
      <p
        v-else-if="currentProductMutationJob.status === 'verified'"
        class="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        平台回读已经匹配。重新加载商品表单后，才会以最新平台内容继续下一次增量编辑。
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
                  ? '最近的平台草稿任务'
                  : '最近的正式发布任务'
              }}
            </p>
            <Badge :variant="productMutationStatusVariant(currentCreationMutationJob.status)">
              {{ productMutationStatusLabel(currentCreationMutationJob.status) }}
            </Badge>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ currentCreationMutationJob.message || '等待下一次平台状态检查。' }}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          :disabled="creationMutationHistory.isFetching.value"
          @click="creationMutationHistory.refetch()"
        >
          <RefreshCw class="size-4" />
          {{ creationMutationHistory.isFetching.value ? '检查中…' : '查询平台状态' }}
        </Button>
      </div>
      <dl class="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt>商品 ID</dt>
          <dd class="mt-1 font-mono text-foreground">
            {{
              productMutationJobHasResolvedProductId(currentCreationMutationJob)
                ? currentCreationMutationJob.productId
                : '等待平台返回'
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
          <dt>提交时间</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentCreationMutationJob.submittedTimeUtc) }}
          </dd>
        </div>
        <div>
          <dt>最近检查</dt>
          <dd class="mt-1 text-foreground">
            {{ formatMutationTime(currentCreationMutationJob.lastCheckedTimeUtc) }}
          </dd>
        </div>
      </dl>
      <p
        v-if="currentCreationMutationJob.status === 'recovery-required'"
        class="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        结果仍不确定。请先在国际站后台核对；插件不会自动重复创建、删除或下架商品。
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
          {{ editingBatchItemId ? '更新批量队列商品' : '加入批量发品队列' }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          保存当前 Schema 快照；同一类目可以加入多个商品，稍后统一保存草稿或正式发布。
        </p>
      </div>
      <Button variant="outline" :disabled="!schemaInspection.safe" @click="queueCurrentProduct">
        <ListPlus class="size-4" />
        {{ editingBatchItemId ? '更新队列' : '加入队列' }}
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
      :publish-disabled-reason="mutationDisabledReason('publishProduct', '当前环境未开放正式发布')"
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
    confirm-label="确认继续"
    @update:open="actionConfirmation = $event ? actionConfirmation : null"
    @confirm="confirmProductAction"
  >
    <template v-if="actionConfirmation?.kind === 'product' && actionConfirmation.changedNames.length">
      <p>本次将更新 {{ actionConfirmation.changedNames.length }} 个字段：</p>
      <p class="max-h-28 overflow-auto rounded-md bg-muted p-3 text-foreground">
        {{ actionConfirmation.changedNames.join('、') }}
      </p>
    </template>
    <p v-else>请确认当前账号、商品数量和目标状态无误。提交后可在任务状态中通过 requestId 排查。</p>
  </ConfirmActionDialog>
  <ImagePreview v-model:open="productPreviewOpen" :images="productPreviewImages" />
</template>
