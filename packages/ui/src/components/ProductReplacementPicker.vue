<script setup lang="ts">
import type { Product } from '@one-vegetable/core';
import ProductPicker from './ProductPicker.vue';
defineProps<{ excludedIds: readonly string[] }>();
const emit = defineEmits<{ select: [product: Product] }>();
</script>
<template>
  <ProductPicker :excluded-ids="excludedIds" online-only @select="emit('select', $event)" />
</template>
