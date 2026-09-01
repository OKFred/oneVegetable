<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ChevronDown, ChevronRight, Folder, FolderOpen, LoaderCircle } from '@lucide/vue';

import type { ProductGroup } from '@one-vegetable/core';

import ErrorNotice from './ErrorNotice.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

interface ProductGroupRow {
  group: ProductGroup;
  depth: 1 | 2 | 3;
}

const props = defineProps<{ modelValue: number | null }>();
const emit = defineEmits<{
  'update:modelValue': [groupId: number | null];
  select: [group: ProductGroup | null, depth: 0 | 1 | 2 | 3];
}>();

const { gateway } = useServices();
const { t } = useUiI18n();
const queryClient = useQueryClient();
const childrenByParent = ref<Record<string, ProductGroup[]>>({});
const expandedIds = ref<Set<number>>(new Set());
const loadingIds = ref<Set<number>>(new Set());
const childErrors = ref<Record<string, string>>({});
const roots = useQuery({
  queryKey: ['product-groups', 'root'],
  queryFn: () => gateway.request('listProductGroups', undefined),
  staleTime: 30_000
});
const visibleRows = computed<ProductGroupRow[]>(() => {
  const rows: ProductGroupRow[] = [];
  appendRows(roots.data.value ?? [], 1, rows);
  return rows;
});

function appendRows(
  groups: readonly ProductGroup[],
  depth: ProductGroupRow['depth'],
  rows: ProductGroupRow[]
): void {
  for (const group of groups) {
    rows.push({ group, depth });
    if (depth < 3 && expandedIds.value.has(group.id)) {
      appendRows(childrenFor(group), (depth + 1) as 2 | 3, rows);
    }
  }
}

function childrenFor(group: ProductGroup): ProductGroup[] {
  return childrenByParent.value[String(group.id)] ?? group.children;
}

function hasLoaded(groupId: number): boolean {
  return Object.hasOwn(childrenByParent.value, String(groupId));
}

function canToggle(row: ProductGroupRow): boolean {
  if (row.depth >= 3) return false;
  return !hasLoaded(row.group.id) || childrenFor(row.group).length > 0;
}

function selectGroup(group: ProductGroup | null, depth: 0 | 1 | 2 | 3): void {
  emit('update:modelValue', group?.id ?? null);
  emit('select', group, depth);
}

async function toggleGroup(row: ProductGroupRow): Promise<void> {
  const nextExpanded = new Set(expandedIds.value);
  if (nextExpanded.has(row.group.id)) {
    nextExpanded.delete(row.group.id);
    expandedIds.value = nextExpanded;
    return;
  }
  nextExpanded.add(row.group.id);
  expandedIds.value = nextExpanded;
  if (hasLoaded(row.group.id)) return;
  if (row.group.children.length > 0) {
    childrenByParent.value = {
      ...childrenByParent.value,
      [String(row.group.id)]: [...row.group.children]
    };
    return;
  }

  setLoading(row.group.id, true);
  childErrors.value = { ...childErrors.value, [String(row.group.id)]: '' };
  try {
    const children = await queryClient.fetchQuery({
      queryKey: ['product-groups', String(row.group.id)],
      queryFn: () => gateway.request('listProductGroups', { parentId: row.group.id })
    });
    childrenByParent.value = { ...childrenByParent.value, [String(row.group.id)]: children };
  } catch (error: unknown) {
    childErrors.value = {
      ...childErrors.value,
      [String(row.group.id)]:
        error instanceof Error ? error.message : t('products.groupNavigation.childLoadFailed')
    };
  } finally {
    setLoading(row.group.id, false);
  }
}

function setLoading(groupId: number, loading: boolean): void {
  const next = new Set(loadingIds.value);
  if (loading) next.add(groupId);
  else next.delete(groupId);
  loadingIds.value = next;
}
</script>

<template>
  <div role="tree" :aria-label="t('products.groupNavigation.tree')">
    <button
      type="button"
      role="treeitem"
      aria-level="1"
      class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
      :class="props.modelValue === null ? 'bg-accent text-accent-foreground' : ''"
      @click="selectGroup(null, 0)"
    >
      <span class="block size-7 shrink-0" />
      <Folder class="size-4 shrink-0" />
      <span class="truncate">{{ t('products.common.allProducts') }}</span>
    </button>

    <TransitionGroup name="ov-list" tag="div">
      <div
        v-for="row in visibleRows"
        :key="row.group.id"
        role="treeitem"
        :aria-level="row.depth + 1"
        :aria-expanded="canToggle(row) ? expandedIds.has(row.group.id) : undefined"
        class="flex w-full items-center rounded-md py-1 pr-2 text-sm transition-colors hover:bg-muted"
        :class="props.modelValue === row.group.id ? 'bg-accent text-accent-foreground' : ''"
        :style="{ paddingLeft: `${8 + (row.depth - 1) * 14}px` }"
      >
        <button
          v-if="canToggle(row)"
          type="button"
          class="mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :aria-label="
            t(
              expandedIds.has(row.group.id)
                ? 'products.groupNavigation.collapse'
                : 'products.groupNavigation.expand',
              { name: row.group.name }
            )
          "
          @click="toggleGroup(row)"
        >
          <LoaderCircle v-if="loadingIds.has(row.group.id)" class="size-4 animate-spin" />
          <ChevronDown v-else-if="expandedIds.has(row.group.id)" class="size-4" />
          <ChevronRight v-else class="size-4" />
        </button>
        <span v-else class="mr-1 block size-7 shrink-0" />
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-left"
          @click="selectGroup(row.group, row.depth)"
        >
          <FolderOpen v-if="expandedIds.has(row.group.id)" class="size-4 shrink-0" />
          <Folder v-else class="size-4 shrink-0" />
          <span class="truncate">{{ row.group.name }}</span>
        </button>
      </div>
    </TransitionGroup>

    <ErrorNotice
      v-if="roots.error.value"
      class="mx-2 my-2"
      :error="roots.error.value"
      :fallback="t('products.groupNavigation.loadFailed')"
      compact
    />
    <p
      v-if="visibleRows.length === 0 && !roots.isPending.value"
      class="px-2 py-3 text-xs text-muted-foreground"
    >
      {{ t('products.groupNavigation.empty') }}
    </p>
    <p
      v-for="(message, groupId) in childErrors"
      v-show="message"
      :key="groupId"
      class="px-2 py-1 text-xs text-destructive"
    >
      {{ message }}
    </p>
  </div>
</template>
