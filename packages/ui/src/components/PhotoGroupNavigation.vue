<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ChevronDown, ChevronRight, Folder, FolderOpen, LoaderCircle } from '@lucide/vue';

import type { PhotoGroup } from '@one-vegetable/core';

import ErrorNotice from './ErrorNotice.vue';
import { useServices } from '../lib/services';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{
  'update:modelValue': [groupId: string];
  select: [group: PhotoGroup];
}>();

const { gateway } = useServices();
const queryClient = useQueryClient();
const descendants = ref<Record<string, PhotoGroup[]>>({});
const expandedRootIds = ref<string[]>([]);
const loadingRootIds = ref<string[]>([]);
const error = ref('');
const allGroup: PhotoGroup = {
  id: '-1',
  name: '全部图片',
  photoCount: 0,
  parentId: null,
  level: 1
};
const roots = useQuery({
  queryKey: ['photo-groups', 'root'],
  queryFn: () => gateway.request('listPhotoGroups', undefined)
});
const rootGroups = computed(() =>
  (roots.data.value ?? []).filter((group) => group.id !== '-1' && group.parentId === null)
);
const visibleGroups = computed(() => [
  allGroup,
  ...rootGroups.value.flatMap((root) => [
    root,
    ...(expandedRootIds.value.includes(root.id) ? (descendants.value[root.id] ?? []) : [])
  ])
]);

async function selectGroup(group: PhotoGroup): Promise<void> {
  emit('update:modelValue', group.id);
  emit('select', group);
  if (group.id === '-1' || group.level !== 1 || hasLoaded(group.id)) return;
  await expandGroup(group);
}

async function toggleGroup(group: PhotoGroup): Promise<void> {
  if (expandedRootIds.value.includes(group.id)) {
    expandedRootIds.value = expandedRootIds.value.filter((id) => id !== group.id);
    return;
  }
  await expandGroup(group);
}

async function expandGroup(group: PhotoGroup): Promise<void> {
  expandedRootIds.value = [...new Set([...expandedRootIds.value, group.id])];
  if (hasLoaded(group.id)) return;
  loadingRootIds.value = [...loadingRootIds.value, group.id];
  error.value = '';
  try {
    const groups = await queryClient.fetchQuery({
      queryKey: ['photo-groups', group.id],
      queryFn: () => gateway.request('listPhotoGroups', { parentId: group.id })
    });
    descendants.value = {
      ...descendants.value,
      [group.id]: groups
        .filter((candidate) => candidate.id !== group.id)
        .toSorted((left, right) => left.level - right.level || left.name.localeCompare(right.name))
    };
  } catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : '图库子分组加载失败';
  } finally {
    loadingRootIds.value = loadingRootIds.value.filter((id) => id !== group.id);
  }
}

function hasLoaded(groupId: string): boolean {
  return Object.hasOwn(descendants.value, groupId);
}

function canToggle(group: PhotoGroup): boolean {
  if (group.id === '-1' || group.level !== 1) return false;
  return !hasLoaded(group.id) || (descendants.value[group.id]?.length ?? 0) > 0;
}
</script>

<template>
  <div role="tree" aria-label="图库分组">
    <TransitionGroup name="ov-list" tag="div">
      <div
        v-for="group in visibleGroups"
        :key="group.id"
        role="treeitem"
        :aria-level="group.level"
        :aria-expanded="canToggle(group) ? expandedRootIds.includes(group.id) : undefined"
        class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
        :class="props.modelValue === group.id ? 'bg-accent text-accent-foreground' : ''"
        :style="{ paddingLeft: `${8 + (group.level - 1) * 14}px` }"
      >
        <button
          v-if="canToggle(group)"
          type="button"
          class="mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :aria-label="`${expandedRootIds.includes(group.id) ? '收起' : '展开'}${group.name}`"
          @click="toggleGroup(group)"
        >
          <LoaderCircle v-if="loadingRootIds.includes(group.id)" class="size-4 animate-spin" />
          <ChevronDown v-else-if="expandedRootIds.includes(group.id)" class="size-4" />
          <ChevronRight v-else class="size-4" />
        </button>
        <span v-else class="mr-1 block size-7 shrink-0" />
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          @click="selectGroup(group)"
        >
          <FolderOpen v-if="expandedRootIds.includes(group.id)" class="size-4 shrink-0" />
          <Folder v-else class="size-4 shrink-0" />
          <span class="truncate">{{ group.name }}</span>
        </button>
        <span v-if="group.photoCount > 0" class="text-xs text-muted-foreground">{{ group.photoCount }}</span>
      </div>
    </TransitionGroup>
    <ErrorNotice
      v-if="roots.error.value"
      class="mx-2 my-2"
      :error="roots.error.value"
      fallback="图库分组加载失败"
      compact
    />
    <p v-if="error" class="px-2 py-2 text-xs text-destructive">{{ error }}</p>
  </div>
</template>
