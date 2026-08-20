<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { FolderTree, Search } from '@lucide/vue';

import {
  productSchemaFieldText,
  productSchemaGroupLevel,
  type ProductGroup,
  type ProductSchemaField,
  withProductSchemaFieldText
} from '@one-vegetable/core';

import Input from './ui/Input.vue';
import { useServices } from '../lib/services';

const props = withDefaults(
  defineProps<{
    field: ProductSchemaField;
    showTechnical?: boolean;
  }>(),
  { showTechnical: false }
);
const emit = defineEmits<{ update: [field: ProductSchemaField] }>();

const { gateway } = useServices();
const search = ref('');
const levelFields = computed(() => {
  const fields = props.field.instances[0] ?? props.field.children;
  return new Map(
    fields.flatMap((field) => {
      const level = productSchemaGroupLevel(field);
      return level === null ? [] : ([[level, field]] as const);
    })
  );
});
const complexGroup = computed(() => levelFields.value.size > 0);
const firstId = computed(() => selectedValue(1));
const secondId = computed(() => selectedValue(2));
const thirdId = computed(() => selectedValue(3));

const roots = useQuery({
  queryKey: ['product-groups', 'root'],
  queryFn: () => gateway.request('listProductGroups', undefined)
});
const secondLevel = useQuery({
  queryKey: ['product-groups', firstId],
  queryFn: () => gateway.request('listProductGroups', { parentId: Number(firstId.value) }),
  enabled: computed(() => complexGroup.value && numericId(firstId.value) !== null)
});
const thirdLevel = useQuery({
  queryKey: ['product-groups', secondId],
  queryFn: () => gateway.request('listProductGroups', { parentId: Number(secondId.value) }),
  enabled: computed(() => complexGroup.value && numericId(secondId.value) !== null)
});

const visibleRoots = computed(() =>
  filterGroups(roots.data.value ?? [], complexGroup.value ? firstId.value : scalarId())
);
const visibleSecondLevel = computed(() => filterGroups(secondLevel.data.value ?? [], secondId.value));
const visibleThirdLevel = computed(() => filterGroups(thirdLevel.data.value ?? [], thirdId.value));
const selectedPath = computed(() =>
  [
    groupName(roots.data.value, firstId.value),
    groupName(secondLevel.data.value, secondId.value),
    groupName(thirdLevel.data.value, thirdId.value)
  ]
    .filter((value): value is string => Boolean(value))
    .join(' / ')
);

function selectedValue(level: 1 | 2 | 3): string {
  const field = levelFields.value.get(level);
  return field ? productSchemaFieldText(field) : '';
}

function scalarId(): string {
  return complexGroup.value ? '' : productSchemaFieldText(props.field);
}

function updateScalar(value: string): void {
  emit('update', withProductSchemaFieldText(props.field, value));
}

function updateLevel(level: 1 | 2 | 3, value: string): void {
  const nextValues = new Map<1 | 2 | 3, string>([
    [1, firstId.value],
    [2, secondId.value],
    [3, thirdId.value]
  ]);
  nextValues.set(level, value);
  if (level === 1) {
    nextValues.set(2, '');
    nextValues.set(3, '');
  }
  if (level === 2) nextValues.set(3, '');

  const updateFields = (fields: ProductSchemaField[]): ProductSchemaField[] =>
    fields.map((field) => {
      const fieldLevel = productSchemaGroupLevel(field);
      return fieldLevel === null
        ? field
        : withProductSchemaFieldText(field, nextValues.get(fieldLevel) ?? '');
    });
  emit('update', {
    ...props.field,
    children: updateFields(props.field.children),
    instances: props.field.instances.map((instance, index) =>
      index === 0 ? updateFields(instance) : instance
    )
  });
}

function filterGroups(groups: readonly ProductGroup[], currentId: string): ProductGroup[] {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return [...groups];
  return groups.filter(
    (group) =>
      group.id === Number(currentId) || `${group.name} ${group.id}`.toLocaleLowerCase().includes(query)
  );
}

function groupName(groups: readonly ProductGroup[] | undefined, id: string): string | null {
  if (!id) return null;
  return groups?.find((group) => group.id === Number(id))?.name ?? `未知分组 #${id}`;
}

function numericId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
</script>

<template>
  <div class="space-y-3 rounded-md bg-muted/30 p-3">
    <div class="relative">
      <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
      <Input v-model="search" class="pl-9" aria-label="搜索商品分组" placeholder="搜索分组名称或 ID" />
    </div>

    <template v-if="complexGroup">
      <div class="grid gap-3 lg:grid-cols-3">
        <label class="text-xs font-medium">
          一级分组
          <select
            :value="firstId"
            class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            @change="updateLevel(1, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">不选择</option>
            <option
              v-if="firstId && !roots.data.value?.some((group) => group.id === Number(firstId))"
              :value="firstId"
            >
              未知分组 #{{ firstId }}
            </option>
            <option v-for="group in visibleRoots" :key="group.id" :value="String(group.id)">
              {{ group.name }}
            </option>
          </select>
        </label>
        <label class="text-xs font-medium">
          二级分组
          <select
            :value="secondId"
            :disabled="!firstId || secondLevel.isPending.value"
            class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
            @change="updateLevel(2, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">不选择</option>
            <option
              v-if="secondId && !secondLevel.data.value?.some((group) => group.id === Number(secondId))"
              :value="secondId"
            >
              未知分组 #{{ secondId }}
            </option>
            <option v-for="group in visibleSecondLevel" :key="group.id" :value="String(group.id)">
              {{ group.name }}
            </option>
          </select>
        </label>
        <label class="text-xs font-medium">
          三级分组
          <select
            :value="thirdId"
            :disabled="!secondId || thirdLevel.isPending.value"
            class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
            @change="updateLevel(3, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">不选择</option>
            <option
              v-if="thirdId && !thirdLevel.data.value?.some((group) => group.id === Number(thirdId))"
              :value="thirdId"
            >
              未知分组 #{{ thirdId }}
            </option>
            <option v-for="group in visibleThirdLevel" :key="group.id" :value="String(group.id)">
              {{ group.name }}
            </option>
          </select>
        </label>
      </div>
    </template>
    <label v-else class="block text-xs font-medium">
      商品分组
      <select
        :value="scalarId()"
        class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
        @change="updateScalar(($event.target as HTMLSelectElement).value)"
      >
        <option value="">不选择</option>
        <option
          v-if="scalarId() && !roots.data.value?.some((group) => group.id === Number(scalarId()))"
          :value="scalarId()"
        >
          未知分组 #{{ scalarId() }}
        </option>
        <option v-for="group in visibleRoots" :key="group.id" :value="String(group.id)">
          {{ group.name }}
        </option>
      </select>
    </label>

    <p v-if="selectedPath" class="flex items-center gap-2 text-xs text-muted-foreground">
      <FolderTree class="size-4" />当前分组：{{ selectedPath }}
    </p>
    <p
      v-if="roots.error.value || secondLevel.error.value || thirdLevel.error.value"
      class="text-xs text-destructive"
    >
      商品分组加载失败；原始 ID 已保留，可稍后重试。
    </p>
    <p v-if="showTechnical" class="text-xs text-muted-foreground">
      分组 ID：{{ [firstId, secondId, thirdId].filter(Boolean).join(' / ') || scalarId() || '未设置' }}
    </p>
  </div>
</template>
