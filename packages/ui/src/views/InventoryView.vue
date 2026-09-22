<script setup lang="ts">
import { computed, defineAsyncComponent, h, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Search } from '@lucide/vue';
import type { Product } from '@one-vegetable/core';
import { useServices } from '../lib/services';
import { useAppPreferences } from '../lib/preferences';
import { useGalleryTransfers } from '../lib/gallery-transfer-service';
import { useProductInventory } from '../lib/product-inventory';
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
    cell: ({ row }) =>
      inventory.states.value[row.original.id] === 'loading'
        ? it('loading')
        : it(inventory.snapshots.value[row.original.id]?.status ?? 'pending')
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
          onClick: () => {
            inventory.selected.value = row.original;
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
  <form class="flex flex-wrap items-center gap-2 rounded-t-lg border border-b-0 p-2" @submit.prevent="search">
    <Input
      v-model="searchDraft"
      class="w-48 max-w-full sm:w-56"
      :aria-label="t('products.view.page.search')"
      :placeholder="t('products.view.page.search')"
    />
    <Button type="submit" variant="outline" :disabled="query.isFetching.value"
      ><Search class="size-4" />{{ t('products.filters.search') }}</Button
    >
    <ProductListFilterDialog v-model="filters" />
  </form>
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
