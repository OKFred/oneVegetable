<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { BarChart3, Building2, CalendarRange, RefreshCw, ShieldAlert } from '@lucide/vue';

import type { InsightsSupplierProduct } from '@one-vegetable/core';

import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import TablePagination from '../components/TablePagination.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import Card from '../components/ui/Card.vue';
import Input from '../components/ui/Input.vue';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type Workspace = 'performance' | 'suppliers' | 'partner';

const { gateway, mode } = useServices();
const workspace = ref<Workspace>('performance');
const selectedSupplierId = ref('');
const dateStart = ref('');
const dateEnd = ref('');
const supplierPage = ref(1);
const supplierPageSize = ref(10);
const supplierProductPage = ref(1);
const supplierProductPageSize = ref(20);

const rank = useQuery({
  queryKey: ['insights-supplier-rank'],
  enabled: computed(() => workspace.value === 'performance'),
  queryFn: () => gateway.request('getInsightsSupplierRank', undefined)
});
const suppliers = useQuery({
  queryKey: ['insights-suppliers', supplierPage, supplierPageSize],
  enabled: computed(() => workspace.value === 'suppliers'),
  queryFn: () =>
    gateway.request('listInsightsSuppliers', {
      page: supplierPage.value,
      pageSize: supplierPageSize.value
    })
});
const supplierProducts = useQuery({
  queryKey: computed(() => [
    'insights-supplier-products',
    selectedSupplierId.value,
    dateStart.value,
    dateEnd.value,
    supplierProductPage.value,
    supplierProductPageSize.value
  ]),
  enabled: computed(() => workspace.value === 'suppliers' && selectedSupplierId.value !== ''),
  queryFn: () =>
    gateway.request('listInsightsSupplierProducts', {
      supplierId: selectedSupplierId.value,
      page: supplierProductPage.value,
      pageSize: supplierProductPageSize.value,
      ...(dateStart.value ? { dateStart: new Date(`${dateStart.value}T00:00:00.000Z`).toISOString() } : {}),
      ...(dateEnd.value ? { dateEnd: new Date(`${dateEnd.value}T23:59:59.999Z`).toISOString() } : {})
    })
});

const maxRankPercent = computed(() =>
  Math.max(1, ...(rank.data.value?.items.map((item) => item.percent) ?? []))
);

function selectSupplier(id: string): void {
  selectedSupplierId.value = id;
}

watch([supplierPage, supplierPageSize], () => {
  selectedSupplierId.value = '';
  supplierProductPage.value = 1;
});

watch([selectedSupplierId, dateStart, dateEnd], () => {
  supplierProductPage.value = 1;
});

function formatPublishedAt(value: string | null): string {
  if (!value) return '文档未返回';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
}

const productColumns: DataColumn<InsightsSupplierProduct>[] = [
  {
    accessorKey: 'subject',
    header: '历史采购商品',
    cell: ({ row }) =>
      h('div', { class: 'min-w-64' }, [
        h('p', { class: 'font-medium' }, row.original.subject),
        h('p', { class: 'mt-1 line-clamp-2 text-xs text-muted-foreground' }, row.original.description)
      ])
  },
  {
    accessorKey: 'id',
    header: '商品 ID',
    cell: (context) => h('code', { class: 'text-xs' }, context.getValue<string>())
  },
  {
    accessorKey: 'categoryId',
    header: '类目 ID',
    cell: (context) => h('code', { class: 'text-xs' }, context.getValue<string>())
  },
  {
    id: 'price',
    header: '历史价格区间',
    cell: ({ row }) => row.original.priceRange ?? '未返回'
  },
  {
    accessorKey: 'publishedAt',
    header: '发布时间',
    cell: (context) => formatPublishedAt(context.getValue<string | null>())
  }
];

const workspaces: { id: Workspace; label: string }[] = [
  { id: 'performance', label: '经营排名' },
  { id: 'suppliers', label: '采购供应商' },
  { id: 'partner', label: '合作方能力' }
];
</script>

