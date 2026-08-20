<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { FolderOpen, LoaderCircle } from '@lucide/vue';

import type { PhotoGroup } from '@one-vegetable/core';

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
  if (group.id === '-1' || group.level !== 1 || descendants.value[group.id]) return;
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
    expandedRootIds.value = [...new Set([...expandedRootIds.value, group.id])];
  } catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : '图库子分组加载失败';
  } finally {
    loadingRootIds.value = loadingRootIds.value.filter((id) => id !== group.id);
  }
}
</script>

<template>
  <div>
    <TransitionGroup name="ov-list" tag="div">
      <button
        v-for="group in visibleGroups"
        :key="group.id"
        type="button"
        class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
        :class="props.modelValue === group.id ? 'bg-accent text-accent-foreground' : ''"
        :style="{ paddingLeft: `${8 + (group.level - 1) * 14}px` }"
        @click="selectGroup(group)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <LoaderCircle v-if="loadingRootIds.includes(group.id)" class="size-4 shrink-0 animate-spin" />
          <FolderOpen v-else class="size-4 shrink-0" />
          <span class="truncate">{{ group.name }}</span>
        </span>
        <span v-if="group.photoCount > 0" class="text-xs text-muted-foreground">{{ group.photoCount }}</span>
      </button>
    </TransitionGroup>
    <p v-if="roots.error.value" class="px-2 py-2 text-xs text-destructive">
      {{ roots.error.value instanceof Error ? roots.error.value.message : '图库分组加载失败' }}
    </p>
    <p v-if="error" class="px-2 py-2 text-xs text-destructive">{{ error }}</p>
  </div>
</template>
