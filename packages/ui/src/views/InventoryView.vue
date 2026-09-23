<script setup lang="ts">
import { computed, defineAsyncComponent, h, ref, shallowRef, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { RefreshCw, Search, Square } from '@lucide/vue';
import type { Product } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { useGalleryTransfers } from '../lib/gallery-transfer-service';
import { useProductInventory } from '../lib/product-inventory';
import { detailErrorState } from '../lib/page-details';
import { useInventoryI18n } from '../i18n/inventory';
import { useUiI18n } from '../i18n';
import { productStatusLabel } from '../lib/product-status';
import { formatDateTime } from '../lib/date-time';
import type { DataColumn } from '../lib/table';
import {
  emptyProductListFilters,
  filterCurrentPageProducts,
  productFilterPayload
} from '../composables/product-list-filters';
import ProductListFilterDialog from '../components/ProductListFilterDialog.vue';
import ListActionButton from '../components/ListActionButton.vue';
import ListToolbar from '../components/ListToolbar.vue';
import DataTable from '../components/DataTable.vue';
import PageHeader from '../components/PageHeader.vue';
import QueryState from '../components/QueryState.vue';
import Button from '../components/ui/Button.vue';
import Input from '../components/ui/Input.vue';
const ProductInventoryDrawer = defineAsyncComponent(() => import('../components/ProductInventoryDrawer.vue'));
const { gateway, mode } = useServices();
const { alibabaLanguage: language } = useAppPreferences();
const { t } = useUiI18n();
const it = useInventoryI18n();
const context = useGalleryTransfers()?.currentContext;
const searchDraft = ref('');
const subject = ref('');
const filters = ref(emptyProductListFilters());
const page = ref(1);
const pageSize = ref(20);
const identity = computed(() => JSON.stringify([context?.value?.identity, context?.value?.gateway]));
const query = useQuery({
  queryKey: ['products', 'inventory-workspace', subject, filters, page, pageSize, language, identity],
  queryFn: () =>
    gateway.request('listProducts', {
      page: page.value,
      pageSize: pageSize.value,
      subject: subject.value,
      language: language.value,
      ...productFilterPayload(filters.value)
    })
});
const rows = computed(() => filterCurrentPageProducts(query.data.value?.items ?? [], filters.value));
const boundary = computed(() =>
  JSON.stringify([subject.value, filters.value, page.value, pageSize.value, language.value, identity.value])
);
const inventory = useProductInventory(gateway, mode, language, rows, boundary);
const selectedRows = shallowRef<Product[]>([]);
const queryDisabled = computed(() => inventory.busy.value || query.isFetching.value);
const hasFailed = computed(() => Object.values(inventory.states.value).includes('failed'));
watch([boundary, rows], () => {
  selectedRows.value = [];
});
watch([subject, filters, language, identity], () => {
  page.value = 1;
});
function search(): void {
  const nextSubject = searchDraft.value.trim();
  if (subject.value === nextSubject && page.value === 1) {
    void query.refetch();
    return;
  }
  subject.value = nextSubject;
  page.value = 1;
}
function inventoryState(id: string) {
  const state = inventory.states.value[id];
  if (state === 'loading') return 'loading';
  const snapshot = inventory.snapshots.value[id];
  if (state === 'failed') {
    if (snapshot?.status === 'drift') return 'drift';
    return detailErrorState(inventory.errors.value[id]);
  }
  return snapshot?.status ?? 'pending';
}
function openInventory(product: Product): void {
  if (queryDisabled.value) return;
  inventory.selected.value = product;
}
function queryInventory(onlySelected = false, onlyFailed = false): void {
  if (queryDisabled.value) return;
  const targets = onlySelected
    ? rows.value.filter((row) => selectedRows.value.some((selected) => selected.id === row.id))
    : rows.value;
  if (targets.length) void inventory.load(onlyFailed, targets);
}
const columns = computed<DataColumn<Product>[]>(() => [
  {
    id: 'subject',
    header: t('products.view.columns.product'),
    cell: ({ row }) =>
      h('div', { class: 'max-w-md' }, [
        h('p', { class: 'line-clamp-2', title: row.original.subject }, row.original.subject),
        h('p', { class: 'text-xs text-muted-foreground' }, row.original.id)
      ])
  },
  {
    id: 'status',
    header: t('products.view.columns.status'),
    cell: ({ row }) => productStatusLabel(row.original.status),
    meta: { width: '120px' }
  },
  {
    id: 'inventoryState',
    header: it('inventoryState'),
    cell: ({ row }) => {
      const state = inventoryState(row.original.id);
      const label = state === 'pending' ? it('pendingQuery') : it(state);
      return h(
        Button,
        {
          variant: 'ghost',
          size: 'sm',
          class: 'text-primary underline underline-offset-4',
          disabled: queryDisabled.value,
          'aria-label': it('rowQuery', { product: row.original.id, status: label }),
          onClick: () => {
            openInventory(row.original);
          }
        },
        () => label
      );
    }
  },
  {
    id: 'inventoryRecordCount',
    header: it('inventoryRecordCount'),
    cell: ({ row }) => inventory.snapshots.value[row.original.id]?.records.length ?? '—'
  },
  {
    id: 'inventoryQueriedAt',
    header: it('inventoryQueriedAt'),
    cell: ({ row }) => {
      const snapshot = inventory.snapshots.value[row.original.id];
      return snapshot ? formatDateTime(snapshot.queriedAt) : '—';
    }
  },
  {
    id: 'actions',
    header: t('products.view.columns.actions'),
    cell: ({ row }) =>
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          disabled: queryDisabled.value,
          onClick: () => {
            openInventory(row.original);
          }
        },
        () => t('products.inventoryWorkspace.open')
      ),
    meta: { sticky: 'right', width: '112px' }
  }
]);
</script>
<template>
  <PageHeader :title="it('title')" :description="t('products.inventoryWorkspace.description')" />
  <p class="mb-2 text-xs text-muted-foreground">{{ it('note') }}</p>
  <ListToolbar data-testid="inventory-toolbar" @search="search">
    <template #search>
      <Input
        v-model="searchDraft"
        class="min-w-0 flex-1"
        :aria-label="t('products.view.page.search')"
        :placeholder="t('products.view.page.search')"
      />
      <ListActionButton :icon="Search" type="submit" class="shrink-0" :disabled="query.isFetching.value">{{
        t('products.filters.search')
      }}</ListActionButton>
    </template>
    <template #actions>
      <ListActionButton :icon="Search" :disabled="queryDisabled || !rows.length" @click="queryInventory()">{{
        it('pageQuery')
      }}</ListActionButton>
      <ListActionButton
        :icon="Search"
        :disabled="queryDisabled || !selectedRows.length"
        @click="queryInventory(true)"
      >
        {{ it('batch') }} ({{ selectedRows.length }})
      </ListActionButton>
      <label class="flex items-center gap-2 text-sm">
        {{ it('source') }}
        <select
          v-model="inventory.source.value"
          :disabled="queryDisabled"
          class="h-9 rounded border bg-background px-2 text-foreground"
        >
          <option value="product">{{ it('product') }}</option>
          <option value="sku">{{ it('sku') }}</option>
        </select>
      </label>
      <ListActionButton
        v-if="hasFailed"
        :icon="RefreshCw"
        :disabled="queryDisabled"
        @click="queryInventory(false, true)"
      >
        {{ it('retry') }}
      </ListActionButton>
      <ListActionButton v-if="inventory.busy.value" :icon="Square" @click="inventory.stop()">{{
        it('stop')
      }}</ListActionButton>
      <span v-if="inventory.busy.value" role="status" class="text-sm tabular-nums">
        {{ it('progress', { done: inventory.done.value, total: inventory.total.value }) }}
      </span>
      <ProductListFilterDialog v-model="filters" />
    </template>
  </ListToolbar>
  <QueryState :loading="query.isPending.value" :error="query.error.value" retryable @retry="query.refetch()">
    <DataTable
      :columns="columns"
      :data="rows"
      :get-row-key="(row) => row.id"
      column-settings-key="inventory-products"
      :selection-scope="boundary"
      :page="page"
      :page-size="pageSize"
      :page-size-options="[10, 20, 30]"
      :total-rows="query.data.value?.total ?? 0"
      :empty-text="t(filters.status ? 'products.filters.pageEmpty' : 'products.view.page.noMatch')"
      :pagination-disabled="query.isFetching.value"
      @selection-change="selectedRows = $event"
      @update:page="page = $event"
      @update:page-size="
        pageSize = Math.min(30, $event);
        page = 1;
      "
    />
  </QueryState>
  <ProductInventoryDrawer
    v-if="inventory.selected.value"
    :product="inventory.selected.value"
    :snapshot="inventory.snapshots.value[inventory.selected.value.id]"
    :error="inventory.errors.value[inventory.selected.value.id]"
    :busy="inventory.busy.value"
    :source="inventory.source.value"
    @close="
      inventory.selected.value = null;
      inventory.stop();
    "
    @refresh="inventory.refreshSelected"
    @source="inventory.source.value = $event"
  />
</template>