<template>
  <PageHeader
    title="数据与供应商洞察"
    description="整合供应商全站排名和历史信保采购关系；原始响应只在适配层转换，长 ID 不转为 JavaScript number。"
  />
  <Card class="mb-4 flex items-start gap-3 border-blue-200 bg-blue-50 p-4 text-blue-950">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <p class="text-sm leading-5">
      本页结果仅按官方字段展示，不把排名百分比解释成官方经营诊断，也不推断供应商质量。采购供应商接口需要买家授权身份；没有真实账号时仅验证契约
      Mock。
    </p>
  </Card>

  <div class="mb-4 flex flex-wrap gap-2" aria-label="洞察工作区">
    <Button
      v-for="item in workspaces"
      :key="item.id"
      size="sm"
      :variant="workspace === item.id ? 'default' : 'outline'"
      @click="workspace = item.id"
    >
      {{ item.label }}
    </Button>
  </div>

  <template v-if="workspace === 'performance'">
    <div class="grid gap-4 xl:grid-cols-[0.65fr_1.35fr]">
      <Card class="p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm text-muted-foreground">最新全站排名百分比</p>
            <p class="mt-2 text-4xl font-semibold">
              {{ rank.data.value?.latestPercent ?? '—' }}<span class="ml-1 text-lg">%</span>
            </p>
          </div>
          <BarChart3 class="size-8 text-primary" />
        </div>
        <p class="mt-4 text-xs leading-5 text-muted-foreground">
          官方仅返回日期与 percent，没有定义趋势含义。本项目保留原值，不生成“提升”“下降”或评级结论。
        </p>
        <Button variant="outline" class="mt-4" :disabled="rank.isFetching.value" @click="rank.refetch()">
          <RefreshCw class="size-4" />刷新
        </Button>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">排名时间序列</h2>
        <QueryState :loading="rank.isPending.value" :error="rank.error.value">
          <div class="mt-5 space-y-3">
            <div
              v-for="item in rank.data.value?.items ?? []"
              :key="item.statDate"
              class="grid grid-cols-[6rem_1fr_4rem] items-center gap-3 text-sm"
            >
              <span class="font-mono text-xs text-muted-foreground">{{ item.statDate }}</span>
              <div class="h-3 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${Math.max(2, (item.percent / maxRankPercent) * 100)}%` }"
                />
              </div>
              <span class="text-right font-medium">{{ item.percent }}%</span>
            </div>
            <p v-if="!rank.data.value?.items.length" class="text-sm text-muted-foreground">暂无排名数据。</p>
          </div>
        </QueryState>
      </Card>
    </div>
  </template>

  <template v-else-if="workspace === 'suppliers'">
    <div class="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
      <Card class="p-5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Building2 class="size-4 text-primary" />
            <h2 class="font-semibold">历史信保供应商</h2>
          </div>
          <Badge variant="outline">{{ suppliers.data.value?.total ?? 0 }} 个</Badge>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">官方仅返回加密供应商 ID，不补造公司名称。</p>
        <QueryState :loading="suppliers.isPending.value" :error="suppliers.error.value">
          <div class="mt-4 overflow-hidden rounded-lg border">
            <div class="space-y-2 p-2">
              <button
                v-for="supplierId in suppliers.data.value?.supplierIds ?? []"
                :key="supplierId"
                class="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm hover:bg-accent"
                :class="selectedSupplierId === supplierId ? 'border-primary bg-accent' : ''"
                @click="selectSupplier(supplierId)"
              >
                <code class="break-all text-xs">{{ supplierId }}</code
                ><span aria-hidden="true">→</span>
              </button>
            </div>
            <TablePagination
              v-model:page="supplierPage"
              v-model:page-size="supplierPageSize"
              :total="suppliers.data.value?.total ?? 0"
              :disabled="suppliers.isFetching.value"
            />
          </div>
        </QueryState>
      </Card>
      <div>
        <Card class="mb-4 p-4">
          <div class="flex items-center gap-2">
            <CalendarRange class="size-4 text-primary" />
            <p class="text-sm font-medium">历史下单时间筛选</p>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="space-y-1 text-sm"
              ><span>开始日期</span><Input v-model="dateStart" type="date"
            /></label>
            <label class="space-y-1 text-sm"
              ><span>结束日期</span><Input v-model="dateEnd" type="date"
            /></label>
          </div>
        </Card>
        <Card v-if="!selectedSupplierId" class="p-8 text-center text-sm text-muted-foreground">
          从左侧选择一个加密供应商 ID 查看曾经下过订单的商品。
        </Card>
        <template v-else>
          <p class="mb-3 text-xs text-muted-foreground">
            当前供应商：<code>{{ selectedSupplierId }}</code>
          </p>
          <QueryState :loading="supplierProducts.isPending.value" :error="supplierProducts.error.value">
            <DataTable
              :columns="productColumns"
              :data="supplierProducts.data.value?.items ?? []"
              v-model:page="supplierProductPage"
              v-model:page-size="supplierProductPageSize"
              :total-rows="supplierProducts.data.value?.total ?? 0"
              :pagination-disabled="supplierProducts.isFetching.value"
              empty-text="暂无历史采购商品"
              min-width="840px"
            />
          </QueryState>
        </template>
      </div>
    </div>
  </template>

  <template v-else>
    <Card class="max-w-3xl p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">CGS 小满签约客户数据查询</h2>
          <code class="mt-2 block text-xs text-muted-foreground">alibaba.mydata.self.query.cgsokk</code>
        </div>
        <Badge variant="warning">默认关闭</Badge>
      </div>
      <p class="mt-4 text-sm leading-6 text-muted-foreground">
        官方标记为免费且不需要用户授权，但接口名称和说明限定 CGS 小满签约客户，请求还要求独立业务
        <code>app_secret</code>。因此本项目只保留类型、Mock
        和审计记录，不提供调用表单，也不会把密钥放入页面或普通设置。
      </p>
      <p class="mt-3 text-xs text-muted-foreground">
        {{
          mode === 'mock'
            ? 'Mock 模式也不模拟真实企业数据。'
            : '扩展 service worker 会在通用调试入口阻止该方法。'
        }}
      </p>
    </Card>
  </template>
</template>
