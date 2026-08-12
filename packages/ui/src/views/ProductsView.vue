<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Layers3, RefreshCw, Save, Search, Send, ShieldAlert } from '@lucide/vue';

import {
  parseProductSchemaXml,
  serializeProductSchemaXml,
  validateProductSchemaModel,
  validateSchemaPublishInput,
  type Product,
  type ProductCategory,
  type ProductSchemaField,
  type ProductSchemaModel
} from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import ProductSchemaFieldComponent from '../components/ProductSchemaField.vue';
import QueryState from '../components/QueryState.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type Workspace = 'list' | 'publisher' | 'organization' | 'quality';

const DRAFT_STORAGE_KEY = 'one-vegetable-product-schema-draft';
const { gateway, mode } = useServices();
const queryClient = useQueryClient();
const workspace = ref<Workspace>('list');
const subject = ref('');
const categoryId = ref('100009999');
const language = ref('en_US');
const market = ref<'wholesale' | 'sourcing'>('wholesale');
const editProductId = ref('');
const schemaModel = ref<ProductSchemaModel | null>(null);
const schemaError = ref('');
const feedback = ref('');
const draftRestored = ref(false);
const selectedProductIds = ref<string[]>([]);
const groupName = ref('');

const products = useQuery({
  queryKey: ['products', subject],
  queryFn: () => gateway.request('listProducts', { page: 1, pageSize: 20, subject: subject.value })
});
const categories = useQuery({
  queryKey: ['product-categories'],
  queryFn: () => gateway.request('listProductCategories', {})
});
const groups = useQuery({
  queryKey: ['product-groups'],
  queryFn: () => gateway.request('listProductGroups', undefined)
});

const categoryOptions = computed(() => flattenCategories(categories.data.value ?? []));
const schemaIssues = computed(() => (schemaModel.value ? validateProductSchemaModel(schemaModel.value) : []));
const blockingSchemaIssues = computed(() => schemaIssues.value.filter((issue) => issue.severity === 'error'));
const schemaPreview = computed(() => {
  if (!schemaModel.value) return '';
  try {
    return serializeProductSchemaXml(schemaModel.value);
  } catch {
    return '';
  }
});
const extensionMutationDisabled = computed(() => mode === 'extension');

const publish = useMutation({
  mutationFn: async (draft: boolean) => {
    if (!schemaModel.value) throw new Error('请先获取商品 Schema');
    const base = {
      categoryId: Number(categoryId.value),
      language: language.value,
      schemaXml: serializeProductSchemaXml(schemaModel.value)
    };
    const validation = validateSchemaPublishInput(base);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if (blockingSchemaIssues.value.length > 0) throw new Error('请先修正表单中的阻断问题');
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
  mutationFn: (productId: string) => gateway.request('getProductScore', { productId })
});

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
  }
];

function flattenCategories(items: ProductCategory[], depth = 0): (ProductCategory & { depth: number })[] {
  return items.flatMap((item) => [{ ...item, depth }, ...flattenCategories(item.children, depth + 1)]);
}

function applySchema(xml: string, message: string): void {
  try {
    schemaModel.value = parseProductSchemaXml(xml);
    schemaError.value = '';
    feedback.value = message;
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : 'Schema XML 无法解析';
  }
}

async function loadSchema(): Promise<void> {
  schemaError.value = '';
  try {
    const result = await gateway.request('getProductSchema', {
      categoryId: Number(categoryId.value),
      language: language.value,
      market: market.value,
      ...(editProductId.value ? { productId: editProductId.value } : {})
    });
    applySchema(result.xml, '已按当前类目加载官方 Schema');
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : '获取 Schema 失败';
  }
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
      xml: serializeProductSchemaXml(schemaModel.value)
    });
    applySchema(result.xml, '层级属性已根据当前选择刷新');
  } catch (error: unknown) {
    schemaError.value = error instanceof Error ? error.message : '层级属性刷新失败';
  }
}

function updateRootField(index: number, field: ProductSchemaField): void {
  if (!schemaModel.value) return;
  schemaModel.value = {
    ...schemaModel.value,
    fields: schemaModel.value.fields.map((current, currentIndex) =>
      currentIndex === index ? field : current
    )
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

watch(schemaPreview, (xml) => {
  if (xml && 'localStorage' in globalThis) {
    globalThis.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ categoryId: categoryId.value, language: language.value, market: market.value, xml })
    );
  }
});

