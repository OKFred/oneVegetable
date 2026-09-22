<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ListFilterDialog from './ListFilterDialog.vue';
import Input from './ui/Input.vue';
import { useUiI18n } from '../i18n';
import {
  emptyProductListFilters,
  invalidProductFilters,
  productFilterCount,
  type ProductListFilters
} from '../composables/product-list-filters';
const props = defineProps<{ modelValue: ProductListFilters }>();
const emit = defineEmits<{ 'update:modelValue': [filters: ProductListFilters] }>();
const { t } = useUiI18n();
const open = ref(false);
const draft = ref({ ...props.modelValue });
watch(open, (value) => {
  if (value) draft.value = { ...props.modelValue };
});
const invalid = computed(() => invalidProductFilters(draft.value));
function apply(): void {
  if (invalid.value) return;
  emit('update:modelValue', { ...draft.value });
  open.value = false;
}
</script>
<template>
  <ListFilterDialog
    v-model:open="open"
    :active-count="productFilterCount(modelValue)"
    :invalid="invalid"
    @apply="apply"
    @reset="draft = emptyProductListFilters()"
  >
    <fieldset class="grid gap-3 sm:grid-cols-2">
      <legend class="mb-3 font-medium">{{ t('common.filters.server') }}</legend>
      <label class="space-y-1 text-sm"
        >{{ t('products.filters.productId') }}<Input v-model="draft.productId" inputmode="numeric"
      /></label>
      <label class="space-y-1 text-sm"
        >{{ t('products.filters.categoryId') }}<Input v-model="draft.categoryId" inputmode="numeric"
      /></label>
      <label class="space-y-1 text-sm"
        >{{ t('products.filters.groupId') }}<Input v-model="draft.groupId" inputmode="numeric"
      /></label>
      <label class="space-y-1 text-sm"
        >{{ t('products.filters.groupLevel')
        }}<select v-model="draft.groupLevel" class="h-9 w-full rounded border bg-background px-3">
          <option v-for="level in ['1', '2', '3']" :key="level" :value="level">{{ level }}</option>
        </select></label
      >
      <label class="space-y-1 text-sm"
        >{{ t('products.filters.modifiedFrom') }}<Input v-model="draft.modifiedFrom" type="datetime-local"
      /></label>
      <label class="space-y-1 text-sm"
        >{{ t('products.filters.modifiedTo') }}<Input v-model="draft.modifiedTo" type="datetime-local"
      /></label>
    </fieldset>
    <fieldset class="space-y-2 border-t pt-3">
      <legend class="font-medium">{{ t('common.filters.page') }}</legend>
      <p class="text-xs text-muted-foreground">{{ t('common.filters.pageHint') }}</p>
      <label class="block text-sm"
        >{{ t('products.view.columns.status')
        }}<select v-model="draft.status" class="mt-1 h-9 w-full rounded border bg-background px-3">
          <option value="">{{ t('products.common.allProducts') }}</option>
          <option
            v-for="status in ['online', 'offline', 'draft', 'auditing', 'rejected', 'unknown']"
            :key="status"
            :value="status"
          >
            {{ t(`products.status.${status}`) }}
          </option>
        </select></label
      >
    </fieldset>
    <p v-if="invalid" class="text-sm text-destructive" role="alert">{{ t('products.filters.invalid') }}</p>
  </ListFilterDialog>
</template>
