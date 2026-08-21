<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Layers3, LayoutGrid, List, RefreshCw, Search } from '@lucide/vue';

import {
  analyzeProductDescriptionQuality,
  collectProductSchemaOfficialHints,
  createProductScoreOfficialHints,
  inspectProductSchemaSerialization,
  parseProductSchemaXml,
  validateProductSchemaRenderInput,
  validateSchemaPublishInput,
  type Product,
  type ProductCategory,
  type ProductDescriptionImageMetadata,
  type ProductSchemaOfficialHint,
  type ProductSchemaModel,
  type ProductScore
} from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
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

const { gateway, mode, operationAvailability } = useServices();
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
const imageMetadata = ref<Record<string, ProductDescriptionImageMetadata>>({});
const categorySearch = ref('');
const qualityViewMode = ref<QualityViewMode>('cards');
const productScores = ref<Record<string, ProductScore>>({});
const productScoreErrors = ref<Record<string, string>>({});
const pendingProductScoreId = ref('');
let scoreRefreshTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let draftSaveTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
const sourceIsLocalDraft = ref(false);

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
  queryKey: ['product-categories'],
  queryFn: () => gateway.request('listProductCategories', {})
});
const groups = useQuery({
  queryKey: ['product-groups'],
  queryFn: () => gateway.request('listProductGroups', undefined)
});
const productMutationAvailability = useQuery({
  queryKey: ['product-mutation-availability'],
  queryFn: () =>
    operationAvailability?.get(['saveProductDraft', 'publishProduct', 'updateProduct']) ??
    Promise.resolve({ items: [] }),
  enabled: computed(() => mode === 'bff' && operationAvailability !== undefined),
  staleTime: 10_000
});

const categoryOptions = computed(() => flattenCategories(categories.data.value ?? []));
const filteredCategoryOptions = computed(() => {
  const query = categorySearch.value.trim().toLocaleLowerCase();
  return query
    ? categoryOptions.value.filter(
        (category) => category.name.toLocaleLowerCase().includes(query) || String(category.id).includes(query)
      )
    : categoryOptions.value;
});
const realMutationDisabled = computed(() => mode !== 'mock');
const availabilityByOperation = computed(
  () =>
    new Map(
      (productMutationAvailability.data.value?.items ?? []).map((item) => [item.operation, item] as const)
    )
);
const platformDraftDisabled = computed(() => {
  if (mode === 'mock') return false;
  return availabilityByOperation.value.get('saveProductDraft')?.allowed !== true;
});
const productPublishDisabled = computed(() => {
  if (mode === 'mock') return false;
  const operation = editProductId.value ? 'updateProduct' : 'publishProduct';
  return availabilityByOperation.value.get(operation)?.allowed !== true;
});
const platformDraftDisabledReason = computed(() =>
  mutationDisabledReason('saveProductDraft', '当前环境未开放平台草稿写入')
);
const productPublishDisabledReason = computed(() =>
  mutationDisabledReason(
    editProductId.value ? 'updateProduct' : 'publishProduct',
    editProductId.value ? '当前环境未开放商品更新' : '当前环境未开放正式发布'
  )
);

const publish = useMutation({
  mutationFn: async (draft: boolean) => {
    if (!schemaModel.value) throw new Error('请先获取商品 Schema');
    if (draft && platformDraftId.value) {
      throw new Error('平台草稿已创建；后续修改已自动保存到本机，不会重复创建平台草稿');
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
    if (editProductId.value) {
      return gateway.request('updateProduct', { ...base, productId: editProductId.value });
    }
    return draft ? gateway.request('saveProductDraft', base) : gateway.request('publishProduct', base);
  },
  onSuccess: async (result, draft) => {
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
  mutationFn: () => gateway.request('createProductGroup', { name: groupName.value }),
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
const batchDisplay = useMutation({
  mutationFn: (display: 'online' | 'offline') =>
    gateway.request('updateProductDisplay', { productIds: selectedProductIds.value, display }),
  onSuccess: async (_result, display) => {
    feedback.value = `${selectedProductIds.value.length} 个商品已${display === 'online' ? '上架' : '下架'}`;
    selectedProductIds.value = [];
    await queryClient.invalidateQueries({ queryKey: ['products'] });
  }
});

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

async function selectProductForSchema(product: Product): Promise<void> {
  cancelDraftSave();
  draftCandidate.value = null;
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
  if (product.categoryId !== null) await loadSchema();
}

function startNewProduct(): void {
  cancelDraftSave();
  draftCandidate.value = null;
  resetEditorSession({ mode: 'quick' });
  editScoreProductId.value = '';
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
  const parsedCategoryId = await resolveCategoryId();
  if (parsedCategoryId === null) {
    schemaError.value = '请先选择有效类目';
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

async function resolveCategoryId(): Promise<number | null> {
  if (!categoryId.value) {
    const result = await categories.refetch();
    const options = flattenCategories(result.data ?? []);
    const preferred = options.find((category) => category.leaf) ?? options[0];
    if (preferred) categoryId.value = String(preferred.id);
  }
  const parsed = Number(categoryId.value);
  return categoryId.value && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function renderExistingProductSchema(parsedCategoryId: number) {
  const request = {
    categoryId: parsedCategoryId,
    language: language.value,
    productId: editProductId.value
  };
  const validation = validateProductSchemaRenderInput(request);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  return gateway.request('renderProductSchema', request);
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

watch(categoryOptions, (options) => {
  if (categoryId.value || options.length === 0) return;
  const preferred = options.find((category) => category.leaf) ?? options[0];
  if (preferred) categoryId.value = String(preferred.id);
});

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
      <div class="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <label class="text-sm font-medium">
          搜索类目
          <Input v-model="categorySearch" class="mt-2" placeholder="输入类目名称或 ID" />
        </label>
        <label class="text-sm font-medium">
          商品类目
          <select v-model="categoryId" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option
              v-for="category in filteredCategoryOptions"
              :key="category.id"
              :value="String(category.id)"
            >
              {{ '—'.repeat(category.depth) }} {{ category.name }}
            </option>
          </select>
        </label>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button @click="loadSchema">
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
      @submit="publish.mutate($event)"
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
        <div class="flex gap-2">
          <Input v-model="groupName" aria-label="新分组名称" placeholder="新分组名称" />
          <Button :disabled="!groupName || realMutationDisabled" @click="createGroup.mutate()">创建</Button>
        </div>
        <p v-if="realMutationDisabled" class="mt-2 text-xs text-amber-700">
          当前真实模式中的分组写操作尚未解锁。
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
            :disabled="!selectedProductIds.length || realMutationDisabled"
            @click="batchDisplay.mutate('online')"
            >批量上架</Button
          >
          <Button
            variant="outline"
            :disabled="!selectedProductIds.length || realMutationDisabled"
            @click="batchDisplay.mutate('offline')"
            >批量下架</Button
          >
        </div>
      </div>
      <p v-if="realMutationDisabled" class="mt-3 text-xs text-amber-700">
        真实上下架按钮在 smoke test 前保持禁用。
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
