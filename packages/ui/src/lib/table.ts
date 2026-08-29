import {
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  type ColumnDef,
  type RowData
} from '@tanstack/vue-table';

export const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel()
});

export interface DataTableColumnMeta {
  sticky?: 'left' | 'right';
  stickyOffset?: string;
  stickyBoundary?: boolean;
  width?: string;
}

export type DataColumn<TData extends RowData> = ColumnDef<typeof dataTableFeatures, TData> & {
  meta?: DataTableColumnMeta;
};
