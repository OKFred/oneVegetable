<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { RefreshCw } from '@lucide/vue';
import type { Product, ProductInventoryRequest, ProductInventorySnapshot } from '@one-vegetable/core';
import type { DataColumn } from '../lib/table';
import { useInventoryI18n } from '../i18n/inventory';
import { formatDateTime } from '../lib/date-time';
import Sheet from './ui/Sheet.vue';
import ListActionButton from './ListActionButton.vue';
import Input from './ui/Input.vue';
import DataTable from './DataTable.vue';
import ErrorNotice from './ErrorNotice.vue';
import PlatformReadbackNotice from './PlatformReadbackNotice.vue';
const props = defineProps<{
  product: Product | null;
  snapshot?: ProductInventorySnapshot | undefined;
  busy: boolean;
  error?: unknown;
  source: ProductInventoryRequest['source'];
}>();
const emit = defineEmits<{ close: []; refresh: []; source: [source: ProductInventoryRequest['source']] }>();
const it = useInventoryI18n();
const search = ref('');
const evidence = computed(() => props.snapshot?.quantityEvidence ?? []);
const availableCount = computed(() => evidence.value.filter((row) => row.status === 'available').length);
const snapshotState = computed(() => {
  const snapshot = props.snapshot;
  if (snapshot?.source === 'absolute' && !['failed', 'drift'].includes(snapshot.status))
    return availableCount.value ? 'evidenceReady' : 'noQuantity';
  return snapshot?.status ?? 'pending';
});
function changeSource(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'product' || value === 'sku' || value === 'absolute') emit('source', value);
}
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
type QuantityEvidence = NonNullable<ProductInventorySnapshot['quantityEvidence']>[number];
const evidenceColumns = computed<DataColumn<QuantityEvidence>[]>(() => [
  {
    id: 'scope',
    header: it('scope'),
    cell: ({ row }) => it(row.original.scope === 'spu' ? 'spuScope' : 'skuScope')
  },
  { id: 'skuId', header: it('skuId'), cell: ({ row }) => row.original.skuId ?? '—' },
  {
    id: 'quantity',
    header: it('quantity'),
    cell: ({ row }) => (row.original.status === 'available' ? row.original.quantity : '—')
  },
  { id: 'status', header: it('evidenceStatus'), cell: ({ row }) => it(row.original.status) },
  {
    id: 'reason',
    header: it('evidenceReason'),
    cell: ({ row }) =>
      h(
        'span',
        { title: row.original.reasonCode ?? undefined },
        it(
          row.original.status === 'available'
            ? 'quantityReturned'
            : row.original.reasonCode === 'QUANTITY_MISSING'
              ? 'quantityMissing'
              : 'quantityUnavailable'
        )
      )
  }
]);
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
            data-testid="inventory-drawer-source"
            :disabled="busy"
            class="ml-2 rounded border bg-background p-2 text-foreground"
            @change="changeSource"
          >
            <option value="product">{{ it('product') }}</option>
            <option value="sku">{{ it('sku') }}</option>
            <option value="absolute">{{ it('absolute') }}</option>
          </select>
        </label>
        <ListActionButton :icon="RefreshCw" :disabled="busy" @click="emit('refresh')">{{
          it('refresh')
        }}</ListActionButton>
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
      <p class="text-sm text-muted-foreground">{{ it(source === 'absolute' ? 'absoluteNote' : 'note') }}</p>
      <PlatformReadbackNotice kind="inventory" />
      <p aria-live="polite">
        {{ it(busy ? 'loading' : error ? 'failed' : snapshotState) }}
      </p>
      <ErrorNotice v-if="error" :error="error" compact />
      <p v-if="error && snapshot" class="text-sm text-muted-foreground">{{ it('previousSnapshot') }}</p>
      <template v-if="snapshot">
        <p class="text-xs tabular-nums">
          {{ it('queried') }}: {{ formatDateTime(snapshot.queriedAt) }} · {{ it('trace') }}:
          {{ snapshot.traceId || '—' }}
          · {{ it('protocol') }}: {{ snapshot.protocol?.toUpperCase() ?? '—' }}
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
        <template v-if="snapshot.source === 'absolute'">
          <p data-testid="inventory-evidence-count" class="text-sm">
            {{ it('evidenceCount', { available: availableCount, total: evidence.length }) }}
          </p>
          <DataTable
            :columns="evidenceColumns"
            :data="evidence"
            :get-row-key="(row) => JSON.stringify([row.scope, row.skuId, evidence.indexOf(row)])"
            column-settings-key="inventory-quantity-evidence"
            :empty-text="it('noQuantity')"
            min-width="640px"
          />
        </template>
        <template v-else>
          <Input v-model="search" :placeholder="it('search')" :aria-label="it('search')" />
          <DataTable
            :columns="columns"
            :data="rows"
            :get-row-key="
              (row) =>
                JSON.stringify([row.skuId, row.skuOuterId, row.inventoryCode, snapshot?.records.indexOf(row)])
            "
            column-settings-key="inventory-skus"
            :empty-text="it('no-data')"
            min-width="540px"
          />
        </template>
        <p class="text-xs text-muted-foreground">{{ it('zeroNote') }}</p>
      </template>
    </div>
  </Sheet>
</template>
