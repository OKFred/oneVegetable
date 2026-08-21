<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@lucide/vue';

import Button from './ui/Button.vue';

const props = withDefaults(
  defineProps<{
    page: number;
    pageSize: number;
    total: number;
    pageSizeOptions?: readonly number[];
    disabled?: boolean;
  }>(),
  { pageSizeOptions: () => [10, 20, 50], disabled: false }
);
const emit = defineEmits<{
  'update:page': [page: number];
  'update:pageSize': [pageSize: number];
}>();

const normalizedTotal = computed(() => Math.max(0, Math.trunc(props.total)));
const normalizedPageSize = computed(() => Math.max(1, Math.trunc(props.pageSize)));
const pageCount = computed(() => Math.max(1, Math.ceil(normalizedTotal.value / normalizedPageSize.value)));
const currentPage = computed(() => Math.min(Math.max(1, Math.trunc(props.page)), pageCount.value));
const sizeOptions = computed(() =>
  [...new Set([...props.pageSizeOptions, normalizedPageSize.value])]
    .filter((size) => Number.isSafeInteger(size) && size > 0)
    .sort((left, right) => left - right)
);
const firstVisibleRow = computed(() =>
  normalizedTotal.value === 0 ? 0 : (currentPage.value - 1) * normalizedPageSize.value + 1
);
const lastVisibleRow = computed(() =>
  Math.min(currentPage.value * normalizedPageSize.value, normalizedTotal.value)
);

function setPage(page: number): void {
  const nextPage = Math.min(Math.max(1, Math.trunc(page)), pageCount.value);
  if (nextPage !== currentPage.value) emit('update:page', nextPage);
}

function setPageSize(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const nextPageSize = Number(target.value);
  if (!Number.isSafeInteger(nextPageSize) || nextPageSize <= 0) return;
  if (nextPageSize !== normalizedPageSize.value) emit('update:pageSize', nextPageSize);
  if (currentPage.value !== 1) emit('update:page', 1);
}
</script>

<template>
  <nav
    class="flex flex-col gap-3 border-t bg-background px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
    aria-label="表格分页"
  >
    <p class="text-xs text-muted-foreground" aria-live="polite">
      共 {{ normalizedTotal }} 条，当前 {{ firstVisibleRow }}–{{ lastVisibleRow }} 条
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
        每页
        <select
          :value="normalizedPageSize"
          :disabled="disabled"
          class="h-8 cursor-pointer rounded-md border bg-background px-2 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="每页条数"
          @change="setPageSize"
        >
          <option v-for="size in sizeOptions" :key="size" :value="size">{{ size }} 条</option>
        </select>
      </label>
      <span class="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
        第 {{ currentPage }} / {{ pageCount }} 页
      </span>
      <div class="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          class="size-8"
          :disabled="disabled || currentPage <= 1"
          aria-label="第一页"
          @click="setPage(1)"
        >
          <ChevronsLeft class="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          class="size-8"
          :disabled="disabled || currentPage <= 1"
          aria-label="上一页"
          @click="setPage(currentPage - 1)"
        >
          <ChevronLeft class="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          class="size-8"
          :disabled="disabled || currentPage >= pageCount"
          aria-label="下一页"
          @click="setPage(currentPage + 1)"
        >
          <ChevronRight class="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          class="size-8"
          :disabled="disabled || currentPage >= pageCount"
          aria-label="最后一页"
          @click="setPage(pageCount)"
        >
          <ChevronsRight class="size-4" />
        </Button>
      </div>
    </div>
  </nav>
</template>
