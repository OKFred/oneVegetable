<script setup lang="ts">
import { computed } from 'vue';
import { RefreshCw } from '@lucide/vue';

import type { ProductCategory } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import Input from './ui/Input.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    search: string;
    categories: ProductCategory[];
    currentCategory?: ProductCategory | null;
    loading?: boolean;
    loadingCategoryId?: number | null;
    error?: string;
    disabled?: boolean;
  }>(),
  {
    currentCategory: null,
    loading: false,
    loadingCategoryId: null,
    error: '',
    disabled: false
  }
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:search': [value: string];
  select: [categoryId: number];
  retry: [];
}>();

interface CategoryOption extends ProductCategory {
  depth: number;
}

const options = computed<CategoryOption[]>(() => {
  const flattened = flattenCategories(props.categories);
  const current = props.currentCategory;
  if (!current || flattened.some((category) => category.id === current.id)) return flattened;
  return [{ ...current, depth: 0 }, ...flattened];
});
const filteredOptions = computed(() => {
  const query = props.search.trim().toLocaleLowerCase();
  if (!query) return options.value;
  const filtered = options.value.filter(
    (category) => category.name.toLocaleLowerCase().includes(query) || String(category.id).includes(query)
  );
  const selected = options.value.find((category) => String(category.id) === props.modelValue);
  return selected && !filtered.some((category) => category.id === selected.id)
    ? [selected, ...filtered]
    : filtered;
});
const selectedCategory = computed(() =>
  options.value.find((category) => String(category.id) === props.modelValue)
);

function updateSelection(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('update:modelValue', value);
  const categoryId = Number(value);
  if (Number.isSafeInteger(categoryId) && categoryId > 0) emit('select', categoryId);
}

function flattenCategories(items: ProductCategory[], depth = 0): CategoryOption[] {
  return items.flatMap((item) => [{ ...item, depth }, ...flattenCategories(item.children, depth + 1)]);
}
</script>

<template>
  <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
    <label class="text-sm font-medium">
      搜索已加载类目
      <Input
        :model-value="search"
        class="mt-2"
        placeholder="输入类目名称或 ID"
        :disabled="disabled"
        @update:model-value="emit('update:search', $event)"
      />
    </label>
    <label class="text-sm font-medium">
      商品类目
      <select
        :value="modelValue"
        aria-label="商品类目"
        class="mt-2 h-9 w-full cursor-pointer rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="disabled || loading"
        @change="updateSelection"
      >
        <option value="">请选择商品类目</option>
        <option v-for="category in filteredOptions" :key="category.id" :value="String(category.id)">
          {{ '—'.repeat(category.depth) }} {{ category.name }}
          {{ category.leaf ? '' : '（选择后加载下级）' }}
        </option>
      </select>
    </label>
  </div>

  <div class="mt-2 min-h-5 text-xs">
    <p v-if="loading" class="text-muted-foreground">正在加载一级商品类目…</p>
    <p v-else-if="loadingCategoryId !== null" class="text-muted-foreground">正在加载下级类目…</p>
    <p v-else-if="selectedCategory && !selectedCategory.leaf" class="text-amber-700 dark:text-amber-400">
      当前不是可发布的叶子类目，请继续选择刚加载的下级类目。
    </p>
    <p v-else-if="selectedCategory" class="text-muted-foreground">
      已选择：{{ selectedCategory.name }}（{{ selectedCategory.id }}）
    </p>
  </div>

  <div v-if="error" class="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
    <span>{{ error }}</span>
    <Button size="sm" variant="outline" @click="emit('retry')"> <RefreshCw class="size-3.5" />重试 </Button>
  </div>
</template>
