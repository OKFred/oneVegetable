<script setup lang="ts" generic="TData extends RowData">
import { computed, h, ref, watch } from 'vue';
import { FlexRender, useTable, type PaginationState, type RowData, type Updater } from '@tanstack/vue-table';

import { dataTableFeatures, type DataColumn, type DataTableColumnMeta } from '../lib/table';
import { useUiI18n } from '../i18n';
import TablePagination from './TablePagination.vue';
import ColumnSettings from './ColumnSettings.vue';
import { useColumnPreferences } from '../lib/column-preferences';
import TriStateCheckbox from './TriStateCheckbox.vue';
import RowActionsMenu from './RowActionsMenu.vue';
import Button from './ui/Button.vue';
import { toast } from 'vue-sonner';

const { t } = useUiI18n();

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
    columnSettingsKey?: string;
    hiddenColumns?: string[];
    lockedColumns?: string[];
    serverPagination?: boolean;
    hasNextPage?: boolean;
    selectionScope?: string;
  }>(),
  {
    emptyText: '',
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
    paginationDisabled: false,
    columnSettingsKey: '',
    hiddenColumns: () => [],
    lockedColumns: () => [],
    serverPagination: false,
    hasNextPage: false,
    selectionScope: ''
  }
);
const emit = defineEmits<{
  rowActivate: [row: TData];
  'update:page': [page: number];
  'update:pageSize': [pageSize: number];
  'visible-columns-change': [ids: string[]];
  'selection-change': [rows: TData[]];
}>();
const data = computed(() => props.data);
const selectedKeys = ref<string[]>([]);
const ownsSelection = computed(() => !props.columns.some((column) => columnId(column) === 'select'));
function identifier(row: TData): string | null {
  if (props.getRowKey) return props.getRowKey(row);
  if (typeof row !== 'object') return null;
  for (const key of ['id', 'requestId', 'productId', 'fileId', 'method', 'skuId']) {
    if (key in row) {
      const value: unknown = Reflect.get(row, key);
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
  }
  return null;
}
function selectionKey(row: TData, fallback: string): string {
  return identifier(row) ?? fallback;
}
function selectRows(keys: string[]): void {
  selectedKeys.value = keys;
  emit(
    'selection-change',
    table
      .getRowModel()
      .rows.filter((row) => keys.includes(selectionKey(row.original, row.id)))
      .map((row) => row.original)
  );
}
async function copyIdentifier(row: TData): Promise<void> {
  const id = identifier(row);
  if (!id) return;
  try {
    await globalThis.navigator.clipboard.writeText(id);
    toast.success(t('common.actions.copied'));
  } catch {
    toast.error(t('common.error.copyFailed'));
  }
}
const allColumns = computed<DataColumn<TData>[]>(() => {
  const columns = [...props.columns];
  if (ownsSelection.value)
    columns.unshift({
      id: 'select',
      header: () => {
        const keys = table.getRowModel().rows.map((row) => selectionKey(row.original, row.id));
        const count = keys.filter((key) => selectedKeys.value.includes(key)).length;
        return h(TriStateCheckbox, {
          checked: keys.length > 0 && count === keys.length,
          indeterminate: count > 0 && count < keys.length,
          disabled: keys.length === 0,
          label: t('common.data.selectPage'),
          'onUpdate:checked': (checked: boolean) => {
            selectRows(checked ? keys : []);
          }
        });
      },
      cell: ({ row }) =>
        h(TriStateCheckbox, {
          checked: selectedKeys.value.includes(selectionKey(row.original, row.id)),
          label: t('common.data.selectRow', { name: identifier(row.original) ?? String(row.index + 1) }),
          'onUpdate:checked': (checked: boolean) => {
            const key = selectionKey(row.original, row.id);
            selectRows(
              checked ? [...selectedKeys.value, key] : selectedKeys.value.filter((item) => item !== key)
            );
          }
        })
    });
  if (!columns.some((column) => columnId(column) === 'actions'))
    columns.push({
      id: 'actions',
      header: t('common.actions.title'),
      cell: ({ row }) =>
        h(
          Button,
          {
            variant: 'ghost',
            size: 'sm',
            disabled: !identifier(row.original),
            onClick: () => {
              void copyIdentifier(row.original);
            }
          },
          () => t('common.actions.copyId')
        )
    });
  return columns;
});
function columnId(column: DataColumn<TData>): string {
  return column.id ?? ('accessorKey' in column ? String(column.accessorKey) : '');
}
const columnOptions = computed(() =>
  allColumns.value.map((column) => ({
    id: columnId(column),
    label: typeof column.header === 'string' ? column.header : t('common.columns.selection'),
    locked: ['select', 'actions'].includes(columnId(column)),
    defaultVisible: !props.hiddenColumns.includes(columnId(column))
  }))
);
const columnPreferences = useColumnPreferences(props.columnSettingsKey, columnOptions);
const visibleColumns = computed(() => {
  const columns = columnPreferences.order.value.flatMap((id) =>
    columnPreferences.visible.value.includes(id)
      ? allColumns.value.filter((column) => columnId(column) === id)
      : []
  );
  const result: DataColumn<TData>[] = columns.map((column) => {
    if (columnId(column) === 'select')
      return {
        ...column,
        meta: { sticky: 'left', stickyOffset: '0px', width: '56px', stickyBoundary: true }
      };
    if (columnId(column) === 'actions')
      return {
        ...column,
        meta: { sticky: 'right', stickyOffset: '0px', width: '112px', stickyBoundary: true }
      };
    const { sticky: _sticky, stickyOffset: _offset, stickyBoundary: _boundary, ...meta } = column.meta ?? {};
    return { ...column, meta };
  });
  // A flexible presentation-only column absorbs spare width when every business
  // column is bounded. Otherwise the table algorithm stretches pinned/title cells.
  if (result.some((column) => column.meta?.maxWidth) && result.every((column) => column.meta?.width)) {
    const right = result.findIndex((column) => column.meta?.sticky === 'right');
    result.splice(right < 0 ? result.length : right, 0, {
      id: '__layout_filler',
      header: () => null,
      cell: () => null
    });
  }
  return result;
});
const boundedLayout = computed(() => visibleColumns.value.some((column) => column.meta?.maxWidth));
watch(
  () => visibleColumns.value.map(columnId),
  (ids) => {
    emit('visible-columns-change', ids);
  },
  { immediate: true }
);
const tableMinimumWidth = computed(() => {
  if (!boundedLayout.value) return props.minWidth;
  const pixels = visibleColumns.value.reduce((total, column) => {
    if (column.id === '__layout_filler') return total;
    const width = column.meta?.width;
    return total + (width && /^\d+(?:\.\d+)?px$/u.test(width) ? Number.parseFloat(width) : 192);
  }, 0);
  return `max(${props.minWidth}, ${pixels}px)`;
});
const isServerPagination = computed(() => props.serverPagination || props.totalRows !== null);
const manualPagination = computed(() => !props.pagination || isServerPagination.value);
const internalPagination = ref<PaginationState>({ pageIndex: 0, pageSize: props.pageSize });
const paginationState = computed<PaginationState>(() =>
  !isServerPagination.value
    ? internalPagination.value
    : { pageIndex: Math.max(0, props.page - 1), pageSize: props.pageSize }
);
const tableState = computed(() => ({ pagination: paginationState.value }));
const rowCount = computed(() => Math.max(0, props.totalRows ?? data.value.length));

function updatePagination(updater: Updater<PaginationState>): void {
  const next = typeof updater === 'function' ? updater(paginationState.value) : updater;
  if (isServerPagination.value) {
    if (next.pageSize !== props.pageSize) emit('update:pageSize', next.pageSize);
    if (next.pageIndex + 1 !== props.page) emit('update:page', next.pageIndex + 1);
    return;
  }
  internalPagination.value = next;
}

const table = useTable<typeof dataTableFeatures, TData>({
  features: dataTableFeatures,
  data,
  columns: visibleColumns,
  state: tableState,
  onPaginationChange: updatePagination,
  manualPagination,
  rowCount,
  autoResetPageIndex: false
});
const currentPage = computed(() => table.atoms.pagination.get().pageIndex + 1);
const currentPageSize = computed(() => table.atoms.pagination.get().pageSize);

watch(data, () => {
  if (ownsSelection.value) selectRows([]);
  if (!isServerPagination.value && internalPagination.value.pageIndex !== 0) {
    internalPagination.value = { ...internalPagination.value, pageIndex: 0 };
  }
});

watch(
  () => props.pageSize,
  (pageSize) => {
    if (!isServerPagination.value && pageSize !== internalPagination.value.pageSize) {
      internalPagination.value = { pageIndex: 0, pageSize };
    }
  }
);
watch(
  () => [currentPage.value, currentPageSize.value, props.selectionScope],
  () => {
    if (ownsSelection.value) selectRows([]);
  }
);

function rowKey(row: TData): string | undefined {
  return props.getRowKey?.(row);
}

function activateRow(row: TData, event: MouseEvent | KeyboardEvent): void {
  if (!props.rowAriaLabel) return;
  if (
    event.target instanceof Element &&
    event.target !== event.currentTarget &&
    event.target.closest('button, a, input, select, textarea, [role="button"]')
  ) {
    return;
  }
  if (event instanceof KeyboardEvent) event.preventDefault();
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
  if (!meta) return undefined;
  const style: Record<string, string> = {};
  if (meta.sticky) style[meta.sticky] = meta.stickyOffset ?? '0px';
  if (meta.width) {
    style.width = meta.width;
    style.minWidth = meta.width;
    style.maxWidth = meta.width;
  }
  if (meta.maxWidth) {
    style.maxWidth = meta.maxWidth;
    if (meta.width) style.width = `min(${meta.width}, ${meta.maxWidth})`;
    delete style.minWidth;
  }
  return style;
}
</script>

<template>
  <div class="max-w-full overflow-hidden rounded-lg border" style="container-type: inline-size">
    <div class="relative max-w-full overflow-auto" :style="{ maxHeight }">
      <table
        class="w-full text-sm"
        :style="{ minWidth: tableMinimumWidth, tableLayout: boundedLayout ? 'fixed' : undefined }"
      >
        <thead
          class="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]"
        >
          <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              :aria-hidden="header.column.id === '__layout_filler' ? true : undefined"
              class="h-10 whitespace-nowrap px-4 font-medium"
              :class="stickyColumnClasses(header.column.columnDef.meta, true)"
              :style="stickyColumnStyle(header.column.columnDef.meta)"
            >
              <span class="inline-flex items-center gap-1">
                <FlexRender v-if="!header.isPlaceholder" :header="header" />
                <ColumnSettings
                  v-if="
                    columnSettingsKey &&
                    (header.column.id === 'actions' ||
                      (!columnOptions.some((column) => column.id === 'actions') &&
                        header === headerGroup.headers.at(-1)))
                  "
                  :options="columnPreferences.orderedOptions.value"
                  :visible="columnPreferences.visible.value"
                  :persistence-failed="columnPreferences.persistenceFailed.value"
                  @toggle="columnPreferences.toggle"
                  @reset="columnPreferences.reset"
                  @set-all="columnPreferences.setAll"
                  @move="columnPreferences.move"
                  @move-by="columnPreferences.moveBy"
                />
              </span>
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
            @keydown.enter="activateRow(row.original, $event)"
            @keydown.space="activateRow(row.original, $event)"
          >
            <td
              v-for="cell in row.getAllCells()"
              :key="cell.id"
              :aria-hidden="cell.column.id === '__layout_filler' ? true : undefined"
              class="px-4 py-3 align-middle"
              :class="stickyColumnClasses(cell.column.columnDef.meta, false)"
              :style="stickyColumnStyle(cell.column.columnDef.meta)"
            >
              <RowActionsMenu
                v-if="cell.column.id === 'actions'"
                :label="t('common.actions.row', { name: identifier(row.original) ?? String(row.index + 1) })"
                ><FlexRender :cell="cell"
              /></RowActionsMenu>
              <FlexRender v-else :cell="cell" />
            </td>
          </tr>
          <tr v-if="table.getRowModel().rows.length === 0">
            <td :colspan="visibleColumns.length" class="h-32 text-center text-muted-foreground">
              <slot name="empty">
                {{ emptyText || t('common.data.empty') }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <slot name="column-actions" :visible="columnPreferences.visible.value" />
    <TablePagination
      v-if="pagination"
      :page="currentPage"
      :page-size="currentPageSize"
      :total="isServerPagination ? totalRows : rowCount"
      :has-next-page="hasNextPage"
      :page-size-options="pageSizeOptions"
      :disabled="paginationDisabled"
      @update:page="setPage"
      @update:page-size="setPageSize"
    >
      <template #summary-extra>
        <span v-if="ownsSelection" class="text-xs text-muted-foreground" aria-live="polite">{{
          t('common.data.selected', { count: selectedKeys.length })
        }}</span>
        <slot name="pagination-summary" />
      </template>
    </TablePagination>
    <p v-else-if="ownsSelection" class="border-t px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
      {{ t('common.data.selected', { count: selectedKeys.length }) }}
    </p>
  </div>
</template>
