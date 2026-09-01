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

import ActionTooltip from './ActionTooltip.vue';
import ConfirmActionDialog from './ConfirmActionDialog.vue';
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
import { useUiI18n } from '../i18n';
import { useServices } from '../lib/services';

interface ProductGroupRow {
  group: ProductGroup;
  depth: number;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  changed: [group: ProductGroup];
}>();

const { gateway, mode } = useServices();
const { t } = useUiI18n();
const queryClient = useQueryClient();
const createAvailability = useOperationAvailability(['createProductGroup']);
const expandedIds = ref<Set<number>>(new Set());
const loadingIds = ref<Set<number>>(new Set());
const childrenByParent = ref<Record<string, ProductGroup[]>>({});
const childErrors = ref<Record<string, string>>({});
const newGroupName = ref('');
const createParentId = ref<number | null>(null);
const createConfirmationOpen = ref(false);

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
    t('products.groupManager.unavailable')
  )
);
const createParentLabel = computed(() => {
  if (createParentId.value === -1) return t('products.common.allGroups');
  return (
    visibleRows.value.find((row) => row.group.id === createParentId.value)?.group.name ??
    t('products.groupManager.selectedGroup')
  );
});

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
    toast.success(t('products.groupManager.created', { name: created.name }));
    emit('changed', created);
  }
});

watch(
  () => props.open,
  (open) => {
    if (open) return;
    newGroupName.value = '';
    createParentId.value = null;
    createConfirmationOpen.value = false;
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
      [String(row.group.id)]:
        error instanceof Error ? error.message : t('products.groupManager.childLoadFailed')
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
  if (mode !== 'mock') {
    createConfirmationOpen.value = true;
    return;
  }
  createGroup.mutate();
}

function confirmCreate(): void {
  createConfirmationOpen.value = false;
  createGroup.mutate();
}
</script>

<template>
  <ModalDialog
    :open="open"
    :title="t('products.groupManager.title')"
    :description="t('products.groupManager.description')"
    size="lg"
    @update:open="emit('update:open', $event)"
  >
    <section class="min-w-0" aria-labelledby="product-group-tree-heading">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="product-group-tree-heading" class="font-medium">
            {{ t('products.groupManager.treeTitle') }}
          </h3>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('products.groupManager.treeDescription') }}</p>
        </div>
        <Button variant="outline" size="sm" :disabled="roots.isFetching.value" @click="refreshGroups">
          <RefreshCw :class="['size-4', roots.isFetching.value ? 'animate-spin' : '']" />{{
            t('common.actions.refresh')
          }}
        </Button>
      </div>

      <QueryState :loading="roots.isPending.value" :error="roots.error.value">
        <div
          class="max-h-[32rem] overflow-auto rounded-lg border bg-card p-2"
          role="tree"
          :aria-label="t('products.groupManager.treeLabel')"
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
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{
              t('products.common.allGroups')
            }}</span>
            <span class="text-xs text-muted-foreground">
              {{ t('products.groupManager.rootCount', { count: roots.data.value?.length ?? 0 }) }}
            </span>
            <ActionTooltip :disabled="!createAllowed" :reason="createUnavailableMessage">
              <Button
                variant="ghost"
                size="icon"
                class="size-8"
                :disabled="!createAllowed || createGroup.isPending.value"
                :aria-label="t('products.groupManager.addToRoot')"
                @click="beginCreate(-1)"
              >
                <FolderPlus class="size-4" />
              </Button>
            </ActionTooltip>
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
                :aria-label="t('products.groupManager.rootNameLabel')"
                maxlength="80"
                :placeholder="t('products.groupManager.rootNamePlaceholder')"
                :disabled="createGroup.isPending.value"
                @keydown.esc.prevent="cancelCreate"
              />
              <Button type="submit" size="sm" :disabled="!newGroupName.trim() || createGroup.isPending.value">
                <LoaderCircle v-if="createGroup.isPending.value" class="size-4 animate-spin" />
                {{
                  createGroup.isPending.value ? t('products.groupManager.saving') : t('common.actions.save')
                }}
              </Button>
              <Button variant="ghost" size="sm" :disabled="createGroup.isPending.value" @click="cancelCreate">
                {{ t('common.actions.cancel') }}
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
            {{ t('products.groupManager.empty') }}
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
              <span v-else class="block size-8 shrink-0" />
              <FolderOpen v-if="expandedIds.has(row.group.id)" class="size-4 shrink-0 text-primary" />
              <Folder v-else class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ row.group.name }}</span>
              <span class="font-mono text-[11px] text-muted-foreground">#{{ row.group.id }}</span>
              <ActionTooltip
                v-if="row.depth < 3"
                :disabled="!createAllowed"
                :reason="createUnavailableMessage"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :disabled="!createAllowed || createGroup.isPending.value"
                  :aria-label="t('products.groupManager.addToGroup', { name: row.group.name })"
                  @click="beginCreate(row.group.id)"
                >
                  <FolderPlus class="size-4" />
                </Button>
              </ActionTooltip>
              <Tooltip :text="t('products.groupManager.renameUnavailableTooltip')">
                <span
                  role="button"
                  tabindex="0"
                  class="inline-flex size-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-disabled="true"
                  :aria-label="t('products.groupManager.renameUnavailable', { name: row.group.name })"
                >
                  <Pencil class="size-3.5" />
                </span>
              </Tooltip>
              <Tooltip :text="t('products.groupManager.deleteUnavailableTooltip')">
                <span
                  role="button"
                  tabindex="0"
                  class="inline-flex size-8 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-disabled="true"
                  :aria-label="t('products.groupManager.deleteUnavailable', { name: row.group.name })"
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
                  :aria-label="t('products.groupManager.childNameLabel', { name: row.group.name })"
                  maxlength="80"
                  :placeholder="t('products.groupManager.childNamePlaceholder')"
                  :disabled="createGroup.isPending.value"
                  @keydown.esc.prevent="cancelCreate"
                />
                <Button
                  type="submit"
                  size="sm"
                  :disabled="!newGroupName.trim() || createGroup.isPending.value"
                >
                  <LoaderCircle v-if="createGroup.isPending.value" class="size-4 animate-spin" />
                  {{
                    createGroup.isPending.value ? t('products.groupManager.saving') : t('common.actions.save')
                  }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="createGroup.isPending.value"
                  @click="cancelCreate"
                >
                  {{ t('common.actions.cancel') }}
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
              {{ t('products.groupManager.noChildren') }}
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
        {{ t('products.groupManager.apiLimitation') }}
      </div>
    </section>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" @click="emit('update:open', false)">{{ t('common.actions.close') }}</Button>
      </div>
    </template>
  </ModalDialog>

  <ConfirmActionDialog
    v-model:open="createConfirmationOpen"
    :title="t('products.groupManager.confirmTitle')"
    :description="t('products.groupManager.confirmDescription')"
    :confirm-label="t('products.groupManager.confirmLabel')"
    @confirm="confirmCreate"
  >
    <p>
      {{
        t('products.groupManager.confirmTarget', {
          parent: createParentLabel,
          name: newGroupName.trim()
        })
      }}
    </p>
  </ConfirmActionDialog>
</template>
