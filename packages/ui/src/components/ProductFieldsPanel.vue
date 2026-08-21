<script setup lang="ts">
import ProductSchemaFieldComponent from './ProductSchemaField.vue';

import type {
  ProductDescriptionImageMetadata,
  ProductEditorFieldEntry,
  ProductSchemaField,
  ProductSchemaFieldIssue
} from '@one-vegetable/core';

withDefaults(
  defineProps<{
    entries: ProductEditorFieldEntry[];
    issues: ProductSchemaFieldIssue[];
    productDescriptionType: string | undefined;
    language?: 'zh_CN' | 'en_US';
    showTechnical?: boolean;
  }>(),
  { language: 'en_US', showTechnical: false }
);

const emit = defineEmits<{
  updateField: [sourceIndex: number, field: ProductSchemaField];
  imageStatus: [status: ProductDescriptionImageMetadata & { url: string }];
}>();
</script>

<template>
  <div class="space-y-4">
    <ProductSchemaFieldComponent
      v-for="entry in entries"
      :key="entry.field.key"
      :field="entry.field"
      :issues="issues"
      :product-description-type="productDescriptionType"
      :language="language"
      :show-technical="showTechnical"
      @update="emit('updateField', entry.sourceIndex, $event)"
      @image-status="emit('imageStatus', $event)"
    />
  </div>
</template>
