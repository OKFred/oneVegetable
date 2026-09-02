<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import type { PhotoGroup, PhotoGroupOperationRequest, PhotoGroupOperationResult } from '@one-vegetable/core';

import ActionTooltip from './ActionTooltip.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
import ErrorNotice from './ErrorNotice.vue';
import QueryState from './QueryState.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

interface PhotoGroupRow {
  group: PhotoGroup;
  depth: number;
}

interface EditAction {
  operation: 'add' | 'rename';
  group: PhotoGroup | null;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  changed: [request: PhotoGroupOperationRequest, result: PhotoGroupOperationResult];
}>();

const { gateway, mode } = useServices();
const { t } = useUiI18n();
const queryClient = useQueryClient();
const availability = useOperationAvailability(['operatePhotoGroup']);
const expandedIds = ref<Set<string>>(new Set());
const loadingIds = ref<Set<string>>(new Set());
const loadedIds = ref<Set<string>>(new Set());
const descendantsById = ref<Record<string, PhotoGroup>>({});
const childErrors = ref<Record<string, string>>({});
const editAction = ref<EditAction | null>(null);
const groupName = ref('');
const pendingRequest = ref<PhotoGroupOperationRequest | null>(null);
const confirmationOpen = ref(false);
const operationError = ref('');

const roots = useQuery({
  queryKey: ['photo-groups', 'root'],
  queryFn: () => gateway.request('listPhotoGroups', undefined),
  enabled: computed(() => props.open),
  staleTime: 30_000
});

const rootGroups = computed(() =>
  (roots.data.value ?? []).filter(
    (group) => group.id !== '-1' && group.level === 1 && group.parentId === null
  )
);
const visibleRows = computed<PhotoGroupRow[]>(() => {
  const rows: PhotoGroupRow[] = [];
  appendVisibleRows(rootGroups.value, 1, rows);
  return rows;
});
const operationAllowed = computed(() => availability.isAllowed('operatePhotoGroup'));
const operationUnavailableMessage = computed(() =>
  operationAvailabilityMessage(
    availability.reasonCode('operatePhotoGroup'),
    t('photos.groupManager.unavailable')
  )
);
const confirmationTitle = computed(() => {
  if (pendingRequest.value?.operation === 'add') return t('photos.groupManager.confirmation.addTitle');
  if (pendingRequest.value?.operation === 'rename') return t('photos.groupManager.confirmation.renameTitle');
  return t('photos.groupManager.confirmation.deleteTitle');
});
const confirmationDescription = computed(() => {
  if (pendingRequest.value?.operation === 'add') {
    return t('photos.groupManager.confirmation.addDescription');
  }
  if (pendingRequest.value?.operation === 'rename') {
    return t('photos.groupManager.confirmation.renameDescription');
  }
  return t('photos.groupManager.confirmation.deleteDescription');
});
const confirmationLabel = computed(() => {
  if (pendingRequest.value?.operation === 'add') return t('photos.groupManager.confirmation.addLabel');
  if (pendingRequest.value?.operation === 'rename') return t('photos.groupManager.confirmation.renameLabel');
  return t('photos.groupManager.confirmation.deleteLabel');
});
const confirmationTarget = computed(() => {
  const request = pendingRequest.value;
  if (!request) return '';
  const current = findKnownGroup(request.groupId);
  if (request.operation === 'add') {
    return t('photos.groupManager.confirmation.addTarget', {
      parent: current?.name ?? t('photos.allPhotos'),
      name: request.groupName ?? ''
    });
  }
  if (request.operation === 'rename') {
    return t('photos.groupManager.confirmation.renameTarget', {
      current: current?.name ?? t('photos.groupManager.confirmation.selectedGroup'),
      name: request.groupName ?? ''
    });
  }
  return t('photos.groupManager.confirmation.deleteTarget', {
    name: current?.name ?? t('photos.groupManager.confirmation.selectedGroup')
  });
});

const operateGroup = useMutation({
  mutationFn: (request: PhotoGroupOperationRequest) => gateway.request('operatePhotoGroup', request),
  onSuccess: async (result, request) => {
    applyOperationResult(request, result);
    confirmationOpen.value = false;
    pendingRequest.value = null;
    editAction.value = null;
    groupName.value = '';
    operationError.value = '';
    toast.success(successMessage(request, result));
    emit('changed', request, result);
    await queryClient.invalidateQueries({ queryKey: ['photo-groups'], refetchType: 'none' });
  },
  onError: (error: Error) => {
    confirmationOpen.value = false;
    operationError.value = error.message;
  }
});

