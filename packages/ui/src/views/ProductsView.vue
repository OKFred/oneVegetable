<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Layers3, LayoutGrid, List, RefreshCw, Search } from '@lucide/vue';

import {
  analyzeProductDescriptionQuality,
  collectProductSchemaOfficialHints,
  createProductScoreOfficialHints,
  inspectProductSchemaPatchSerialization,
  inspectProductSchemaSerialization,
  parseProductSchemaXml,
  productMutationJobIsBlocking,
  validateProductDisplayInput,
  validateProductGroupCreateInput,
  validateProductSchemaRenderInput,
  validateProductSchemaUpdateInput,
  validateSchemaPublishInput,
  type Product,
  type ProductCategory,
  type ProductDescriptionImageMetadata,
  type ProductMutationJob,
  type ProductSchemaOfficialHint,
  type ProductSchemaModel,
  type ProductScore
} from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import ProductCategoryPicker from '../components/ProductCategoryPicker.vue';
import ProductEditorWizard from '../components/ProductEditorWizard.vue';
import QueryState from '../components/QueryState.vue';
import ScoreProgress from '../components/ScoreProgress.vue';
import TablePagination from '../components/TablePagination.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import {
  findProductEditorDraft,
  migrateLegacyProductEditorDraft,
  migrateProductEditorDraftsV2,
  productEditorDraftKey,
  removeProductEditorDraft,
  saveProductEditorDraft,
  shouldPersistProductEditorDraft,
  type ProductEditorDraftV3
} from '../lib/product-editor-drafts';
import { useProductEditorSession } from '../composables/use-product-editor-session';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import type { DataColumn } from '../lib/table';

type Workspace = 'list' | 'publisher' | 'organization' | 'quality';
type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type QualityViewMode = 'cards' | 'list';

const { gateway, mode, operationAvailability, productMutationJobs } = useServices();
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
const groupName = ref('');
const groupParentId = ref('-1');
const imageMetadata = ref<Record<string, ProductDescriptionImageMetadata>>({});
const categorySearch = ref('');
const categoryTree = ref<ProductCategory[]>([]);
const currentCategory = ref<ProductCategory | null>(null);
const categoryLoadingId = ref<number | null>(null);
const categoryLoadError = ref('');
const qualityViewMode = ref<QualityViewMode>('cards');
const productScores = ref<Record<string, ProductScore>>({});
const productScoreErrors = ref<Record<string, string>>({});
const pendingProductScoreId = ref('');
let scoreRefreshTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let draftSaveTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
const sourceIsLocalDraft = ref(false);
const acknowledgedMutationJobId = ref('');

const products = useQuery({
  queryKey: ['products', subject, language, productPage, productPageSize],
  queryFn: () =>
    gateway.request('listProducts', {
      page: productPage.value,
      pageSize: productPageSize.value,
      subject: subject.value,
      language: language.value
    })
});
const categories = useQuery({
  queryKey: ['product-categories', 'tree-v2'],
  queryFn: () => gateway.request('listProductCategories', {}),
  staleTime: 10 * 60 * 1000
});
const groups = useQuery({
  queryKey: ['product-groups'],
  queryFn: () => gateway.request('listProductGroups', undefined)
});
const productMutationAvailability = useQuery({
  queryKey: ['product-mutation-availability'],
  queryFn: () =>
    operationAvailability?.get([
      'saveProductDraft',
      'publishProduct',
      'updateProduct',
      'updateProductDisplay',
      'createProductGroup'
    ]) ?? Promise.resolve({ items: [] }),
  enabled: computed(() => mode === 'bff' && operationAvailability !== undefined),
  staleTime: 10_000
});
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
  enabled: computed(() => mode === 'bff' && productMutationJobs !== undefined && editProductId.value !== ''),
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
  enabled: computed(() => mode === 'bff' && productMutationJobs !== undefined),
  refetchInterval: (query) =>
    query.state.data?.some((job) => productMutationJobIsBlocking(job.status)) ? 15_000 : false,
  staleTime: 0
});

