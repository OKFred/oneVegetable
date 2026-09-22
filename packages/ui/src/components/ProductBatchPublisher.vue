<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { Pencil, Play, Square, Trash2 } from '@lucide/vue';

import { inspectProductBatchPublishItem } from '../lib/product-batch-publish';
import ActionTooltip from './ActionTooltip.vue';
import DataTable from './DataTable.vue';
import TriStateCheckbox from './TriStateCheckbox.vue';
import type { DataColumn } from '../lib/table';
import PlatformReadbackNotice from './PlatformReadbackNotice.vue';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import { useUiI18n } from '../i18n';

import type {
  ProductBatchPublishItem,
  ProductBatchPublishRunResult,
  ProductBatchPublishTarget
} from '../lib/product-batch-publish';

const props = defineProps<{
  items: ProductBatchPublishItem[];
  selectedIds: string[];
  target: ProductBatchPublishTarget;
  results: Record<string, ProductBatchPublishRunResult>;
  activeItemId: string;
  running: boolean;
  draftAllowed: boolean;
  publishAllowed: boolean;
  draftDisabledReason: string;
  publishDisabledReason: string;
  categoryLabels: Record<string, string>;
}>();

const emit = defineEmits<{
  'update:selectedIds': [ids: string[]];
  'update:target': [target: ProductBatchPublishTarget];
  run: [];
  stop: [];
  edit: [item: ProductBatchPublishItem];
  remove: [item: ProductBatchPublishItem];
}>();
const { locale, t } = useUiI18n();

const page = ref(1);
const pageSize = ref(20);
const pageItems = computed(() =>
  props.items.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
);
const pageQueuedItems = computed(() => pageItems.value.filter((item) => item.status === 'queued'));
watch([page, pageSize], () => {
  emit('update:selectedIds', []);
});
watch(
  () => props.items,
  () => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(props.items.length / pageSize.value)));
  }
);
watch(
  [pageQueuedItems, () => props.selectedIds],
  () => {
    const eligible = new Set(pageQueuedItems.value.map((item) => item.id));
    const next = props.selectedIds.filter((id) => eligible.has(id));
    if (next.length !== props.selectedIds.length) emit('update:selectedIds', next);
  },
  { immediate: true }
);
const selectedQueuedItems = computed(() =>
  pageQueuedItems.value.filter((item) => props.selectedIds.includes(item.id))
);
const currentTargetAllowed = computed(() =>
  props.target === 'draft' ? props.draftAllowed : props.publishAllowed
);
const currentDisabledReason = computed(() =>
  props.target === 'draft' ? props.draftDisabledReason : props.publishDisabledReason
);
const runDisabledReason = computed(() => {
  if (selectedQueuedItems.value.length === 0) return t('products.batch.selectFirst');
  return currentDisabledReason.value || t('products.batch.unavailable');
});
const selectedBlockedCount = computed(
  () =>
    selectedQueuedItems.value.filter(
      (item) => !inspectProductBatchPublishItem(item, props.target, locale.value).ready
    ).length
);
const allQueuedSelected = computed(
  () => pageQueuedItems.value.length > 0 && selectedQueuedItems.value.length === pageQueuedItems.value.length
);

function toggleItem(id: string, checked: boolean): void {
  emit(
    'update:selectedIds',
    checked ? [...new Set([...props.selectedIds, id])] : props.selectedIds.filter((itemId) => itemId !== id)
  );
}

function toggleAll(checked: boolean): void {
  emit('update:selectedIds', checked ? pageQueuedItems.value.map((item) => item.id) : []);
}

function storedStatusLabel(item: ProductBatchPublishItem): string {
  if (item.status === 'draft-saved') return t('products.batch.storedStatus.draft');
  if (item.status === 'published') return t('products.batch.storedStatus.published');
  if (item.status === 'submitting') return t('products.batch.storedStatus.submitting');
  if (item.status === 'verifying') return t('products.batch.storedStatus.verifying');
  if (item.status === 'attention-required') return t('products.batch.storedStatus.attentionRequired');
  return t('products.batch.storedStatus.queued');
}