watch(
  () => props.open,
  (open) => {
    if (open) return;
    cancelEdit();
    confirmationOpen.value = false;
    pendingRequest.value = null;
    operationError.value = '';
    operateGroup.reset();
  }
);

function appendVisibleRows(groups: readonly PhotoGroup[], depth: number, rows: PhotoGroupRow[]): void {
  for (const group of groups) {
    rows.push({ group, depth });
    if (group.level < 3 && expandedIds.value.has(group.id)) {
      appendVisibleRows(childrenFor(group.id), depth + 1, rows);
    }
  }
}

function childrenFor(parentId: string): PhotoGroup[] {
  return Object.values(descendantsById.value)
    .filter((group) => group.parentId === parentId && group.id !== parentId)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function findKnownGroup(groupId: string | null): PhotoGroup | null {
  if (!groupId) return null;
  return rootGroups.value.find((group) => group.id === groupId) ?? descendantsById.value[groupId] ?? null;
}

function applyOperationResult(request: PhotoGroupOperationRequest, result: PhotoGroupOperationResult): void {
  if (request.operation === 'add') {
    applyAddedGroup(request, result);
    return;
  }
  if (!request.groupId) return;
  if (request.operation === 'rename') {
    applyRenamedGroup(request, result);
    return;
  }
  applyDeletedGroup(request.groupId);
}

function applyAddedGroup(request: PhotoGroupOperationRequest, result: PhotoGroupOperationResult): void {
  const parent = findKnownGroup(request.groupId);
  const created: PhotoGroup = {
    id: result.group?.id ?? result.groupId,
    name: result.group?.name ?? request.groupName ?? t('photos.groupManager.unnamed'),
    photoCount: result.group?.photoCount ?? 0,
    parentId: request.groupId,
    level: request.groupId ? Math.min((parent?.level ?? 1) + 1, 3) : 1
  };
  const queryKey = request.groupId
    ? (['photo-groups', request.groupId] as const)
    : (['photo-groups', 'root'] as const);
  queryClient.setQueryData<PhotoGroup[]>(queryKey, (current = []) => upsertGroup(current, created));
  if (!request.groupId) return;

  descendantsById.value = { ...descendantsById.value, [created.id]: created };
  const nextExpanded = new Set(expandedIds.value);
  nextExpanded.add(request.groupId);
  expandedIds.value = nextExpanded;
  const nextLoaded = new Set(loadedIds.value);
  nextLoaded.add(request.groupId);
  loadedIds.value = nextLoaded;
  childErrors.value = { ...childErrors.value, [request.groupId]: '' };
}

function applyRenamedGroup(request: PhotoGroupOperationRequest, result: PhotoGroupOperationResult): void {
  if (!request.groupId) return;
  const current = findKnownGroup(request.groupId);
  const renamed: PhotoGroup = {
    id: request.groupId,
    name: request.groupName ?? result.group?.name ?? current?.name ?? t('photos.groupManager.unnamed'),
    photoCount: result.group?.photoCount ?? current?.photoCount ?? 0,
    parentId: current?.parentId ?? result.group?.parentId ?? null,
    level: current?.level ?? result.group?.level ?? 1
  };
  if (renamed.parentId !== null) {
    descendantsById.value = { ...descendantsById.value, [renamed.id]: renamed };
  }
  updateCachedGroups((groups) => groups.map((group) => (group.id === renamed.id ? renamed : group)));
}

function applyDeletedGroup(groupId: string): void {
  const removedIds = collectKnownBranchIds(groupId);
  const nextDescendants: Record<string, PhotoGroup> = {};
  for (const [id, group] of Object.entries(descendantsById.value)) {
    if (!removedIds.has(id)) nextDescendants[id] = group;
  }
  descendantsById.value = nextDescendants;
  expandedIds.value = new Set([...expandedIds.value].filter((id) => !removedIds.has(id)));
  loadedIds.value = new Set([...loadedIds.value].filter((id) => !removedIds.has(id)));
  updateCachedGroups((groups) => groups.filter((group) => !removedIds.has(group.id)));
}

function collectKnownBranchIds(groupId: string): Set<string> {
  const removedIds = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of Object.values(descendantsById.value)) {
      if (group.parentId && removedIds.has(group.parentId) && !removedIds.has(group.id)) {
        removedIds.add(group.id);
        changed = true;
      }
    }
  }
  return removedIds;
}

function updateCachedGroups(update: (groups: readonly PhotoGroup[]) => PhotoGroup[]): void {
  queryClient.setQueriesData<PhotoGroup[]>({ queryKey: ['photo-groups'] }, (current) =>
    current ? update(current) : current
  );
}