const categoryOptions = computed(() => flattenCategories(categoryTree.value));
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
const availabilityByOperation = computed(
  () =>
    new Map(
      (productMutationAvailability.data.value?.items ?? []).map((item) => [item.operation, item] as const)
    )
);
const currentProductMutationJob = computed<ProductMutationJob | null>(
  () => productMutationHistory.data.value?.items.find((job) => job.operation === 'updateProduct') ?? null
);
const productMutationBlocksSubmit = computed(() => {
  const job = currentProductMutationJob.value;
  if (!job) return false;
  if (job.status === 'submitted' || job.status === 'auditing' || job.status === 'recovery-required') {
    return true;
  }
  return job.status === 'verified' && acknowledgedMutationJobId.value !== job.id;
});
function dedicatedMutationAllowed(operation: string): boolean {
  if (mode === 'mock') return true;
  return availabilityByOperation.value.get(operation)?.allowed === true;
}
const productGroupMutationDisabled = computed(() => !dedicatedMutationAllowed('createProductGroup'));
const productDisplayMutationDisabled = computed(() => !dedicatedMutationAllowed('updateProductDisplay'));
const platformDraftDisabled = computed(() => {
  if (mode === 'mock') return false;
  return availabilityByOperation.value.get('saveProductDraft')?.allowed !== true;
});
const productPublishDisabled = computed(() => {
  if (editProductId.value && productMutationBlocksSubmit.value) return true;
  if (mode === 'mock') return false;
  const operation = editProductId.value ? 'updateProduct' : 'publishProduct';
  return availabilityByOperation.value.get(operation)?.allowed !== true;
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
      if (changedErrors.length > 0) throw new Error('请先修正本次修改字段中的阻断问题');
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
    if (!draft && blockingSchemaIssues.value.length > 0) throw new Error('请先修正表单中的阻断问题');
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
    feedback.value = editProductId.value
      ? `商品 ${result.productId} 已更新`
      : `${draft ? '草稿已保存' : '商品已发布'}：${result.productId}`;
    await queryClient.invalidateQueries({ queryKey: ['products'] });
    if (draft && !editProductId.value) {
      platformDraftId.value = result.productId;
      saveCurrentLocalDraft();
    } else {
      clearCurrentLocalDraft();
    }
    if (editScoreProductId.value) scheduleScoreRefresh(editScoreProductId.value);
  }
});

const createGroup = useMutation({
  mutationFn: () => {
    const validation = validateProductGroupCreateInput({
      name: groupName.value.trim(),
      parentId: Number(groupParentId.value)
    });
    if (!validation.valid || !validation.data) throw new Error(validation.errors.join('；'));
    return gateway.request('createProductGroup', validation.data);
  },
  onSuccess: async (result) => {
    feedback.value = `分组“${result.name}”已创建`;
    groupName.value = '';
    await queryClient.invalidateQueries({ queryKey: ['product-groups'] });
  }
});

const categoryMapping = useMutation({
  mutationFn: () => gateway.request('mapProductCategory', { categoryId: Number(categoryId.value) })
});

