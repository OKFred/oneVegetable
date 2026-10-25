<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue';
import type { ProductCategorySuggestion } from '@one-vegetable/core/product-reference';
import { useProductReferenceI18n } from '../i18n/product-reference';
import Button from './ui/Button.vue';
import Tooltip from './ui/Tooltip.vue';
const CategoryReference = defineAsyncComponent(() => import('./ProductCategoryReference.vue'));
const ShippingReference = defineAsyncComponent(() => import('./ProductShippingReference.vue'));
withDefaults(
  defineProps<{
    kind: 'category' | 'shipping';
    title?: string;
    description?: string;
    imageUrl?: string;
    categoryId?: string;
    disabled?: boolean;
    applyCategory?: ((suggestion: ProductCategorySuggestion) => Promise<boolean>) | undefined;
  }>(),
  { title: '', description: '', imageUrl: '', categoryId: '', disabled: false, applyCategory: undefined }
);
const pr = useProductReferenceI18n();
const open = ref(false);
</script>

<template>
  <div>
    <Tooltip :text="pr('readOnly')">
      <Button size="sm" variant="outline" @click="open = true">{{
        pr(kind === 'category' ? 'recommend' : 'shipping')
      }}</Button>
    </Tooltip>
    <CategoryReference
      v-if="open && kind === 'category'"
      :title="title"
      :description="description"
      :image-url="imageUrl"
      :category-id="categoryId"
      :disabled="disabled"
      :apply-category="applyCategory"
      @close="open = false"
    />
    <ShippingReference v-if="open && kind === 'shipping'" @close="open = false" />
  </div>
</template>
