<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, Play, Square, Trash2 } from '@lucide/vue';

import { inspectProductBatchPublishItem } from '../lib/product-batch-publish';
import ActionTooltip from './ActionTooltip.vue';
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
const { t } = useUiI18n();

const queuedItems = computed(() => props.items.filter((item) => item.status === 'queued'));
const selectedQueuedItems = computed(() =>
  queuedItems.value.filter((item) => props.selectedIds.includes(item.id))
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
    selectedQueuedItems.value.filter((item) => !inspectProductBatchPublishItem(item, props.target).ready)
      .length
);
const allQueuedSelected = computed(
  () => queuedItems.value.length > 0 && selectedQueuedItems.value.length === queuedItems.value.length
);

function toggleItem(id: string, checked: boolean): void {
  emit(
    'update:selectedIds',
    checked ? [...new Set([...props.selectedIds, id])] : props.selectedIds.filter((itemId) => itemId !== id)
  );
}

function toggleAll(checked: boolean): void {
  emit('update:selectedIds', checked ? queuedItems.value.map((item) => item.id) : []);
}

function storedStatusLabel(item: ProductBatchPublishItem): string {
  if (item.status === 'draft-saved') return t('products.batch.storedStatus.draft');
  if (item.status === 'published') return t('products.batch.storedStatus.published');
  return t('products.batch.storedStatus.queued');
}

function runStatusLabel(result: ProductBatchPublishRunResult | undefined): string {
  if (!result) return '';
  if (result.status === 'succeeded') return t('products.batch.runStatus.succeeded');
  if (result.status === 'failed') return t('products.batch.runStatus.failed');
  if (result.status === 'blocked') return t('products.batch.runStatus.blocked');
  return t('products.batch.runStatus.stopped');
}

function statusVariant(
  item: ProductBatchPublishItem,
  result: ProductBatchPublishRunResult | undefined
): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (result?.status === 'failed' || result?.status === 'blocked') return 'destructive';
  if (result?.status === 'succeeded' || item.status !== 'queued') return 'success';
  if (props.activeItemId === item.id) return 'warning';
  return 'secondary';
}
</script>

<template>
  <div class="space-y-5">
    <Card class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold">{{ t('products.batch.title') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ t('products.batch.description') }}
          </p>
        </div>
        <p class="text-sm text-muted-foreground">
          {{
            t('products.batch.summary', { queued: queuedItems.length, selected: selectedQueuedItems.length })
          }}
        </p>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            :aria-label="t('products.batch.selectAllLabel')"
            :checked="allQueuedSelected"
            :disabled="running || queuedItems.length === 0"
            @change="toggleAll(($event.target as HTMLInputElement).checked)"
          />
          {{ t('products.batch.selectAll') }}
        </label>
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

      <p v-if="!currentTargetAllowed" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
        {{ currentDisabledReason }}
      </p>
      <p v-else-if="selectedBlockedCount" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
        {{ t('products.batch.blockedSummary', { count: selectedBlockedCount }) }}
      </p>
    </Card>

    <Card class="overflow-hidden">
      <div class="max-h-[65vh] overflow-auto">
        <table class="w-full min-w-[980px] border-collapse text-sm">
          <thead class="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr class="border-b text-left">
              <th class="w-12 whitespace-nowrap px-4 py-3">{{ t('products.batch.columns.select') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.batch.columns.product') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.batch.columns.category') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.batch.columns.language') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.batch.columns.check') }}</th>
              <th class="whitespace-nowrap px-4 py-3">{{ t('products.batch.columns.status') }}</th>
              <th class="whitespace-nowrap px-4 py-3 text-right">
                {{ t('products.batch.columns.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-muted-foreground">
                {{ t('products.batch.empty') }}
              </td>
            </tr>
            <tr v-for="item in items" :key="item.id" class="border-b last:border-b-0">
              <td class="px-4 py-3 align-top">
                <input
                  type="checkbox"
                  :aria-label="t('products.batch.selectProduct', { title: item.title })"
                  :checked="selectedIds.includes(item.id)"
                  :disabled="running || item.status !== 'queued'"
                  @change="toggleItem(item.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td class="max-w-80 px-4 py-3 align-top">
                <p class="truncate font-medium" :title="item.title">{{ item.title }}</p>
                <p v-if="item.platformProductId" class="mt-1 font-mono text-xs text-muted-foreground">
                  {{ item.platformProductId }}
                </p>
              </td>
              <td class="px-4 py-3 align-top">
                <p class="whitespace-nowrap">
                  {{ categoryLabels[item.categoryId] ?? t('products.batch.unknownCategory') }}
                </p>
                <p class="font-mono text-xs text-muted-foreground">{{ item.categoryId }}</p>
              </td>
              <td class="whitespace-nowrap px-4 py-3 align-top">{{ item.language }}</td>
              <td class="max-w-72 px-4 py-3 align-top">
                <template v-if="item.status === 'queued'">
                  <p
                    :class="
                      inspectProductBatchPublishItem(item, target).ready
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-destructive'
                    "
                  >
                    {{
                      inspectProductBatchPublishItem(item, target).ready
                        ? t('products.batch.ready')
                        : t('products.batch.minimumMissing', {
                            count: inspectProductBatchPublishItem(item, target).blockingIssues.length
                          })
                    }}
                  </p>
                  <p
                    v-if="inspectProductBatchPublishItem(item, target).schemaIssueCount"
                    class="mt-1 text-xs text-muted-foreground"
                  >
                    {{
                      t('products.batch.advisoryCount', {
                        count: inspectProductBatchPublishItem(item, target).schemaIssueCount
                      })
                    }}
                  </p>
                </template>
                <span v-else class="text-muted-foreground">{{ t('products.batch.completed') }}</span>
              </td>
              <td class="px-4 py-3 align-top">
                <Badge :variant="statusVariant(item, results[item.id])">
                  {{
                    activeItemId === item.id
                      ? t('products.batch.submitting')
                      : runStatusLabel(results[item.id]) || storedStatusLabel(item)
                  }}
                </Badge>
                <p v-if="results[item.id]?.message" class="mt-2 max-w-80 text-xs text-destructive">
                  {{ results[item.id]?.message }}
                </p>
                <p v-if="results[item.id]?.traceId" class="mt-1 font-mono text-xs text-muted-foreground">
                  traceId {{ results[item.id]?.traceId }}
                </p>
              </td>
              <td class="px-4 py-3 align-top">
                <div class="flex justify-end gap-2">
                  <Button
                    v-if="item.status === 'queued'"
                    size="sm"
                    variant="outline"
                    :disabled="running"
                    @click="emit('edit', item)"
                  >
                    <Pencil class="size-4" />{{ t('products.batch.edit') }}
                  </Button>
                  <Button size="sm" variant="ghost" :disabled="running" @click="emit('remove', item)">
                    <Trash2 class="size-4" />{{ t('products.batch.remove') }}
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </div>
</template>
