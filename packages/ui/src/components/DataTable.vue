<script setup lang="ts" generic="TData extends RowData">
import { computed, ref, watch } from 'vue';
import { FlexRender, useTable, type PaginationState, type RowData, type Updater } from '@tanstack/vue-table';

import { dataTableFeatures, type DataColumn } from '../lib/table';
import TablePagination from './TablePagination.vue';

const props = withDefaults(
  defineProps<{
    columns: DataColumn<TData>[];
    data: TData[];
    emptyText?: string;
    maxHeight?: string;
    minWidth?: string;
    getRowKey?: (row: TData) => string;
    activeRowKey?: string | undefined;
    rowAriaLabel?: (row: TData) => string;
    pagination?: boolean;
    page?: number;
    pageSize?: number;
    totalRows?: number;
    pageSizeOptions?: readonly number[];
    paginationDisabled?: boolean;
  }>(),
  {
    pagination: true,
    page: 1,
    pageSize: 10,
    pageSizeOptions: () => [10, 20, 50],
    paginationDisabled: false
  }
);
const emit = defineEmits<{
  rowActivate: [row: TData];
  'update:page': [page: number];
  'update:pageSize': [pageSize: number];
}>();
const data = computed(() => props.data);
const manualPagination = computed(() => !props.pagination || props.totalRows !== undefined);
const internalPagination = ref<PaginationState>({ pageIndex: 0, pageSize: props.pageSize });
const paginationState = computed<PaginationState>(() =>
  props.totalRows === undefined
    ? internalPagination.value
    : { pageIndex: Math.max(0, props.page - 1), pageSize: props.pageSize }
);
const tableState = computed(() => ({ pagination: paginationState.value }));
const rowCount = computed(() => Math.max(0, props.totalRows ?? data.value.length));

function updatePagination(updater: Updater<PaginationState>): void {
  const next = typeof updater === 'function' ? updater(paginationState.value) : updater;
  if (props.totalRows !== undefined) {
    if (next.pageSize !== props.pageSize) emit('update:pageSize', next.pageSize);
    if (next.pageIndex + 1 !== props.page) emit('update:page', next.pageIndex + 1);
    return;
  }
  internalPagination.value = next;
}

const table = useTable<typeof dataTableFeatures, TData>({
  features: dataTableFeatures,
  data,
  columns: props.columns,
  state: tableState,
  onPaginationChange: updatePagination,
  manualPagination,
  rowCount,
  autoResetPageIndex: false
});
const currentPage = computed(() => table.atoms.pagination.get().pageIndex + 1);
const currentPageSize = computed(() => table.atoms.pagination.get().pageSize);

watch(data, () => {
  if (props.totalRows === undefined && internalPagination.value.pageIndex !== 0) {
    internalPagination.value = { ...internalPagination.value, pageIndex: 0 };
  }
});

watch(
  () => props.pageSize,
  (pageSize) => {
    if (props.totalRows === undefined && pageSize !== internalPagination.value.pageSize) {
      internalPagination.value = { pageIndex: 0, pageSize };
    }
  }
);

function rowKey(row: TData): string | undefined {
  return props.getRowKey?.(row);
}

function activateRow(row: TData, event: MouseEvent | KeyboardEvent): void {
  if (!props.rowAriaLabel) return;
  if (
    event instanceof MouseEvent &&
    event.target instanceof Element &&
    event.target.closest('button, a, input, select, textarea, [role="button"]')
  ) {
    return;
  }
  emit('rowActivate', row);
}

function setPage(page: number): void {
  table.setPageIndex(page - 1);
}

function setPageSize(pageSize: number): void {
  table.setPageSize(pageSize);
}
</script>

<template>
  <div class="max-w-full overflow-hidden rounded-lg border">
    <div class="relative max-w-full overflow-auto" :style="{ maxHeight: maxHeight ?? 'min(60vh, 640px)' }">
      <table class="w-full text-sm" :style="{ minWidth: minWidth ?? '720px' }">
        <thead
          class="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]"
        >
          <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              class="h-10 whitespace-nowrap px-4 font-medium"
            >
              <FlexRender v-if="!header.isPlaceholder" :header="header" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            class="border-t hover:bg-muted/40"
            :class="[
              rowAriaLabel
                ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                : '',
              activeRowKey !== undefined && rowKey(row.original) === activeRowKey ? 'bg-accent/70' : ''
            ]"
            :tabindex="rowAriaLabel ? 0 : undefined"
            :aria-label="rowAriaLabel?.(row.original)"
            @click="activateRow(row.original, $event)"
            @keydown.enter.prevent="activateRow(row.original, $event)"
            @keydown.space.prevent="activateRow(row.original, $event)"
          >
            <td v-for="cell in row.getAllCells()" :key="cell.id" class="px-4 py-3 align-middle">
              <FlexRender :cell="cell" />
            </td>
          </tr>
          <tr v-if="table.getRowModel().rows.length === 0">
            <td :colspan="columns.length" class="h-32 text-center text-muted-foreground">
              {{ emptyText ?? '暂无数据' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <TablePagination
      v-if="pagination"
      :page="currentPage"
      :page-size="currentPageSize"
      :total="rowCount"
      :page-size-options="pageSizeOptions"
      :disabled="paginationDisabled"
      @update:page="setPage"
      @update:page-size="setPageSize"
    />
  </div>
</template>
