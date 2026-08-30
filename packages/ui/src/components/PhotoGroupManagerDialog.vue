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
  operationAvailabilityMessage(availability.reasonCode('operatePhotoGroup'), '当前环境未开放图库分组写入')
);
const confirmationTitle = computed(() => {
  if (pendingRequest.value?.operation === 'add') return '确认新增图库分组';
  if (pendingRequest.value?.operation === 'rename') return '确认修改图库分组';
  return '确认删除图库分组';
});
const confirmationDescription = computed(() => {
  if (pendingRequest.value?.operation === 'add') return '该操作会立即在当前国际站账号创建图库分组。';
  if (pendingRequest.value?.operation === 'rename') return '该操作会立即修改当前国际站账号中的分组名称。';
  return '该操作会立即删除当前国际站账号中的图库分组。';
});
const confirmationLabel = computed(() => {
  if (pendingRequest.value?.operation === 'add') return '新增分组';
  if (pendingRequest.value?.operation === 'rename') return '确认改名';
  return '确认删除';
});
const confirmationTarget = computed(() => {
  const request = pendingRequest.value;
  if (!request) return '';
  const current = findKnownGroup(request.groupId);
  if (request.operation === 'add') {
    return `将在“${current?.name ?? '全部图片'}”下新增“${request.groupName ?? ''}”。`;
  }
  if (request.operation === 'rename') {
    return `将“${current?.name ?? '所选分组'}”改名为“${request.groupName ?? ''}”。`;
  }
  return `将删除“${current?.name ?? '所选分组'}”。若分组仍含图片或子分组，平台可能拒绝该请求。`;
});

const operateGroup = useMutation({
  mutationFn: (request: PhotoGroupOperationRequest) => gateway.request('operatePhotoGroup', request),
  onSuccess: async (result, request) => {
    confirmationOpen.value = false;
    pendingRequest.value = null;
    editAction.value = null;
    groupName.value = '';
    operationError.value = '';
    toast.success(successMessage(request, result));
    emit('changed', request, result);
    await refreshGroups();
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
      [row.group.id]: error instanceof Error ? error.message : '子分组加载失败'
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
  if (request.operation === 'delete') return '已删除所选图库分组';
  if (request.operation === 'rename') return `图库分组已改名为“${result.group?.name ?? request.groupName}”`;
  return `图库分组“${result.group?.name ?? request.groupName}”已创建`;
}
</script>

<template>
  <ModalDialog
    :open="open"
    title="图库分组管理"
    description="以树形结构管理国际站图库（图片银行）分组。"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <section class="min-w-0" aria-labelledby="photo-group-tree-heading">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="photo-group-tree-heading" class="font-medium">分组树</h3>
          <p class="mt-1 text-xs text-muted-foreground">最多三级；在目标目录右侧直接管理分组。</p>
        </div>
        <Button variant="outline" size="sm" :disabled="roots.isFetching.value" @click="refreshGroups">
          <RefreshCw :class="['size-4', roots.isFetching.value ? 'animate-spin' : '']" />刷新
        </Button>
      </div>

      <ErrorNotice v-if="operationError" class="mb-3" :error="operationError" compact />

      <QueryState :loading="roots.isPending.value" :error="roots.error.value">
        <div
          class="max-h-[32rem] overflow-auto rounded-lg border bg-card p-2"
          role="tree"
          aria-label="图库分组树"
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
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">全部图片</span>
            <span class="text-xs text-muted-foreground">{{ rootGroups.length }} 个一级分组</span>
            <ActionTooltip :disabled="!operationAllowed" :reason="operationUnavailableMessage">
              <Button
                variant="ghost"
                size="icon"
                class="size-8"
                :disabled="!operationAllowed || operateGroup.isPending.value"
                aria-label="在全部图片下新增分组"
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
                aria-label="在全部图片下的新分组名称"
                maxlength="128"
                placeholder="输入一级分组名称"
                :disabled="operateGroup.isPending.value"
                @keydown.esc.prevent="cancelEdit"
              />
              <Button type="submit" size="sm" :disabled="!groupName.trim() || operateGroup.isPending.value">
                <LoaderCircle v-if="operateGroup.isPending.value" class="size-4 animate-spin" />
                {{ operateGroup.isPending.value ? '正在保存…' : '保存' }}
              </Button>
              <Button variant="ghost" size="sm" :disabled="operateGroup.isPending.value" @click="cancelEdit">
                取消
              </Button>
            </div>
          </form>

          <div v-if="visibleRows.length === 0" class="px-12 py-5 text-sm text-muted-foreground">
            当前账号暂无图库分组，可从“全部图片”右侧新增。
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
                :aria-label="`${expandedIds.has(row.group.id) ? '收起' : '展开'}${row.group.name}`"
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
              <span class="text-xs text-muted-foreground">{{ row.group.photoCount }} 张</span>
              <span class="font-mono text-[11px] text-muted-foreground">#{{ row.group.id }}</span>
              <ActionTooltip :disabled="!operationAllowed" :reason="operationUnavailableMessage">
                <Button
                  v-if="row.group.level < 3"
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :disabled="!operationAllowed || operateGroup.isPending.value"
                  :aria-label="`在 ${row.group.name} 下新增分组`"
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
                  :aria-label="`修改分组 ${row.group.name}`"
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
                  :aria-label="`删除分组 ${row.group.name}`"
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
                  editAction.operation === 'add' ? `在“${row.group.name}”下新增` : `修改“${row.group.name}”`
                }}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <Input
                  v-model="groupName"
                  class="min-w-52 flex-1"
                  :aria-label="
                    editAction.operation === 'add'
                      ? `在 ${row.group.name} 下的新分组名称`
                      : `${row.group.name} 的新名称`
                  "
                  maxlength="128"
                  :placeholder="editAction.operation === 'add' ? '输入子分组名称' : '输入新的分组名称'"
                  :disabled="operateGroup.isPending.value"
                  @keydown.esc.prevent="cancelEdit"
                />
                <Button type="submit" size="sm" :disabled="!groupName.trim() || operateGroup.isPending.value">
                  <LoaderCircle v-if="operateGroup.isPending.value" class="size-4 animate-spin" />
                  {{ operateGroup.isPending.value ? '正在保存…' : '保存' }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="operateGroup.isPending.value"
                  @click="cancelEdit"
                >
                  取消
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
              暂无子分组
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
        新增、改名和删除会直接写入当前国际站账号；每次操作都会先要求确认。
      </div>
    </section>

    <template #footer>
      <div class="flex justify-end">
        <Button
          variant="outline"
          :disabled="operateGroup.isPending.value"
          @click="emit('update:open', false)"
        >
          关闭
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
