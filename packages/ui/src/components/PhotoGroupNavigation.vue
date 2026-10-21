<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ChevronDown, ChevronRight, Folder, FolderOpen, LoaderCircle } from '@lucide/vue';

import type { PhotoGroup } from '@one-vegetable/core';

import ErrorNotice from './ErrorNotice.vue';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';
import { useListIdentityScope } from '../lib/list-identity-scope';

const props = withDefaults(defineProps<{ modelValue: string; allLabel?: string; allowAll?: boolean }>(), {
  allowAll: true,
  allLabel: ''
});
const emit = defineEmits<{
  'update:modelValue': [groupId: string];
  select: [group: PhotoGroup];
}>();

const { gateway } = useServices();
const { t } = useUiI18n();
const queryClient = useQueryClient();
const identityScope = useListIdentityScope();
const selectedGroupId = ref(props.modelValue);
const descendants = ref<Record<string, PhotoGroup[]>>({});
const expandedRootIds = ref<string[]>([]);
const loadingRootIds = ref<string[]>([]);
const error = ref('');
let generation = 0;
let disposed = false;
onScopeDispose(() => {
  disposed = true;
});
watch(
  () => props.modelValue,
  (value) => {
    selectedGroupId.value = value;
  }
);
const allGroup = computed<PhotoGroup>(() => ({
  id: '-1',
  name: props.allLabel || t('photos.allPhotos'),
  photoCount: 0,
  parentId: null,
  level: 1
}));
watch(
  identityScope,
  (_scope, previousScope) => {
    generation++;
    descendants.value = {};
    expandedRootIds.value = [];
    loadingRootIds.value = [];
    error.value = '';
    selectedGroupId.value = '-1';
    void queryClient.cancelQueries({ queryKey: ['photo-groups', previousScope] });
    emit('update:modelValue', '-1');
    // Clear parent-held group metadata too, even when the IOP picker hides "all".
    emit('select', allGroup.value);
  },
  { flush: 'sync' }
);
const rootKey = computed(() => ['photo-groups', identityScope.value, 'root'] as const);
const roots = useQuery({
  queryKey: rootKey,
  queryFn: async ({ queryKey }) => {
    const scope = queryKey[1];
    const version = generation;
    const groups = await gateway.request('listPhotoGroups', undefined);
    if (!sameContext(scope, version)) throw new Error('GALLERY_CONTEXT_CHANGED');
    return groups;
  }
});
const rootGroups = computed(() => {
  // The query observer can still hold the previous key's result during a scope change.
  void roots.data.value;
  void roots.dataUpdatedAt.value;
  return (queryClient.getQueryData<PhotoGroup[]>(rootKey.value) ?? []).filter(
    (group) => group.id !== '-1' && group.parentId === null
  );
});
const rootError = computed(() => {
  void roots.error.value;
  return queryClient.getQueryState(rootKey.value)?.error ?? null;
});
const visibleGroups = computed(() => [
  ...(!props.allowAll ? [] : [allGroup.value]),
  ...rootGroups.value.flatMap((root) => [
    root,
    ...(expandedRootIds.value.includes(root.id) ? (descendants.value[root.id] ?? []) : [])
  ])
]);
watch(
  [() => props.allowAll, selectedGroupId, rootGroups],
  () => {
    const first = rootGroups.value[0];
    if (!props.allowAll && selectedGroupId.value === '-1' && first) void selectGroup(first);
  },
  { immediate: true, flush: 'post' }
);

async function selectGroup(group: PhotoGroup): Promise<void> {
  const current = visibleGroups.value.find((candidate) => candidate.id === group.id);
  if (!current || disposed) return;
  group = current;
  selectedGroupId.value = group.id;
  emit('update:modelValue', group.id);
  emit('select', group);
  if (group.id === '-1' || group.level !== 1 || hasLoaded(group.id)) return;
  await expandGroup(group);
}

async function toggleGroup(group: PhotoGroup): Promise<void> {
  const current = rootGroups.value.find((candidate) => candidate.id === group.id);
  if (!current || disposed) return;
  group = current;
  if (expandedRootIds.value.includes(group.id)) {
    expandedRootIds.value = expandedRootIds.value.filter((id) => id !== group.id);
    return;
  }
  await expandGroup(group);
}

