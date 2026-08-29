<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderOpen,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2
} from '@lucide/vue';
import { toast } from 'vue-sonner';

import { validateProductGroupCreateInput, type ProductGroup } from '@one-vegetable/core';

import ErrorNotice from './ErrorNotice.vue';
import QueryState from './QueryState.vue';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';
import Tooltip from './ui/Tooltip.vue';
import {
  operationAvailabilityMessage,
  useOperationAvailability
} from '../composables/use-operation-availability';
import { useServices } from '../lib/services';

interface ProductGroupRow {
  group: ProductGroup;
  depth: number;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();

const { gateway, mode } = useServices();
const queryClient = useQueryClient();
const createAvailability = useOperationAvailability(['createProductGroup']);
const expandedIds = ref<Set<number>>(new Set());
const loadingIds = ref<Set<number>>(new Set());
const childrenByParent = ref<Record<string, ProductGroup[]>>({});
const childErrors = ref<Record<string, string>>({});
const newGroupName = ref('');
const createParentId = ref<number | null>(null);

const roots = useQuery({
  queryKey: ['product-groups', 'root'],
  queryFn: () => gateway.request('listProductGroups', undefined),
  enabled: computed(() => props.open),
  staleTime: 30_000
});

const visibleRows = computed<ProductGroupRow[]>(() => {
  const rows: ProductGroupRow[] = [];
  appendVisibleRows(roots.data.value ?? [], 1, rows);
  return rows;
});

const createAllowed = computed(() => createAvailability.isAllowed('createProductGroup'));
const createUnavailableMessage = computed(() =>
  operationAvailabilityMessage(
    createAvailability.reasonCode('createProductGroup'),
    '当前环境尚未开放真实商品分组新增'
  )
);

const createGroup = useMutation({
  mutationFn: async () => {
    const validation = validateProductGroupCreateInput({
      name: newGroupName.value.trim(),
      parentId: createParentId.value ?? -1
    });
    if (!validation.valid || !validation.data) throw new Error(validation.errors.join('；'));
    return gateway.request('createProductGroup', validation.data);
  },
  onSuccess: async (created) => {
    const parentId = createParentId.value ?? -1;
    if (parentId === -1) {
      queryClient.setQueryData<ProductGroup[]>(['product-groups', 'root'], (current = []) =>
        appendUniqueGroup(current, created)
      );
    } else {
      childrenByParent.value = {
        ...childrenByParent.value,
        [String(parentId)]: appendUniqueGroup(childrenFor(parentId), created)
      };
      queryClient.setQueryData<ProductGroup[]>(['product-groups', String(parentId)], (current = []) =>
        appendUniqueGroup(current, created)
      );
      const nextExpanded = new Set(expandedIds.value);
      nextExpanded.add(parentId);
      expandedIds.value = nextExpanded;
    }
    await queryClient.invalidateQueries({ queryKey: ['product-groups'], refetchType: 'none' });
    newGroupName.value = '';
    createParentId.value = null;
    toast.success(`商品分组“${created.name}”已创建。`);
  }
});

watch(
  () => props.open,
  (open) => {
    if (open) return;
    newGroupName.value = '';
    createParentId.value = null;
    createGroup.reset();
  }
);

function appendVisibleRows(groups: readonly ProductGroup[], depth: number, rows: ProductGroupRow[]): void {
  for (const group of groups) {
    rows.push({ group, depth });
    if (depth < 3 && expandedIds.value.has(group.id)) {
      appendVisibleRows(childrenFor(group.id, group.children), depth + 1, rows);
    }
  }
}

function childrenFor(groupId: number, fallback: readonly ProductGroup[] = []): ProductGroup[] {
  return childrenByParent.value[String(groupId)] ?? [...fallback];
}

function appendUniqueGroup(groups: readonly ProductGroup[], group: ProductGroup): ProductGroup[] {
  return groups.some((candidate) => candidate.id === group.id) ? [...groups] : [...groups, group];
}

async function toggleGroup(row: ProductGroupRow): Promise<void> {
  if (row.depth >= 3) return;
  const nextExpanded = new Set(expandedIds.value);
  if (nextExpanded.has(row.group.id)) {
    nextExpanded.delete(row.group.id);
    expandedIds.value = nextExpanded;
    return;
  }
  nextExpanded.add(row.group.id);
  expandedIds.value = nextExpanded;
  if (Object.hasOwn(childrenByParent.value, String(row.group.id))) return;

  setLoading(row.group.id, true);
  childErrors.value = { ...childErrors.value, [String(row.group.id)]: '' };
  try {
    const children = await gateway.request('listProductGroups', { parentId: row.group.id });
    childrenByParent.value = { ...childrenByParent.value, [String(row.group.id)]: children };
    queryClient.setQueryData(['product-groups', String(row.group.id)], children);
  } catch (error: unknown) {
    childErrors.value = {
      ...childErrors.value,
      [String(row.group.id)]: error instanceof Error ? error.message : '子分组加载失败'
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

async function refreshGroups(): Promise<void> {
  expandedIds.value = new Set();
  childrenByParent.value = {};
  childErrors.value = {};
  cancelCreate();
  await queryClient.invalidateQueries({ queryKey: ['product-groups'] });
}

function beginCreate(parentId: number): void {
  if (!createAllowed.value || createGroup.isPending.value) return;
  createGroup.reset();
  newGroupName.value = '';
  createParentId.value = parentId;
}

function cancelCreate(): void {
  if (createGroup.isPending.value) return;
  createGroup.reset();
  newGroupName.value = '';
  createParentId.value = null;
}

function submitCreate(): void {
  if (!createAllowed.value || !newGroupName.value.trim() || createGroup.isPending.value) return;
  if (
    mode !== 'mock' &&
    !globalThis.confirm(`将在国际站创建真实商品分组“${newGroupName.value.trim()}”，是否继续？`)
  ) {
    return;
  }
  createGroup.mutate();
}
</script>

<template>
  <ModalDialog
    :open="open"
    title="商品分组"
    description="以树形结构查看国际站商品分组，并在平台允许时新增分组。"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <section class="min-w-0" aria-labelledby="product-group-tree-heading">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="product-group-tree-heading" class="font-medium">分组树</h3>
          <p class="mt-1 text-xs text-muted-foreground">最多三级；在目标目录右侧直接新增子分组。</p>
        </div>
        <Button variant="outline" size="sm" :disabled="roots.isFetching.value" @click="refreshGroups">
          <RefreshCw :class="['size-4', roots.isFetching.value ? 'animate-spin' : '']" />刷新
        </Button>
      </div>

      <QueryState :loading="roots.isPending.value" :error="roots.error.value">
        <div
          class="max-h-[32rem] overflow-auto rounded-lg border bg-card p-2"
          role="tree"
          aria-label="商品分组树"
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
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">全部分组</span>
            <span class="text-xs text-muted-foreground">{{ roots.data.value?.length ?? 0 }} 个一级分组</span>
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :disabled="!createAllowed || createGroup.isPending.value"
              aria-label="在全部分组下新增分组"
              :title="createAllowed ? '新增一级分组' : createUnavailableMessage"
              @click="beginCreate(-1)"
            >
              <FolderPlus class="size-4" />
            </Button>
          </div>
          <form
            v-if="createParentId === -1"
            class="ml-12 mt-1 rounded-md border border-dashed bg-muted/25 p-3"
            @submit.prevent="submitCreate"
          >
            <div class="flex flex-wrap items-center gap-2">
              <Input
                v-model="newGroupName"
                class="min-w-52 flex-1"
                aria-label="在全部分组下的新分组名称"
                maxlength="80"
                placeholder="输入一级分组名称"
                :disabled="createGroup.isPending.value"
                @keydown.esc.prevent="cancelCreate"
              />
              <Button type="submit" size="sm" :disabled="!newGroupName.trim() || createGroup.isPending.value">
                <LoaderCircle v-if="createGroup.isPending.value" class="size-4 animate-spin" />
                {{ createGroup.isPending.value ? '正在保存…' : '保存' }}
              </Button>
              <Button variant="ghost" size="sm" :disabled="createGroup.isPending.value" @click="cancelCreate">
                取消
              </Button>
            </div>
            <ErrorNotice
              v-if="createGroup.error.value"
              class="mt-2"
              :error="createGroup.error.value"
              compact
            />
          </form>

          <div v-if="visibleRows.length === 0" class="px-12 py-5 text-sm text-muted-foreground">
            当前账号暂无商品分组，可从“全部分组”右侧新增。
          </div>
          <div v-for="row in visibleRows" :key="row.group.id">
            <div
              class="group flex min-h-10 items-center gap-2 rounded-md pr-2 transition-colors hover:bg-muted/70"
              :style="{ paddingLeft: `${row.depth * 20 + 4}px` }"
              role="treeitem"
              :aria-level="row.depth + 1"
              :aria-expanded="row.depth < 3 ? expandedIds.has(row.group.id) : undefined"
            >
              <button
                v-if="row.depth < 3"
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
              <span class="font-mono text-[11px] text-muted-foreground">#{{ row.group.id }}</span>
              <Button
                v-if="row.depth < 3"
                variant="ghost"
                size="icon"
                class="size-8"
                :disabled="!createAllowed || createGroup.isPending.value"
                :aria-label="`在 ${row.group.name} 下新增分组`"
                :title="createAllowed ? `在 ${row.group.name} 下新增子分组` : createUnavailableMessage"
                @click="beginCreate(row.group.id)"
              >
                <FolderPlus class="size-4" />
              </Button>
              <Tooltip text="国际站官方 OpenAPI 未提供商品分组修改接口，暂时无法修改名称。">
                <span
                  role="button"
                  tabindex="0"
                  class="inline-flex size-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-disabled="true"
                  :aria-label="`修改分组 ${row.group.name}（不可用）`"
                >
                  <Pencil class="size-3.5" />
                </span>
              </Tooltip>
              <Tooltip text="国际站官方 OpenAPI 未提供商品分组删除接口，暂时无法删除线上分组。">
                <span
                  role="button"
                  tabindex="0"
                  class="inline-flex size-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-disabled="true"
                  :aria-label="`删除分组 ${row.group.name}（不可用）`"
                >
                  <Trash2 class="size-3.5" />
                </span>
              </Tooltip>
            </div>
            <form
              v-if="createParentId === row.group.id"
              class="mr-2 mt-1 rounded-md border border-dashed bg-muted/25 p-3"
              :style="{ marginLeft: `${(row.depth + 1) * 20 + 36}px` }"
              @submit.prevent="submitCreate"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Input
                  v-model="newGroupName"
                  class="min-w-52 flex-1"
                  :aria-label="`在 ${row.group.name} 下的新分组名称`"
                  maxlength="80"
                  placeholder="输入子分组名称"
                  :disabled="createGroup.isPending.value"
                  @keydown.esc.prevent="cancelCreate"
                />
                <Button
                  type="submit"
                  size="sm"
                  :disabled="!newGroupName.trim() || createGroup.isPending.value"
                >
                  <LoaderCircle v-if="createGroup.isPending.value" class="size-4 animate-spin" />
                  {{ createGroup.isPending.value ? '正在保存…' : '保存' }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="createGroup.isPending.value"
                  @click="cancelCreate"
                >
                  取消
                </Button>
              </div>
              <ErrorNotice
                v-if="createGroup.error.value"
                class="mt-2"
                :error="createGroup.error.value"
                compact
              />
            </form>
            <p
              v-if="childErrors[String(row.group.id)]"
              class="py-1 text-xs text-destructive"
              :style="{ paddingLeft: `${(row.depth + 1) * 20 + 36}px` }"
            >
              {{ childErrors[String(row.group.id)] }}
            </p>
            <p
              v-else-if="
                expandedIds.has(row.group.id) &&
                Object.hasOwn(childrenByParent, String(row.group.id)) &&
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

      <p v-if="!createAllowed" class="mt-3 text-xs text-amber-700 dark:text-amber-400">
        {{ createUnavailableMessage }}
      </p>
      <div
        class="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      >
        国际站官方 OpenAPI 目前仅提供商品分组查询与新增，没有修改名称或删除接口；对应按钮已保留但不可用。
      </div>
    </section>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" @click="emit('update:open', false)">关闭</Button>
      </div>
    </template>
  </ModalDialog>
</template>
