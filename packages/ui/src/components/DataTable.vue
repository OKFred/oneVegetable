<script setup lang="ts" generic="TData extends RowData">
import { computed } from 'vue';
import { FlexRender, useTable, type RowData } from '@tanstack/vue-table';

import { dataTableFeatures, type DataColumn } from '../lib/table';

const props = defineProps<{ columns: DataColumn<TData>[]; data: TData[]; emptyText?: string }>();
const data = computed(() => props.data);
const table = useTable<typeof dataTableFeatures, TData>({
  features: dataTableFeatures,
  data,
  columns: props.columns
});
</script>

<template>
  <div class="overflow-hidden rounded-lg border">
    <table class="w-full text-sm">
      <thead class="bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
        <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
          <th v-for="header in headerGroup.headers" :key="header.id" class="h-10 px-4 font-medium">
            <FlexRender v-if="!header.isPlaceholder" :header="header" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in table.getRowModel().rows" :key="row.id" class="border-t hover:bg-muted/40">
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
</template>