onMounted(() => {
  if (!('localStorage' in globalThis)) return;
  const stored = globalThis.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!stored) return;
  try {
    const draft = JSON.parse(stored) as unknown;
    if (typeof draft !== 'object' || draft === null || !('xml' in draft)) return;
    const value = draft as Record<string, unknown>;
    if (typeof value.xml !== 'string') return;
    if (typeof value.categoryId === 'string') categoryId.value = value.categoryId;
    if (typeof value.language === 'string') language.value = value.language;
    if (value.market === 'wholesale' || value.market === 'sourcing') market.value = value.market;
    schemaModel.value = parseProductSchemaXml(value.xml);
    draftRestored.value = true;
  } catch {
    globalThis.localStorage.removeItem(DRAFT_STORAGE_KEY);
  }
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
        ['publisher', 'Schema 发品/编辑'],
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
    <div class="mb-4 flex max-w-md items-center gap-2">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input v-model="subject" class="pl-9" placeholder="按标题搜索" />
      </div>
    </div>
    <QueryState :loading="products.isPending.value" :error="products.error.value">
      <DataTable :columns="columns" :data="products.data.value?.items ?? []" empty-text="没有匹配商品" />
    </QueryState>
  </template>

  <template v-else-if="workspace === 'publisher'">
    <Card class="mb-5 p-5">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label class="text-sm font-medium"
          >类目
          <select v-model="categoryId" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option v-for="category in categoryOptions" :key="category.id" :value="String(category.id)">
              {{ '—'.repeat(category.depth) }} {{ category.name }}
            </option>
          </select>
        </label>
        <label class="text-sm font-medium"
          >市场
          <select v-model="market" class="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="wholesale">wholesale</option>
            <option value="sourcing">sourcing</option>
          </select>
        </label>
        <label class="text-sm font-medium">语言<Input v-model="language" class="mt-2" /></label>
        <label class="text-sm font-medium"
          >商品/草稿 ID（编辑时）
          <Input v-model="editProductId" class="mt-2" placeholder="可留空" />
        </label>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button @click="loadSchema"><Layers3 class="size-4" />获取 Schema</Button>
        <Button variant="outline" @click="loadDraft"><RefreshCw class="size-4" />渲染草稿</Button>
        <Button variant="outline" :disabled="!schemaModel" @click="refreshLevelSchema">
          <RefreshCw class="size-4" />刷新层级属性
        </Button>
      </div>
      <p v-if="draftRestored" class="mt-3 text-xs text-muted-foreground">已恢复浏览器中的未提交表单草稿。</p>
      <p v-if="schemaError" class="mt-3 text-sm text-destructive">{{ schemaError }}</p>
    </Card>

    <Card v-if="schemaModel" class="p-5">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">可视化商品 Schema</h2>
          <p class="mt-1 text-xs text-muted-foreground">{{ schemaModel.fields.length }} 个顶层字段</p>
        </div>
        <Badge :variant="blockingSchemaIssues.length ? 'destructive' : 'success'">
          {{ blockingSchemaIssues.length ? `${blockingSchemaIssues.length} 个阻断问题` : '本地规则通过' }}
        </Badge>
      </div>
      <div class="space-y-4">
        <ProductSchemaFieldComponent
          v-for="(field, index) in schemaModel.fields"
          :key="field.key"
          :field="field"
          :issues="schemaIssues"
          @update="updateRootField(index, $event)"
        />
      </div>
      <div v-if="schemaModel.warnings.length" class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        <p class="font-medium">服务端规则提示</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="warning in schemaModel.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>
      <div
        v-if="extensionMutationDisabled"
        class="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
      >
        <ShieldAlert class="mt-0.5 size-4 shrink-0" />真实写操作需逐方法完成账号 smoke
        test，扩展内保持关闭且没有自行开启入口。
      </div>
      <div class="mt-5 flex flex-wrap gap-2">
        <Button
          :disabled="publish.isPending.value || extensionMutationDisabled"
          @click="publish.mutate(false)"
        >
          <Send class="size-4" />{{ editProductId ? '更新商品' : '发布商品' }}
        </Button>
        <Button
          v-if="!editProductId"
          variant="outline"
          :disabled="publish.isPending.value || extensionMutationDisabled"
          @click="publish.mutate(true)"
          ><Save class="size-4" />保存草稿</Button
        >
      </div>
      <p v-if="publish.error.value" class="mt-3 text-sm text-destructive">
        {{ errorMessage(publish.error.value) }}
      </p>
      <details class="mt-5 rounded-lg border p-3">
        <summary class="cursor-pointer text-sm font-medium">高级 XML 预览（只读）</summary>
        <pre
          class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-slate-950 p-3 text-xs text-slate-100"
          >{{ schemaPreview }}</pre>
      </details>
    </Card>
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
          <Button :disabled="!groupName || extensionMutationDisabled" @click="createGroup.mutate()"
            >创建</Button
          >
        </div>
        <p v-if="extensionMutationDisabled" class="mt-2 text-xs text-amber-700">
          扩展中的真实分组写操作尚未解锁。
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
        <div class="flex gap-2">
          <Button
            :disabled="!selectedProductIds.length || extensionMutationDisabled"
            @click="batchDisplay.mutate('online')"
            >批量上架</Button
          >
          <Button
            variant="outline"
            :disabled="!selectedProductIds.length || extensionMutationDisabled"
            @click="batchDisplay.mutate('offline')"
            >批量下架</Button
          >
        </div>
      </div>
      <p v-if="extensionMutationDisabled" class="mt-3 text-xs text-amber-700">
        真实上下架按钮在 smoke test 前保持禁用。
      </p>
    </Card>
    <QueryState :loading="products.isPending.value" :error="products.error.value">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card v-for="product in products.data.value?.items ?? []" :key="product.id" class="p-4">
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
          <div class="mt-4 flex items-center justify-between">
            <span class="text-sm">当前质量分 {{ product.score }}</span
            ><Button size="sm" variant="outline" @click="productScore.mutate(product.id)">重新评分</Button>
          </div>
        </Card>
      </div>
    </QueryState>
    <Card v-if="productScore.data.value" class="mt-5 p-5">
      <h2 class="font-semibold">
        商品 {{ productScore.data.value.productId }}：{{ productScore.data.value.score }} 分
      </h2>
      <ul class="mt-3 list-disc space-y-1 pl-5 text-sm">
        <li v-for="issue in productScore.data.value.issues" :key="issue">{{ issue }}</li>
      </ul>
    </Card>
  </template>
</template>