async function expandGroup(group: PhotoGroup, forceRefresh = false): Promise<void> {
  const scope = identityScope.value;
  const version = generation;
  expandedRootIds.value = [...new Set([...expandedRootIds.value, group.id])];
  if (hasLoaded(group.id) && !forceRefresh) return;
  if (loadingRootIds.value.includes(group.id)) return;
  loadingRootIds.value = [...loadingRootIds.value, group.id];
  error.value = '';
  try {
    const groups = await queryClient.fetchQuery({
      queryKey: ['photo-groups', scope, group.id],
      queryFn: async () => {
        const groups = await gateway.request('listPhotoGroups', { parentId: group.id });
        if (!sameContext(scope, version)) throw new Error('GALLERY_CONTEXT_CHANGED');
        return groups;
      },
      ...(forceRefresh ? { staleTime: 0 } : {})
    });
    if (!isCurrent(scope, version)) return;
    descendants.value = {
      ...descendants.value,
      [group.id]: orderedDescendants(group, groups)
    };
  } catch (reason: unknown) {
    if (isCurrent(scope, version))
      error.value = reason instanceof Error ? reason.message : t('photos.groupNavigation.childLoadFailed');
  } finally {
    if (isCurrent(scope, version))
      loadingRootIds.value = loadingRootIds.value.filter((id) => id !== group.id);
  }
}

async function refresh(): Promise<void> {
  const scope = identityScope.value;
  const version = generation;
  error.value = '';
  descendants.value = Object.fromEntries(
    Object.entries(descendants.value).filter(([id]) => expandedRootIds.value.includes(id))
  );
  await roots.refetch({ cancelRefetch: false });
  if (!isCurrent(scope, version)) return;
  await Promise.all(
    rootGroups.value
      .filter((group) => expandedRootIds.value.includes(group.id))
      .map((group) => expandGroup(group, true))
  );
  if (!isCurrent(scope, version)) return;
  const selected = visibleGroups.value.find((group) => group.id === selectedGroupId.value);
  if (selected) emit('select', selected);
}

defineExpose({ refresh });

function sameContext(scope: string, version: number): boolean {
  return identityScope.value === scope && generation === version;
}
function isCurrent(scope: string, version: number): boolean {
  return !disposed && sameContext(scope, version);
}
function orderedDescendants(root: PhotoGroup, groups: readonly PhotoGroup[]): PhotoGroup[] {
  const rows: PhotoGroup[] = [];
  const seen = new Set([root.id]);
  function append(parent: PhotoGroup): void {
    const children = groups
      .filter((candidate) => candidate.parentId === parent.id && candidate.id !== parent.id)
      .toSorted((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (seen.has(child.id) || child.level !== parent.level + 1 || child.level > 3)
        throw new Error(t('photos.groupNavigation.childLoadFailed'));
      seen.add(child.id);
      rows.push(child);
      append(child);
    }
  }
  append(root);
  return rows;
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
  <div role="tree" :aria-label="t('photos.groupNavigation.tree')">
    <TransitionGroup :key="identityScope" name="ov-list" tag="div">
      <div
        v-for="group in visibleGroups"
        :key="group.id"
        role="treeitem"
        :aria-level="group.level"
        :aria-expanded="canToggle(group) ? expandedRootIds.includes(group.id) : undefined"
        class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
        :class="selectedGroupId === group.id ? 'bg-accent text-accent-foreground' : ''"
        :style="{ paddingLeft: `${8 + (group.level - 1) * 14}px` }"
      >
        <button
          v-if="canToggle(group)"
          type="button"
          class="mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :aria-label="
            t(
              expandedRootIds.includes(group.id)
                ? 'photos.groupNavigation.collapse'
                : 'photos.groupNavigation.expand',
              { name: group.name }
            )
          "
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
      v-if="rootError"
      class="mx-2 my-2"
      :error="rootError"
      :fallback="t('photos.groupNavigation.loadFailed')"
      compact
    />
    <p v-if="error" class="px-2 py-2 text-xs text-destructive">{{ error }}</p>
  </div>
</template>
