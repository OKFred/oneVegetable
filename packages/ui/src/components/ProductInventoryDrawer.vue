<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Product, ProductInventorySnapshot } from '@one-vegetable/core';
import type { DataColumn } from '../lib/table';
import { useInventoryI18n } from '../i18n/inventory';
import { formatDateTime } from '../lib/date-time';
import Sheet from './ui/Sheet.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import DataTable from './DataTable.vue';
import ErrorNotice from './ErrorNotice.vue';
const props = defineProps<{
  product: Product | null;
  snapshot?: ProductInventorySnapshot | undefined;
  busy: boolean;
  error?: unknown;
  source: 'product' | 'sku';
}>();
const emit = defineEmits<{ close: []; refresh: []; source: [source: 'product' | 'sku'] }>();
const it = useInventoryI18n();
const search = ref('');
const rows = computed(() =>
  (props.snapshot?.records ?? []).filter(
    (row) =>
      !search.value.trim() ||
      [row.skuId, row.skuOuterId, row.inventoryCode].some((value) =>
        value?.toLowerCase().includes(search.value.trim().toLowerCase())
      )
  )
);
const columns = computed<DataColumn<ProductInventorySnapshot['records'][number]>[]>(() =>
  (['skuId', 'skuOuterId', 'inventoryCode', 'inventory'] as const).map((key) => ({
    id: key,
    header: it(key === 'inventory' ? 'quantity' : key),
    cell: ({ row }) => row.original[key] ?? '—'
  }))
);
</script>
<template>
  <Sheet
    :open="!!product"
    :title="it('title')"
    :description="product?.subject"
    @update:open="!$event && emit('close')"
  >
    <template #toolbar>
      <div class="flex flex-wrap items-center gap-3">
        <label class="text-sm"
          >{{ it('source') }}
          <select
            :value="source"
            :disabled="busy"
            class="ml-2 rounded border bg-background p-2 text-foreground"
            @change="emit('source', ($event.target as HTMLSelectElement).value === 'sku' ? 'sku' : 'product')"
          >
            <option value="product">{{ it('product') }}</option>
            <option value="sku">{{ it('sku') }}</option>
          </select>
        </label>
        <Button variant="outline" :disabled="busy" @click="emit('refresh')">{{ it('refresh') }}</Button>
        <a
          v-if="product?.detailUrl"
          :href="product.detailUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-primary underline"
          >{{ it('link') }}</a
        >
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground">{{ product?.id }}</p>
      <p class="text-sm text-muted-foreground">{{ it('note') }}</p>
      <p aria-live="polite">{{ busy ? it('loading') : snapshot ? it(snapshot.status) : it('pending') }}</p>
      <ErrorNotice v-if="error && !snapshot" :error="error" compact />
      <template v-if="snapshot">
        <p class="text-xs tabular-nums">
          {{ it('queried') }}: {{ formatDateTime(snapshot.queriedAt) }} · {{ it('trace') }}:
          {{ snapshot.traceId || '—' }}
        </p>
        <p v-if="snapshot.status === 'failed'" class="text-destructive">
          {{ it('businessError') }} {{ snapshot.reasonCode }}
        </p>
        <details v-if="snapshot.issues.length" class="text-sm">
          <summary class="cursor-pointer">{{ it('issues') }} ({{ snapshot.issues.length }})</summary>
          <ul>
            <li v-for="issue in snapshot.issues" :key="issue">{{ issue }}</li>
          </ul>
        </details>
        <Input v-model="search" :placeholder="it('search')" :aria-label="it('search')" />
        <DataTable :columns="columns" :data="rows" :empty-text="it('no-data')" min-width="540px" />
        <p class="text-xs text-muted-foreground">{{ it('zeroNote') }}</p>
      </template>
    </div>
  </Sheet>
</template>