function upsertGroup(groups: readonly PhotoGroup[], group: PhotoGroup): PhotoGroup[] {
  const existingIndex = groups.findIndex((candidate) => candidate.id === group.id);
  if (existingIndex < 0) return [...groups, group];
  return groups.map((candidate, index) => (index === existingIndex ? group : candidate));
}

async function toggleGroup(row: PhotoGroupRow): Promise<void> {
  if (row.group.level >= 3) return;
  const nextExpanded = new Set(expandedIds.value);
  if (nextExpanded.has(row.group.id)) {
    nextExpanded.delete(row.group.id);
    expandedIds.value = nextExpanded;
    return;
  }
  nextExpanded.add(row.group.id);
  expandedIds.value = nextExpanded;
  if (loadedIds.value.has(row.group.id)) return;

  setLoading(row.group.id, true);
  childErrors.value = { ...childErrors.value, [row.group.id]: '' };
  try {
    const groups = await queryClient.fetchQuery({
      queryKey: ['photo-groups', row.group.id],
      queryFn: () => gateway.request('listPhotoGroups', { parentId: row.group.id })
    });
    const nextDescendants = { ...descendantsById.value };
    for (const group of groups) {
      if (group.id !== row.group.id && group.id !== '-1') nextDescendants[group.id] = group;
    }
    descendantsById.value = nextDescendants;
    const nextLoaded = new Set(loadedIds.value);
    nextLoaded.add(row.group.id);
    loadedIds.value = nextLoaded;
  } catch (error: unknown) {
    childErrors.value = {
      ...childErrors.value,
      [row.group.id]: error instanceof Error ? error.message : t('photos.groupManager.childLoadFailed')
    };
  } finally {
    setLoading(row.group.id, false);
  }
}

function setLoading(groupId: string, loading: boolean): void {
  const next = new Set(loadingIds.value);
  if (loading) next.add(groupId);
  else next.delete(groupId);
  loadingIds.value = next;
}

async function refreshGroups(): Promise<void> {
  expandedIds.value = new Set();
  loadingIds.value = new Set();
  loadedIds.value = new Set();
  descendantsById.value = {};
  childErrors.value = {};
  await queryClient.invalidateQueries({ queryKey: ['photo-groups'] });
}

function beginAdd(parent: PhotoGroup | null): void {
  if (!operationAllowed.value || operateGroup.isPending.value || (parent?.level ?? 0) >= 3) return;
  operationError.value = '';
  editAction.value = { operation: 'add', group: parent };
  groupName.value = '';
}

function beginRename(group: PhotoGroup): void {
  if (!operationAllowed.value || operateGroup.isPending.value) return;
  operationError.value = '';
  editAction.value = { operation: 'rename', group };
  groupName.value = group.name;
}

function cancelEdit(): void {
  if (operateGroup.isPending.value) return;
  editAction.value = null;
  groupName.value = '';
}

function submitEdit(): void {
  const action = editAction.value;
  const normalizedName = groupName.value.trim();
  if (!action || !operationAllowed.value || !normalizedName || operateGroup.isPending.value) return;
  requestOperation({
    operation: action.operation,
    groupId: action.group?.id ?? null,
    groupName: normalizedName
  });
}

function beginDelete(group: PhotoGroup): void {
  if (!operationAllowed.value || operateGroup.isPending.value) return;
  requestOperation({ operation: 'delete', groupId: group.id, groupName: null });
}

function requestOperation(request: PhotoGroupOperationRequest): void {
  operationError.value = '';
  pendingRequest.value = request;
  if (mode === 'mock' && request.operation !== 'delete') {
    operateGroup.mutate(request);
    return;
  }
  confirmationOpen.value = true;
}

function confirmOperation(): void {
  const request = pendingRequest.value;
  if (!request || operateGroup.isPending.value) return;
  operateGroup.mutate(request);
}

