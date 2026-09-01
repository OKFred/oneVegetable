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
import { useUiI18n } from '../i18n';
import { formatDate } from '../lib/date-time';
import { useServices } from '../lib/services';
import type { DataColumn } from '../lib/table';

type Workspace = 'performance' | 'suppliers' | 'partner';

const { gateway, mode } = useServices();
const { t } = useUiI18n();
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

const productColumns = computed<DataColumn<InsightsSupplierProduct>[]>(() => [
  {
    accessorKey: 'subject',
    header: t('insights.columns.product'),
    cell: ({ row }) =>
      h('div', { class: 'min-w-64' }, [
        h('p', { class: 'font-medium' }, row.original.subject),
        h('p', { class: 'mt-1 line-clamp-2 text-xs text-muted-foreground' }, row.original.description)
      ])
  },
  {
    accessorKey: 'id',
    header: t('insights.columns.productId'),
    cell: (context) => h('code', { class: 'text-xs' }, context.getValue<string>())
  },
  {
    accessorKey: 'categoryId',
    header: t('insights.columns.categoryId'),
    cell: (context) => h('code', { class: 'text-xs' }, context.getValue<string>())
  },
  {
    id: 'price',
    header: t('insights.columns.price'),
    cell: ({ row }) => row.original.priceRange ?? t('insights.notReturned')
  },
  {
    accessorKey: 'publishedAt',
    header: t('insights.columns.publishedAt'),
    cell: (context) => {
      const value = context.getValue<string | null>();
      return formatDate(value, value ?? t('insights.documentNotReturned'));
    }
  }
]);

const workspaces = computed<{ id: Workspace; label: string }[]>(() => [
  { id: 'performance', label: t('insights.workspaces.performance') },
  { id: 'suppliers', label: t('insights.workspaces.suppliers') },
  { id: 'partner', label: t('insights.workspaces.partner') }
]);
</script>

<template>
  <PageHeader :title="t('insights.title')" :description="t('insights.description')" />
  <Card class="mb-4 flex items-start gap-3 border-blue-200 bg-blue-50 p-4 text-blue-950">
    <ShieldAlert class="mt-0.5 size-4 shrink-0" />
    <p class="text-sm leading-5">
      {{ t('insights.disclaimer') }}
    </p>
  </Card>

  <div class="mb-4 flex flex-wrap gap-2" :aria-label="t('insights.workspaceLabel')">
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
            <p class="text-sm text-muted-foreground">{{ t('insights.latestRank') }}</p>
            <p class="mt-2 text-4xl font-semibold">
              {{ rank.data.value?.latestPercent ?? '—' }}<span class="ml-1 text-lg">%</span>
            </p>
          </div>
          <BarChart3 class="size-8 text-primary" />
        </div>
        <p class="mt-4 text-xs leading-5 text-muted-foreground">
          {{ t('insights.rankExplanation') }}
        </p>
        <Button variant="outline" class="mt-4" :disabled="rank.isFetching.value" @click="rank.refetch()">
          <RefreshCw class="size-4" />{{ t('common.actions.refresh') }}
        </Button>
      </Card>
      <Card class="p-5">
        <h2 class="font-semibold">{{ t('insights.timeline') }}</h2>
        <QueryState
          :loading="rank.isPending.value"
          :error="rank.error.value"
          retryable
          @retry="rank.refetch()"
        >
          <div class="mt-5 space-y-3">
            <div
              v-for="item in rank.data.value?.items ?? []"
              :key="item.statDate"
              class="grid grid-cols-[6rem_1fr_4rem] items-center gap-3 text-sm"
            >
              <span class="font-mono text-xs text-muted-foreground">{{
                formatDate(item.statDate, item.statDate)
              }}</span>
              <div class="h-3 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${Math.max(2, (item.percent / maxRankPercent) * 100)}%` }"
                />
              </div>
              <span class="text-right font-medium">{{ item.percent }}%</span>
            </div>
            <p v-if="!rank.data.value?.items.length" class="text-sm text-muted-foreground">
              {{ t('insights.noRank') }}
            </p>
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
            <h2 class="font-semibold">{{ t('insights.historicalSuppliers') }}</h2>
          </div>
          <Badge variant="outline">{{
            t('insights.supplierCount', { count: suppliers.data.value?.total ?? 0 })
          }}</Badge>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">{{ t('insights.encryptedOnly') }}</p>
        <QueryState
          :loading="suppliers.isPending.value"
          :error="suppliers.error.value"
          retryable
          @retry="suppliers.refetch()"
        >
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
            <p class="text-sm font-medium">{{ t('insights.dateFilter') }}</p>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="space-y-1 text-sm"
              ><span>{{ t('insights.startDate') }}</span
              ><Input v-model="dateStart" type="date"
            /></label>
            <label class="space-y-1 text-sm"
              ><span>{{ t('insights.endDate') }}</span
              ><Input v-model="dateEnd" type="date"
            /></label>
          </div>
        </Card>
        <Card v-if="!selectedSupplierId" class="p-8 text-center text-sm text-muted-foreground">
          {{ t('insights.selectSupplier') }}
        </Card>
        <template v-else>
          <p class="mb-3 text-xs text-muted-foreground">
            {{ t('insights.currentSupplier') }} <code>{{ selectedSupplierId }}</code>
          </p>
          <QueryState
            :loading="supplierProducts.isPending.value"
            :error="supplierProducts.error.value"
            retryable
            @retry="supplierProducts.refetch()"
          >
            <DataTable
              :columns="productColumns"
              :data="supplierProducts.data.value?.items ?? []"
              v-model:page="supplierProductPage"
              v-model:page-size="supplierProductPageSize"
              :total-rows="supplierProducts.data.value?.total ?? 0"
              :pagination-disabled="supplierProducts.isFetching.value"
              :empty-text="t('insights.noProducts')"
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
          <h2 class="font-semibold">{{ t('insights.partnerTitle') }}</h2>
          <code class="mt-2 block text-xs text-muted-foreground">alibaba.mydata.self.query.cgsokk</code>
        </div>
        <Badge variant="warning">{{ t('insights.disabled') }}</Badge>
      </div>
      <p class="mt-4 text-sm leading-6 text-muted-foreground">
        {{ t('insights.partnerDescription') }}
      </p>
      <p class="mt-3 text-xs text-muted-foreground">
        {{ mode === 'mock' ? t('insights.partnerMock') : t('insights.partnerExtension') }}
      </p>
    </Card>
  </template>
</template>
