import { tableFeatures, type ColumnDef, type RowData } from '@tanstack/vue-table';

export const dataTableFeatures = tableFeatures({});
export type DataColumn<TData extends RowData> = ColumnDef<typeof dataTableFeatures, TData>;