function successMessage(request: PhotoGroupOperationRequest, result: PhotoGroupOperationResult): string {
  if (request.operation === 'delete') return t('photos.groupManager.success.deleted');
  if (request.operation === 'rename') {
    return t('photos.groupManager.success.renamed', { name: result.group?.name ?? request.groupName ?? '' });
  }
  return t('photos.groupManager.success.added', { name: result.group?.name ?? request.groupName ?? '' });
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="t('photos.groupManager.title')"
    :description="t('photos.groupManager.description')"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <section class="min-w-0" aria-labelledby="photo-group-tree-heading">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="photo-group-tree-heading" class="font-medium">{{ t('photos.groupManager.treeTitle') }}</h3>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('photos.groupManager.treeDescription') }}</p>
        </div>
        <Button variant="outline" size="sm" :disabled="roots.isFetching.value" @click="refreshGroups">
          <RefreshCw :class="['size-4', roots.isFetching.value ? 'animate-spin' : '']" />{{
            t('common.actions.refresh')
          }}
        </Button>
      </div>

      <ErrorNotice v-if="operationError" class="mb-3" :error="operationError" compact />

      <QueryState :loading="roots.isPending.value" :error="roots.error.value">
        <div
          class="max-h-[32rem] overflow-auto rounded-lg border bg-card p-2"
          role="tree"
          :aria-label="t('photos.groupManager.treeLabel')"
        >
          <div
            class="flex min-h-10 items-center gap-2 rounded-md bg-muted/50 px-2 transition-colors hover:bg-muted"
            role="treeitem"
            :aria-level="1"
            :aria-expanded="true"
          >
            <span class="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
              <ChevronDown class="size-4" />
            </span>
            <FolderOpen class="size-4 shrink-0 text-primary" />
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ t('photos.allPhotos') }}</span>
            <span class="text-xs text-muted-foreground">
              {{ t('photos.groupManager.rootCount', { count: rootGroups.length }) }}
            </span>
            <ActionTooltip :disabled="!operationAllowed" :reason="operationUnavailableMessage">
              <Button
                variant="ghost"
                size="icon"
                class="size-8"
                :disabled="!operationAllowed || operateGroup.isPending.value"
                :aria-label="t('photos.groupManager.addToRoot')"
                @click="beginAdd(null)"
              >
                <FolderPlus class="size-4" />
              </Button>
            </ActionTooltip>
          </div>

          <form
            v-if="editAction?.operation === 'add' && editAction.group === null"
            class="ml-12 mt-1 rounded-md border border-dashed bg-muted/25 p-3"
            @submit.prevent="submitEdit"
          >
            <div class="flex flex-wrap items-center gap-2">
              <Input
                v-model="groupName"
                class="min-w-52 flex-1"
                :aria-label="t('photos.groupManager.rootNameLabel')"
                maxlength="128"
                :placeholder="t('photos.groupManager.rootNamePlaceholder')"
                :disabled="operateGroup.isPending.value"
                @keydown.esc.prevent="cancelEdit"
              />
              <Button type="submit" size="sm" :disabled="!groupName.trim() || operateGroup.isPending.value">
                <LoaderCircle v-if="operateGroup.isPending.value" class="size-4 animate-spin" />
                {{
                  operateGroup.isPending.value ? t('photos.groupManager.saving') : t('common.actions.save')
                }}
              </Button>
              <Button variant="ghost" size="sm" :disabled="operateGroup.isPending.value" @click="cancelEdit">
                {{ t('common.actions.cancel') }}
              </Button>
            </div>
          </form>

          <div v-if="visibleRows.length === 0" class="px-12 py-5 text-sm text-muted-foreground">
            {{ t('photos.groupManager.empty') }}
          </div>

          <div v-for="row in visibleRows" :key="row.group.id">
            <div
              class="group flex min-h-10 items-center gap-2 rounded-md pr-2 transition-colors hover:bg-muted/70"
              :style="{ paddingLeft: `${row.depth * 20 + 4}px` }"
              role="treeitem"
              :aria-level="row.depth + 1"
              :aria-expanded="row.group.level < 3 ? expandedIds.has(row.group.id) : undefined"
            >
              <button
                v-if="row.group.level < 3"
                type="button"
                class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                :aria-label="
                  t(
                    expandedIds.has(row.group.id)
                      ? 'photos.groupNavigation.collapse'
                      : 'photos.groupNavigation.expand',
                    { name: row.group.name }
                  )
                "
                @click="toggleGroup(row)"
              >
                <LoaderCircle v-if="loadingIds.has(row.group.id)" class="size-4 animate-spin" />
                <ChevronDown v-else-if="expandedIds.has(row.group.id)" class="size-4" />
                <ChevronRight v-else class="size-4" />
              </button>
              <span v-else class="block size-8 shrink-0" />
              <FolderOpen v-if="expandedIds.has(row.group.id)" class="size-4 shrink-0 text-primary" />
              <Folder v-else class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ row.group.name }}</span>
              <span class="text-xs text-muted-foreground">
                {{ t('photos.groupManager.photoCount', { count: row.group.photoCount }) }}
              </span>
              <span class="font-mono text-[11px] text-muted-foreground">#{{ row.group.id }}</span>
              <ActionTooltip :disabled="!operationAllowed" :reason="operationUnavailableMessage">
                <Button
                  v-if="row.group.level < 3"
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :disabled="!operationAllowed || operateGroup.isPending.value"
                  :aria-label="t('photos.groupManager.addToGroup', { name: row.group.name })"
                  @click="beginAdd(row.group)"
                >
                  <FolderPlus class="size-4" />
                </Button>
              </ActionTooltip>
              <ActionTooltip :disabled="!operationAllowed" :reason="operationUnavailableMessage">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :disabled="!operationAllowed || operateGroup.isPending.value"
                  :aria-label="t('photos.groupManager.renameGroup', { name: row.group.name })"
                  @click="beginRename(row.group)"
                >
                  <Pencil class="size-3.5" />
                </Button>
              </ActionTooltip>
              <ActionTooltip :disabled="!operationAllowed" :reason="operationUnavailableMessage">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8 text-destructive hover:text-destructive"
                  :disabled="!operationAllowed || operateGroup.isPending.value"
                  :aria-label="t('photos.groupManager.deleteGroup', { name: row.group.name })"
                  @click="beginDelete(row.group)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </ActionTooltip>
            </div>

            <form
              v-if="editAction?.group?.id === row.group.id"
              class="mr-2 mt-1 rounded-md border border-dashed bg-muted/25 p-3"
              :style="{ marginLeft: `${(row.depth + 1) * 20 + 36}px` }"
              @submit.prevent="submitEdit"
            >
              <p class="mb-2 text-xs font-medium text-muted-foreground">
                {{
                  editAction.operation === 'add'
                    ? t('photos.groupManager.addEditorTitle', { name: row.group.name })
                    : t('photos.groupManager.renameEditorTitle', { name: row.group.name })
                }}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <Input
                  v-model="groupName"
                  class="min-w-52 flex-1"
                  :aria-label="
                    editAction.operation === 'add'
                      ? t('photos.groupManager.childNameLabel', { name: row.group.name })
                      : t('photos.groupManager.newNameLabel', { name: row.group.name })
                  "
                  maxlength="128"
                  :placeholder="
                    editAction.operation === 'add'
                      ? t('photos.groupManager.childNamePlaceholder')
                      : t('photos.groupManager.newNamePlaceholder')
                  "
                  :disabled="operateGroup.isPending.value"
                  @keydown.esc.prevent="cancelEdit"
                />
                <Button type="submit" size="sm" :disabled="!groupName.trim() || operateGroup.isPending.value">
                  <LoaderCircle v-if="operateGroup.isPending.value" class="size-4 animate-spin" />
                  {{
                    operateGroup.isPending.value ? t('photos.groupManager.saving') : t('common.actions.save')
                  }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="operateGroup.isPending.value"
                  @click="cancelEdit"
                >
                  {{ t('common.actions.cancel') }}
                </Button>
              </div>
            </form>

            <p
              v-if="childErrors[row.group.id]"
              class="py-1 text-xs text-destructive"
              :style="{ paddingLeft: `${(row.depth + 1) * 20 + 36}px` }"
            >
              {{ childErrors[row.group.id] }}
            </p>
            <p
              v-else-if="
                expandedIds.has(row.group.id) &&
                loadedIds.has(row.group.id) &&
                childrenFor(row.group.id).length === 0
              "
              class="py-1 text-xs text-muted-foreground"
              :style="{ paddingLeft: `${(row.depth + 1) * 20 + 36}px` }"
            >
              {{ t('photos.groupManager.noChildren') }}
            </p>
          </div>
        </div>
      </QueryState>

      <p v-if="!operationAllowed" class="mt-3 text-xs text-amber-700 dark:text-amber-400">
        {{ operationUnavailableMessage }}
      </p>
      <div
        v-else-if="mode !== 'mock'"
        class="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      >
        {{ t('photos.groupManager.realWriteWarning') }}
      </div>
    </section>

    <template #footer>
      <div class="flex justify-end">
        <Button
          variant="outline"
          :disabled="operateGroup.isPending.value"
          @click="emit('update:open', false)"
        >
          {{ t('common.actions.close') }}
        </Button>
      </div>
    </template>
  </ModalDialog>

  <ConfirmActionDialog
    v-model:open="confirmationOpen"
    :title="confirmationTitle"
    :description="confirmationDescription"
    :confirm-label="confirmationLabel"
    :destructive="pendingRequest?.operation === 'delete'"
    :pending="operateGroup.isPending.value"
    @confirm="confirmOperation"
  >
    <p>{{ confirmationTarget }}</p>
  </ConfirmActionDialog>
</template>
