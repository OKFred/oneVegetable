<script setup lang="ts">
import { computed } from 'vue';
import { Pencil, Play, Square, Trash2 } from '@lucide/vue';

import { inspectProductBatchPublishItem } from '../lib/product-batch-publish';
import Badge from './ui/Badge.vue';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';

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
  if (item.status === 'draft-saved') return '已保存平台草稿';
  if (item.status === 'published') return '已正式发布';
  return '等待提交';
}

function runStatusLabel(result: ProductBatchPublishRunResult | undefined): string {
  if (!result) return '';
  if (result.status === 'succeeded') return '本轮成功';
  if (result.status === 'failed') return '本轮失败';
  if (result.status === 'blocked') return '提交前阻断';
  return '已停止';
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
          <h2 class="font-semibold">批量发品队列</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            复用单品 Schema 链路并严格串行提交；单条失败不会停止后续商品，也不会自动重试。
          </p>
        </div>
        <p class="text-sm text-muted-foreground">
          待提交 {{ queuedItems.length }} · 已选择 {{ selectedQueuedItems.length }}
        </p>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="选择全部待发布商品"
            :checked="allQueuedSelected"
            :disabled="running || queuedItems.length === 0"
            @change="toggleAll(($event.target as HTMLInputElement).checked)"
          />
          全选待提交商品
        </label>
        <div class="flex rounded-md border border-border p-0.5" aria-label="批量发品目标">
          <Button
            size="sm"
            :variant="target === 'draft' ? 'secondary' : 'ghost'"
            :aria-pressed="target === 'draft'"
            :disabled="running"
            @click="emit('update:target', 'draft')"
          >
            保存平台草稿
          </Button>
          <Button
            size="sm"
            :variant="target === 'publish' ? 'secondary' : 'ghost'"
            :aria-pressed="target === 'publish'"
            :disabled="running"
            @click="emit('update:target', 'publish')"
          >
            正式发布
          </Button>
        </div>
        <Button
          v-if="!running"
          :disabled="selectedQueuedItems.length === 0 || !currentTargetAllowed"
          :title="currentDisabledReason"
          @click="emit('run')"
        >
          <Play class="size-4" />
          {{ target === 'draft' ? '开始保存草稿' : '开始正式发布' }}
        </Button>
        <Button v-else variant="destructive" @click="emit('stop')">
          <Square class="size-4" />停止后续任务
        </Button>
      </div>

      <p v-if="!currentTargetAllowed" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
        {{ currentDisabledReason }}
      </p>
      <p v-else-if="selectedBlockedCount" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
        当前目标下有 {{ selectedBlockedCount }} 条未通过提交前检查；运行时会标记为阻断并继续处理其他商品。
      </p>
    </Card>

    <Card class="overflow-hidden">
      <div class="max-h-[65vh] overflow-auto">
        <table class="w-full min-w-[980px] border-collapse text-sm">
          <thead class="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr class="border-b text-left">
              <th class="w-12 whitespace-nowrap px-4 py-3">选择</th>
              <th class="whitespace-nowrap px-4 py-3">商品</th>
              <th class="whitespace-nowrap px-4 py-3">类目</th>
              <th class="whitespace-nowrap px-4 py-3">语言</th>
              <th class="whitespace-nowrap px-4 py-3">检查</th>
              <th class="whitespace-nowrap px-4 py-3">状态</th>
              <th class="whitespace-nowrap px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-muted-foreground">
                队列为空。请先在“商品发布/编辑”中填写商品并加入批量队列。
              </td>
            </tr>
            <tr v-for="item in items" :key="item.id" class="border-b last:border-b-0">
              <td class="px-4 py-3 align-top">
                <input
                  type="checkbox"
                  :aria-label="`选择 ${item.title}`"
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
                <p class="whitespace-nowrap">{{ categoryLabels[item.categoryId] ?? '未知类目' }}</p>
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
                        ? '可以提交'
                        : `${inspectProductBatchPublishItem(item, target).blockingIssues.length} 个阻断`
                    }}
                  </p>
                  <p
                    v-if="inspectProductBatchPublishItem(item, target).schemaIssueCount"
                    class="mt-1 text-xs text-muted-foreground"
                  >
                    Schema 问题 {{ inspectProductBatchPublishItem(item, target).schemaIssueCount }} 个
                  </p>
                </template>
                <span v-else class="text-muted-foreground">已完成</span>
              </td>
              <td class="px-4 py-3 align-top">
                <Badge :variant="statusVariant(item, results[item.id])">
                  {{
                    activeItemId === item.id
                      ? '正在提交'
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
                    <Pencil class="size-4" />编辑
                  </Button>
                  <Button size="sm" variant="ghost" :disabled="running" @click="emit('remove', item)">
                    <Trash2 class="size-4" />移除
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
