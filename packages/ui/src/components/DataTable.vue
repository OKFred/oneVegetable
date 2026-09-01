<script setup lang="ts" generic="TData extends RowData">
import { computed, ref, watch } from 'vue';
import { FlexRender, useTable, type PaginationState, type RowData, type Updater } from '@tanstack/vue-table';

import { dataTableFeatures, type DataColumn, type DataTableColumnMeta } from '../lib/table';
import TablePagination from './TablePagination.vue';

const props = withDefaults(
  defineProps<{
    columns: DataColumn<TData>[];
    data: TData[];
    emptyText?: string;
    maxHeight?: string;
    minWidth?: string;
    getRowKey?: ((row: TData) => string) | null;
    activeRowKey?: string | null | undefined;
    rowAriaLabel?: ((row: TData) => string) | null;
    pagination?: boolean;
    page?: number;
    pageSize?: number;
    totalRows?: number | null;
    pageSizeOptions?: readonly number[];
    paginationDisabled?: boolean;
  }>(),
  {
    emptyText: '暂无数据',
    maxHeight: 'min(60vh, 640px)',
    minWidth: '720px',
    getRowKey: null,
    activeRowKey: null,
    rowAriaLabel: null,
    pagination: true,
    page: 1,
    pageSize: 10,
    totalRows: null,
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
const manualPagination = computed(() => !props.pagination || props.totalRows !== null);
const internalPagination = ref<PaginationState>({ pageIndex: 0, pageSize: props.pageSize });
const paginationState = computed<PaginationState>(() =>
  props.totalRows === null
    ? internalPagination.value
    : { pageIndex: Math.max(0, props.page - 1), pageSize: props.pageSize }
);
const tableState = computed(() => ({ pagination: paginationState.value }));
const rowCount = computed(() => Math.max(0, props.totalRows ?? data.value.length));

function updatePagination(updater: Updater<PaginationState>): void {
  const next = typeof updater === 'function' ? updater(paginationState.value) : updater;
  if (props.totalRows !== null) {
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
  if (props.totalRows === null && internalPagination.value.pageIndex !== 0) {
    internalPagination.value = { ...internalPagination.value, pageIndex: 0 };
  }
});

watch(
  () => props.pageSize,
  (pageSize) => {
    if (props.totalRows === null && pageSize !== internalPagination.value.pageSize) {
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

function columnMeta(value: unknown): DataTableColumnMeta | undefined {
  return value && typeof value === 'object' ? value : undefined;
}

function stickyColumnClasses(value: unknown, header: boolean): string[] {
  const meta = columnMeta(value);
  if (!meta?.sticky) return [];
  return [
    'sticky',
    header ? 'z-20 bg-muted' : 'z-[5] bg-inherit',
    meta.stickyBoundary && meta.sticky === 'left' ? 'shadow-[2px_0_3px_-2px_hsl(var(--border))]' : '',
    meta.stickyBoundary && meta.sticky === 'right' ? 'shadow-[-2px_0_3px_-2px_hsl(var(--border))]' : ''
  ];
}

function stickyColumnStyle(value: unknown): Record<string, string> | undefined {
  const meta = columnMeta(value);
  if (!meta?.sticky) return undefined;
  const style: Record<string, string> = {
    [meta.sticky]: meta.stickyOffset ?? '0px'
  };
  if (meta.width) {
    style.width = meta.width;
    style.minWidth = meta.width;
    style.maxWidth = meta.width;
  }
  return style;
}
</script>

<template>
  <div class="max-w-full overflow-hidden rounded-lg border">
    <div class="relative max-w-full overflow-auto" :style="{ maxHeight }">
      <table class="w-full text-sm" :style="{ minWidth }">
        <thead
          class="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]"
        >
          <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              class="h-10 whitespace-nowrap px-4 font-medium"
              :class="stickyColumnClasses(header.column.columnDef.meta, true)"
              :style="stickyColumnStyle(header.column.columnDef.meta)"
            >
              <FlexRender v-if="!header.isPlaceholder" :header="header" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            class="border-t bg-background hover:bg-muted"
            :class="[
              rowAriaLabel
                ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                : '',
              activeRowKey !== undefined && rowKey(row.original) === activeRowKey ? 'bg-accent' : ''
            ]"
            :tabindex="rowAriaLabel ? 0 : undefined"
            :aria-label="rowAriaLabel?.(row.original)"
            @click="activateRow(row.original, $event)"
            @keydown.enter.prevent="activateRow(row.original, $event)"
            @keydown.space.prevent="activateRow(row.original, $event)"
          >
            <td
              v-for="cell in row.getAllCells()"
              :key="cell.id"
              class="px-4 py-3 align-middle"
              :class="stickyColumnClasses(cell.column.columnDef.meta, false)"
              :style="stickyColumnStyle(cell.column.columnDef.meta)"
            >
              <FlexRender :cell="cell" />
            </td>
          </tr>
          <tr v-if="table.getRowModel().rows.length === 0">
            <td :colspan="columns.length" class="h-32 text-center text-muted-foreground">
              <slot name="empty">
                {{ emptyText }}
              </slot>
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
    >
      <template #summary-extra>
        <slot name="pagination-summary" />
      </template>
    </TablePagination>
  </div>
</template>
