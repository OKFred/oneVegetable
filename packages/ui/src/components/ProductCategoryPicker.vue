<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw, Search } from '@lucide/vue';

import type { ProductCategory } from '@one-vegetable/core';

import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import ModalDialog from './ui/ModalDialog.vue';

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

const open = ref(false);
const browseParentId = ref<number | null>(null);
const selectedPath = computed(() => {
  const categoryId = Number(props.modelValue);
  const loaded = Number.isSafeInteger(categoryId) ? findPath(props.categories, categoryId) : null;
  if (loaded) return loaded;
  return props.currentCategory && String(props.currentCategory.id) === props.modelValue
    ? [props.currentCategory]
    : [];
});
const selectedCategory = computed(() => selectedPath.value.at(-1) ?? null);
const selectedPathText = computed(() => selectedPath.value.map(({ name }) => name).join(' / '));
const browsePath = computed(() =>
  browseParentId.value === null ? [] : (findPath(props.categories, browseParentId.value) ?? [])
);
const visibleCategories = computed(() => {
  const parent = browsePath.value.at(-1);
  const items = parent ? parent.children : props.categories;
  const query = props.search.trim().toLocaleLowerCase();
  return query ? items.filter(({ id, name }) => `${name} ${id}`.toLocaleLowerCase().includes(query)) : items;
});

function updateOpen(value: boolean): void {
  open.value = value;
  emit('update:search', '');
  if (value) {
    const path = selectedPath.value;
    browseParentId.value = path.length > 1 ? (path.at(-2)?.id ?? null) : null;
  }
}

function choose(category: ProductCategory): void {
  emit('update:modelValue', String(category.id));
  emit('select', category.id);
  if (category.leaf) updateOpen(false);
  else {
    browseParentId.value = category.id;
    emit('update:search', '');
  }
}

function navigate(categoryId: number | null): void {
  browseParentId.value = categoryId;
  emit('update:search', '');
}

function findPath(
  categories: ProductCategory[],
  categoryId: number,
  parents: ProductCategory[] = []
): ProductCategory[] | null {
  for (const category of categories) {
    const path = [...parents, category];
    if (category.id === categoryId) return path;
    const childPath = findPath(category.children, categoryId, path);
    if (childPath) return childPath;
  }
  return null;
}
</script>

<template>
  <div>
    <span class="text-sm font-medium">商品类目</span>
    <Button
      variant="outline"
      class="mt-2 h-auto min-h-12 w-full justify-start px-3 py-2 text-left"
      role="combobox"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :disabled="disabled"
      @click="updateOpen(true)"
    >
      <span class="min-w-0 flex-1">
        <span class="block truncate" :class="selectedCategory ? '' : 'text-muted-foreground'">
          {{ selectedPathText || (loading ? '正在加载商品类目…' : '请选择商品类目') }}
        </span>
        <span v-if="selectedCategory" class="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
          {{ selectedCategory.leaf ? '可发布类目' : '需要继续选择下级类目' }} · ID {{ selectedCategory.id }}
        </span>
      </span>
      <LoaderCircle v-if="loading || loadingCategoryId !== null" class="size-4 shrink-0 animate-spin" />
      <ChevronDown v-else class="size-4 shrink-0 text-muted-foreground" />
    </Button>

    <p
      v-if="selectedCategory && !selectedCategory.leaf"
      class="mt-2 text-xs text-amber-700 dark:text-amber-400"
    >
      当前不是可发布类目，请继续选择下级类目。
    </p>
    <p v-else-if="selectedCategory" class="mt-2 text-xs text-muted-foreground">
      已选择：{{ selectedPathText }}
    </p>
    <div v-if="error" class="mt-2 flex items-center gap-2 text-xs text-destructive">
      <span>{{ error }}</span>
      <Button size="sm" variant="outline" @click="emit('retry')"><RefreshCw class="size-3.5" />重试</Button>
    </div>

    <ModalDialog
      :open="open"
      title="选择商品类目"
      description="逐级浏览并选择标记为“可发布”的叶子类目。"
      size="lg"
      @update:open="updateOpen"
    >
      <div class="space-y-4">
        <div class="relative">
          <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            :model-value="search"
            class="pl-9"
            aria-label="搜索当前层级商品类目"
            placeholder="搜索当前层级的类目名称或 ID"
            @update:model-value="emit('update:search', $event)"
          />
        </div>

        <nav aria-label="类目路径" class="flex flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            @click="navigate(null)"
          >
            全部类目
          </button>
          <template v-for="category in browsePath" :key="category.id">
            <ChevronRight class="size-3.5 text-muted-foreground" />
            <button
              type="button"
              class="cursor-pointer rounded px-2 py-1 font-medium hover:bg-accent"
              @click="navigate(category.id)"
            >
              {{ category.name }}
            </button>
          </template>
        </nav>

        <div
          v-if="error"
          class="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{{ error }}</span>
          <Button size="sm" variant="outline" @click="emit('retry')">重新加载</Button>
        </div>
        <div
          v-if="loading && categories.length === 0"
          class="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle class="size-4 animate-spin" />正在加载一级类目…
        </div>
        <div
          v-else-if="loadingCategoryId !== null && loadingCategoryId === browseParentId"
          class="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle class="size-4 animate-spin" />正在加载下级类目…
        </div>
        <div v-else-if="visibleCategories.length" class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="category in visibleCategories"
            :key="category.id"
            type="button"
            class="group flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="String(category.id) === modelValue ? 'border-primary bg-primary/5' : ''"
            @click="choose(category)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ category.name }}</span>
              <span class="text-xs text-muted-foreground">ID {{ category.id }}</span>
            </span>
            <span
              v-if="category.leaf"
              class="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
            >
              可发布
            </span>
            <ChevronRight
              v-else
              class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </div>
        <div v-else class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {{ search.trim() ? '当前层级没有匹配类目。' : '当前类目没有可选下级。' }}
        </div>
      </div>
    </ModalDialog>
  </div>
</template>