const productScore = useMutation({
  mutationFn: (productId: string) => gateway.request('getProductScore', { productId }),
  onMutate: (productId) => {
    pendingProductScoreId.value = productId;
    productScoreErrors.value = Object.fromEntries(
      Object.entries(productScoreErrors.value).filter(([key]) => key !== productId)
    );
  },
  onSuccess: (result, productId) => {
    productScores.value = { ...productScores.value, [productId]: result };
  },
  onError: (error, productId) => {
    productScoreErrors.value = { ...productScoreErrors.value, [productId]: errorMessage(error) };
  },
  onSettled: (_result, _error, productId) => {
    if (pendingProductScoreId.value === productId) pendingProductScoreId.value = '';
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
const selectedProducts = computed(() =>
  (products.data.value?.items ?? []).filter((product) => selectedProductIds.value.includes(product.id))
);
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
  if (editProductId.value && mode !== 'mock') {
    const changedNames = (schemaModel.value?.fields ?? [])
      .filter((field) => schemaInspection.value.changedFieldKeys.includes(field.key))
      .map((field) => field.name || field.id);
    if (changedNames.length === 0) {
      feedback.value = '没有需要提交的商品字段变更';
      return;
    }
    const confirmed = globalThis.confirm(
      `将增量更新商品 ${editProductId.value} 的 ${changedNames.length} 个字段：\n${changedNames.join('、')}`
    );
    if (!confirmed) return;
  }
  publish.mutate(draft);
}

function submitProductGroup(): void {
  if (
    mode !== 'mock' &&
    !globalThis.confirm(`将在所选父级下创建真实商品分组“${groupName.value.trim()}”，是否继续？`)
  ) {
    return;
  }
  createGroup.mutate();
}

function submitBatchDisplay(display: 'online' | 'offline'): void {
  if (
    mode !== 'mock' &&
    !globalThis.confirm(
      `将把 ${selectedProductIds.value.length} 个真实商品${display === 'online' ? '上架' : '下架'}，是否继续？`
    )
  ) {
    return;
  }
  batchDisplay.mutate(display);
}

function recoverDisplayJob(job: ProductMutationJob): void {
  if (
    mode !== 'mock' &&
    !globalThis.confirm(
      `将把商品 ${job.productId} 恢复为本次操作前的${job.originalDisplay === 'online' ? '上架' : '下架'}状态，是否继续？`
    )
  ) {
    return;
  }
  recoverDisplayMutation.mutate(job);
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

const columns: DataColumn<Product>[] = [
  {
    id: 'select',
    header: '选择',
    cell: ({ row }) =>
      h('input', {
        type: 'checkbox',
        'aria-label': `选择 ${row.original.subject}`,
        checked: selectedProductIds.value.includes(row.original.id),
        onChange: (event: Event) => {
          toggleProduct(row.original.id, (event.target as HTMLInputElement).checked);
        }
      })
  },
  {
    accessorKey: 'subject',
    header: '商品',
    cell: (context) => h('div', { class: 'font-medium' }, context.getValue<string>())
  },
  { accessorKey: 'groupName', header: '分组' },
  {
    accessorKey: 'status',
    header: '状态',
    cell: (context) =>
      h(Badge, { variant: statusVariant(context.getValue<Product['status']>()) }, () =>
        context.getValue<string>()
      )
  },
  { accessorKey: 'score', header: '质量分', cell: (context) => `${context.getValue<number>()}/100` },
  {
    accessorKey: 'updatedAt',
    header: '更新时间',
    cell: (context) => new Date(context.getValue<string>()).toLocaleString('zh-CN')
  },
  {
    id: 'actions',
    header: '操作',
    cell: ({ row }) =>
      h(
        Button,
        {
          size: 'sm',
          variant: 'outline',
          onClick: () => {
            void selectProductForSchema(row.original);
          }
        },
        () => '编辑商品'
      )
  }
];

function scoreForProduct(product: Product): ProductScore | undefined {
  return product.encryptedId ? productScores.value[product.encryptedId] : undefined;
}

function scoreErrorForProduct(product: Product): string | undefined {
  return product.encryptedId ? productScoreErrors.value[product.encryptedId] : undefined;
}

function isProductScorePending(product: Product): boolean {
  return Boolean(product.encryptedId && pendingProductScoreId.value === product.encryptedId);
}

function queryProductScore(product: Product): void {
  if (product.encryptedId) productScore.mutate(product.encryptedId);
}

function formatProductScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

const qualityColumns: DataColumn<Product>[] = [
  {
    id: 'select',
    header: '选择',
    cell: ({ row }) =>
      h('input', {
        type: 'checkbox',
        'aria-label': `选择 ${row.original.subject}`,
        checked: selectedProductIds.value.includes(row.original.id),
        onChange: (event: Event) => {
          toggleProduct(row.original.id, (event.target as HTMLInputElement).checked);
        }
      })
  },
  {
    accessorKey: 'subject',
    header: '商品',
    cell: (context) => h('div', { class: 'font-medium' }, context.getValue<string>())
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: (context) =>
      h(Badge, { variant: statusVariant(context.getValue<Product['status']>()) }, () =>
        context.getValue<string>()
      )
  },
  {
    id: 'productScore',
    header: '产品分',
    cell: ({ row }) => {
      const score = scoreForProduct(row.original);
      return h('div', { class: 'space-y-0.5' }, [
        h(
          'span',
          { class: 'font-medium tabular-nums' },
          score ? `${formatProductScore(score.score)}/5` : '未查询'
        ),
        score?.issues.length
          ? h('p', { class: 'text-xs text-amber-700 dark:text-amber-400' }, `${score.issues.length} 项建议`)
          : null
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
    id: 'scoreAction',
    header: '操作',
    cell: ({ row }) =>
      h(
        Button,
        {
          size: 'sm',
          variant: 'outline',
          disabled: !row.original.encryptedId || isProductScorePending(row.original),
          onClick: () => {
            queryProductScore(row.original);
          }
        },
        () => (isProductScorePending(row.original) ? '查询中…' : '查询产品分')
      )
  }
];

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
  const loaded = await loadCategoryBranch(categoryIdToSelect);
  if (!loaded) return;
  feedback.value = loaded.leaf
    ? `已选择叶子类目：${loaded.name}`
    : `已加载“${loaded.name}”的 ${loaded.children.length} 个下级类目，请继续选择。`;
}

async function ensureCurrentCategory(categoryIdToLoad: number): Promise<void> {
  const existing = findCategory(categoryTree.value, categoryIdToLoad);
  if (existing) {
    currentCategory.value = existing;
    return;
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
  if (product.categoryId !== null) {
    await Promise.all([ensureCurrentCategory(product.categoryId), loadSchema()]);
  }
}

function startNewProduct(): void {
  cancelDraftSave();
  draftCandidate.value = null;
  acknowledgedMutationJobId.value = '';
  resetEditorSession({ categoryId: '', mode: 'quick' });
  editScoreProductId.value = '';
  currentCategory.value = null;
  categorySearch.value = '';
  categoryLoadError.value = '';
  schemaError.value = '';
  feedback.value = '请选择叶子类目并开始填写商品信息。';
  workspace.value = 'publisher';
  offerCurrentDraft();
}

function applySchema(xml: string, message: string, offerLocalDraft = true): void {
  try {
    schemaModel.value = parseProductSchemaXml(xml);
    sourceIsLocalDraft.value = false;
    schemaError.value = '';
    feedback.value = message;
    editorStep.value = 'basics';
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

function mutationDisabledReason(operation: string, fallback: string): string {
  if (mode === 'mock') return '';
  if (productMutationAvailability.isPending.value) return '正在读取当前账号的操作权限…';
  const reasonCode = availabilityByOperation.value.get(operation)?.reasonCode;
  return reasonCode ? `${fallback}（${reasonCode}）` : fallback;
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
  return value === null ? '尚未检查' : new Date(value).toLocaleString();
}

function guardedSchemaXml(model: ProductSchemaModel): string {
  const inspection = inspectProductSchemaSerialization(model);
  if (!inspection.safe) throw new Error(`Schema XML 结构异常：${inspection.structuralDiffs.join('；')}`);
  return inspection.xml;
}

watch([categoryId, editProductId], () => {
  if (!schemaModel.value) offerCurrentDraft();
});

watch([subject, language], () => {
  productPage.value = 1;
});

watch(
  () => categories.data.value,
  (items) => {
    if (items) categoryTree.value = mergeCategoryRoots(categoryTree.value, items);
  },
  { immediate: true }
);

onMounted(() => {
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
        ['publisher', '商品发布/编辑'],
        ['organization', '类目与分组'],
        ['quality', '质量与上下架']
      ] as const"
      :key="item[0]"
      :variant="workspace === item[0] ? 'default' : 'outline'"
      role="tab"
      :aria-selected="workspace === item[0]"
      @click="workspace = item[0]"
      >{{ item[1] }}</Button
    >
  </div>

  <p v-if="feedback" class="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
    {{ feedback }}
  </p>

  <template v-if="workspace === 'list'">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="relative min-w-64 max-w-md flex-1">
        <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input v-model="subject" class="pl-9" placeholder="按标题搜索" />
      </div>
      <Button @click="startNewProduct">发布新商品</Button>
    </div>
    <QueryState :loading="products.isPending.value" :error="products.error.value">
      <DataTable
        :columns="columns"
        :data="products.data.value?.items ?? []"
        v-model:page="productPage"
        v-model:page-size="productPageSize"
        :total-rows="products.data.value?.total ?? 0"
        :pagination-disabled="products.isFetching.value"
        empty-text="没有匹配商品"
        min-width="960px"
      />
    </QueryState>
  </template>

  <template v-else-if="workspace === 'publisher'">
    <Card class="mb-5 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">{{ editProductId ? '编辑已有商品' : '发布新商品' }}</h2>
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
          {{
            new Date(draftCandidate.updatedAtUtc).toLocaleString('zh-CN')
          }}。请选择后再继续，不会静默覆盖平台表单。
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
    <p v-if="productMutationHistory.error.value" class="mb-4 text-sm text-destructive">
      {{ errorMessage(productMutationHistory.error.value) }}
    </p>

    <ProductEditorWizard
      v-if="schemaModel"
      v-model:mode="editorMode"
      v-model:step="editorStep"
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
      @update-field="updateRootField"
      @image-status="updateImageStatus"
      @refresh-score="productScore.mutate(editScoreProductId)"
      @submit="submitProduct"
    />
    <p v-if="publish.error.value" class="mt-3 text-sm text-destructive">
      {{ errorMessage(publish.error.value) }}
    </p>
  </template>

  <template v-else-if="workspace === 'organization'">
    <div class="grid gap-5 lg:grid-cols-2">
      <Card class="p-5">
        <h2 class="font-semibold">类目树与映射</h2>
        <select v-model="categoryId" class="mt-4 h-9 w-full rounded-md border bg-background px-3 text-sm">
          <option v-for="category in categoryOptions" :key="category.id" :value="String(category.id)">
            {{ '—'.repeat(category.depth) }} {{ category.name }}
          </option>
        </select>
        <Button class="mt-3" variant="outline" @click="categoryMapping.mutate()">查询新类目映射</Button>
        <p v-if="categoryMapping.data.value" class="mt-3 text-sm">
          {{ categoryMapping.data.value.sourceCategoryId }} →
          <strong>{{ categoryMapping.data.value.targetCategoryId }}</strong>
        </p>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">商品分组</h2>
        <ul class="my-4 space-y-2 text-sm">
          <li v-for="group in groups.data.value ?? []" :key="group.id" class="rounded-md bg-muted p-2">
            {{ group.name }} <span class="text-muted-foreground">#{{ group.id }}</span>
          </li>
        </ul>
        <label class="mb-3 block text-sm">
          <span class="text-muted-foreground">上级分组</span>
          <select
            v-model="groupParentId"
            class="mt-1 h-9 w-full cursor-pointer rounded-md border bg-background px-3 text-sm"
          >
            <option value="-1">一级分组</option>
            <option v-for="group in groups.data.value ?? []" :key="group.id" :value="String(group.id)">
              {{ group.name }}
            </option>
          </select>
        </label>
        <div class="flex gap-2">
          <Input v-model="groupName" aria-label="新分组名称" placeholder="新分组名称" />
          <Button
            :disabled="!groupName.trim() || productGroupMutationDisabled || createGroup.isPending.value"
            @click="submitProductGroup"
            >创建</Button
          >
        </div>
        <p v-if="productGroupMutationDisabled" class="mt-2 text-xs text-amber-700 dark:text-amber-400">
          当前环境尚未开放真实商品分组新增。
        </p>
        <p v-if="createGroup.error.value" class="mt-2 text-xs text-destructive">
          {{ errorMessage(createGroup.error.value) }}
        </p>
      </Card>
    </div>
  </template>

  <template v-else>
    <Card class="mb-5 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">批量上下架</h2>
          <p class="mt-1 text-sm text-muted-foreground">已选 {{ selectedProductIds.length }} 个商品</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex rounded-md border border-border p-0.5" aria-label="质量视图">
            <Button
              size="sm"
              :variant="qualityViewMode === 'cards' ? 'secondary' : 'ghost'"
              :aria-pressed="qualityViewMode === 'cards'"
              @click="qualityViewMode = 'cards'"
            >
              <LayoutGrid class="size-4" />卡片
            </Button>
            <Button
              size="sm"
              :variant="qualityViewMode === 'list' ? 'secondary' : 'ghost'"
              :aria-pressed="qualityViewMode === 'list'"
              @click="qualityViewMode = 'list'"
            >
              <List class="size-4" />列表
            </Button>
          </div>
          <Button
            :disabled="
              !selectedProductIds.length ||
              productDisplayMutationDisabled ||
              selectedProductMissingEncryptedId ||
              selectedDisplayMutationBlocked ||
              batchDisplay.isPending.value
            "
            @click="submitBatchDisplay('online')"
            >批量上架</Button
          >
          <Button
            variant="outline"
            :disabled="
              !selectedProductIds.length ||
              productDisplayMutationDisabled ||
              selectedProductMissingEncryptedId ||
              selectedDisplayMutationBlocked ||
              batchDisplay.isPending.value
            "
            @click="submitBatchDisplay('offline')"
            >批量下架</Button
          >
        </div>
      </div>
      <p v-if="productDisplayMutationDisabled" class="mt-3 text-xs text-amber-700 dark:text-amber-400">
        当前环境尚未开放真实商品上下架。
      </p>
      <p v-else-if="selectedProductMissingEncryptedId" class="mt-3 text-xs text-destructive">
        选中的商品缺少平台混淆 ID，不能执行上下架。
      </p>
      <p v-else-if="selectedDisplayMutationBlocked" class="mt-3 text-xs text-amber-700 dark:text-amber-400">
        选中的商品仍有未完成或待恢复的上下架任务，请先确认任务状态。
      </p>
      <p v-if="batchDisplay.error.value" class="mt-3 text-xs text-destructive">
        {{ errorMessage(batchDisplay.error.value) }}
      </p>
    </Card>
    <Card v-if="latestDisplayMutationJobs.length" class="mb-5 p-5">
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
      <p v-if="refreshDisplayMutation.error.value" class="mt-3 text-xs text-destructive">
        {{ errorMessage(refreshDisplayMutation.error.value) }}
      </p>
      <p v-if="recoverDisplayMutation.error.value" class="mt-3 text-xs text-destructive">
        {{ errorMessage(recoverDisplayMutation.error.value) }}
      </p>
    </Card>
    <QueryState :loading="products.isPending.value" :error="products.error.value">
      <DataTable
        v-if="qualityViewMode === 'list'"
        :data="products.data.value?.items ?? []"
        :columns="qualityColumns"
        v-model:page="productPage"
        v-model:page-size="productPageSize"
        :total-rows="products.data.value?.total ?? 0"
        :pagination-disabled="products.isFetching.value"
        empty-text="暂无商品"
      />
      <div v-else class="overflow-hidden rounded-lg border">
        <div class="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
          <Card
            v-for="product in products.data.value?.items ?? []"
            :key="product.id"
            class="p-4"
            :aria-label="`商品质量 ${product.subject}`"
          >
            <div class="flex items-start gap-3">
              <input
                type="checkbox"
                :aria-label="`选择 ${product.subject}`"
                :checked="selectedProductIds.includes(product.id)"
                @change="toggleProduct(product.id, ($event.target as HTMLInputElement).checked)"
              />
              <div class="min-w-0 flex-1">
                <p class="font-medium">{{ product.subject }}</p>
                <p class="mt-1 text-xs text-muted-foreground">{{ product.id }}</p>
              </div>
              <Badge :variant="statusVariant(product.status)">{{ product.status }}</Badge>
            </div>
            <div class="mt-4 space-y-3">
              <ScoreProgress
                v-if="scoreForProduct(product)"
                label="产品分"
                :value="scoreForProduct(product)?.score ?? 0"
                :max="5"
              />
              <div v-else class="flex items-center justify-between gap-3 text-sm">
                <span class="text-muted-foreground">产品分</span>
                <span>未查询</span>
              </div>
              <ScoreProgress v-if="product.score > 0" label="质量分" :value="product.score" :max="100" />
              <ul
                v-if="scoreForProduct(product)?.issues.length"
                class="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-400"
              >
                <li v-for="issue in scoreForProduct(product)?.issues ?? []" :key="issue">{{ issue }}</li>
              </ul>
              <p v-if="scoreErrorForProduct(product)" class="text-xs text-destructive">
                产品分查询失败：{{ scoreErrorForProduct(product) }}
              </p>
              <Button
                size="sm"
                variant="outline"
                class="w-full"
                :disabled="!product.encryptedId || isProductScorePending(product)"
                @click="queryProductScore(product)"
                >{{ isProductScorePending(product) ? '查询中…' : '查询产品分' }}</Button
              >
            </div>
          </Card>
        </div>
        <TablePagination
          v-model:page="productPage"
          v-model:page-size="productPageSize"
          :total="products.data.value?.total ?? 0"
          :disabled="products.isFetching.value"
        />
      </div>
    </QueryState>
  </template>
</template>