function runStatusLabel(result: ProductBatchPublishRunResult | undefined): string {
  if (!result) return '';
  if (result.status === 'succeeded') return t('products.batch.runStatus.succeeded');
  if (result.status === 'accepted') return t('products.batch.runStatus.accepted');
  if (result.status === 'failed') return t('products.batch.runStatus.failed');
  if (result.status === 'blocked') return t('products.batch.runStatus.blocked');
  return t('products.batch.runStatus.stopped');
}

function statusVariant(
  item: ProductBatchPublishItem,
  result: ProductBatchPublishRunResult | undefined
): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (result?.status === 'failed' || result?.status === 'blocked') return 'destructive';
  if (result?.status === 'succeeded' || item.status === 'draft-saved' || item.status === 'published') {
    return 'success';
  }
  if (result?.status === 'accepted' || item.status === 'submitting' || item.status === 'verifying') {
    return 'warning';
  }
  if (item.status === 'attention-required') return 'destructive';
  if (props.activeItemId === item.id) return 'warning';
  return 'secondary';
}

const preflight = computed(
  () =>
    new Map(
      props.items.map((item) => [item.id, inspectProductBatchPublishItem(item, props.target, locale.value)])
    )
);
const columns = computed<DataColumn<ProductBatchPublishItem>[]>(() => [
  {
    id: 'select',
    header: () =>
      h(TriStateCheckbox, {
        checked: allQueuedSelected.value,
        indeterminate: selectedQueuedItems.value.length > 0 && !allQueuedSelected.value,
        disabled: props.running || pageQueuedItems.value.length === 0,
        label: t('common.data.selectPage'),
        'onUpdate:checked': toggleAll
      }),
    cell: ({ row }) =>
      h(TriStateCheckbox, {
        checked: props.selectedIds.includes(row.original.id),
        disabled: props.running || row.original.status !== 'queued',
        label: t('products.batch.selectProduct', { title: row.original.title }),
        'onUpdate:checked': (checked: boolean) => {
          toggleItem(row.original.id, checked);
        }
      })
  },
  {
    accessorKey: 'title',
    header: t('products.batch.columns.product'),
    cell: ({ row }) =>
      h('div', { class: 'max-w-80' }, [
        h('p', { class: 'truncate font-medium', title: row.original.title }, row.original.title),
        row.original.platformProductId
          ? h('p', { class: 'mt-1 font-mono text-xs text-muted-foreground' }, row.original.platformProductId)
          : null
      ])
  },
  {
    accessorKey: 'categoryId',
    header: t('products.batch.columns.category'),
    cell: ({ row }) =>
      h('div', {}, [
        h(
          'p',
          { class: 'whitespace-nowrap' },
          props.categoryLabels[row.original.categoryId] ?? t('products.batch.unknownCategory')
        ),
        h('p', { class: 'font-mono text-xs text-muted-foreground' }, row.original.categoryId)
      ])
  },
  { accessorKey: 'language', header: t('products.batch.columns.language') },
  {
    id: 'check',
    header: t('products.batch.columns.check'),
    cell: ({ row }) => {
      if (row.original.status !== 'queued')
        return h('span', { class: 'text-muted-foreground' }, t('products.batch.completed'));
      const check = preflight.value.get(row.original.id);
      return h('div', { class: 'max-w-72' }, [
        h(
          'p',
          { class: check?.ready ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive' },
          check?.ready
            ? t('products.batch.ready')
            : t('products.batch.minimumMissing', { count: check?.blockingIssues.length ?? 0 })
        ),
        check?.schemaIssueCount
          ? h(
              'p',
              { class: 'mt-1 text-xs text-muted-foreground' },
              t('products.batch.advisoryCount', { count: check.schemaIssueCount })
            )
          : null
      ]);
    }
  },
  {
    accessorKey: 'status',
    header: t('products.batch.columns.status'),
    cell: ({ row }) => {
      const item = row.original;
      const result = props.results[item.id];
      const accepted = result?.status === 'accepted' || (!result && item.status === 'verifying');
      const traceId = result?.traceId ?? item.traceId;
      const message = result?.message ?? item.lastError;
      return h('div', { class: 'max-w-80' }, [
        h(Badge, { variant: statusVariant(item, result) }, () =>
          props.activeItemId === item.id
            ? t('products.batch.submitting')
            : runStatusLabel(result) || storedStatusLabel(item)
        ),
        message
          ? h(
              'p',
              { class: 'mt-2 text-xs ' + (accepted ? 'text-muted-foreground' : 'text-destructive') },
              message
            )
          : null,
        result?.status === 'accepted' ||
        (!result && ['verifying', 'attention-required'].includes(item.status))
          ? h(PlatformReadbackNotice, {
              kind: item.status === 'attention-required' ? 'unconfirmed' : 'accepted',
              class: 'mt-2'
            })
          : null,
        traceId
          ? h('p', { class: 'mt-1 break-all font-mono text-xs text-muted-foreground' }, 'traceId ' + traceId)
          : null
      ]);
    }
  },
  {
    id: 'actions',
    header: t('products.batch.columns.actions'),
    cell: ({ row }) =>
      h('div', { class: 'flex gap-2' }, [
        row.original.status === 'queued'
          ? h(
              Button,
              {
                size: 'sm',
                variant: 'outline',
                disabled: props.running,
                onClick: () => {
                  emit('edit', row.original);
                }
              },
              () => [h(Pencil, { class: 'size-4' }), t('products.batch.edit')]
            )
          : null,
        h(
          Button,
          {
            size: 'sm',
            variant: 'ghost',
            disabled: props.running,
            onClick: () => {
              emit('remove', row.original);
            }
          },
          () => [h(Trash2, { class: 'size-4' }), t('products.batch.remove')]
        )
      ])
  }
]);
</script>

<template>
  <div>
    <Card class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold">{{ t('products.batch.title') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ t('products.batch.description') }}
          </p>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <div class="flex rounded-md border border-border p-0.5" :aria-label="t('products.batch.targetLabel')">
          <Button
            size="sm"
            :variant="target === 'draft' ? 'secondary' : 'ghost'"
            :aria-pressed="target === 'draft'"
            :disabled="running"
            @click="emit('update:target', 'draft')"
          >
            {{ t('products.batch.saveDraft') }}
          </Button>
          <Button
            size="sm"
            :variant="target === 'publish' ? 'secondary' : 'ghost'"
            :aria-pressed="target === 'publish'"
            :disabled="running"
            @click="emit('update:target', 'publish')"
          >
            {{ t('products.batch.publish') }}
          </Button>
        </div>
        <ActionTooltip
          v-if="!running"
          :disabled="selectedQueuedItems.length === 0 || !currentTargetAllowed"
          :reason="runDisabledReason"
        >
          <Button :disabled="selectedQueuedItems.length === 0 || !currentTargetAllowed" @click="emit('run')">
            <Play class="size-4" />
            {{ t(target === 'draft' ? 'products.batch.startDraft' : 'products.batch.startPublish') }}
          </Button>
        </ActionTooltip>
        <Button v-else variant="destructive" @click="emit('stop')">
          <Square class="size-4" />{{ t('products.batch.stop') }}
        </Button>
      </div>

      <p
        v-if="currentTargetAllowed && selectedBlockedCount"
        class="mt-3 text-sm text-amber-700 dark:text-amber-400"
      >
        {{ t('products.batch.blockedSummary', { count: selectedBlockedCount }) }}
      </p>
    </Card>

    <Card class="overflow-hidden">
      <DataTable
        :columns="columns"
        :data="pageItems"
        :get-row-key="(item) => item.id"
        column-settings-key="product-batch-publisher"
        v-model:page="page"
        v-model:page-size="pageSize"
        :total-rows="items.length"
        :page-size-options="[10, 20]"
        :pagination-disabled="running"
        :empty-text="t('products.batch.empty')"
        min-width="980px"
        max-height="65vh"
      >
        <template #pagination-summary
          ><span class="text-xs text-muted-foreground" aria-live="polite">{{
            t('common.data.selected', { count: selectedQueuedItems.length })
          }}</span></template
        >
      </DataTable>
    </Card>
  </div>
</template>
